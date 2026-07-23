"""
Auto-close Scheduler — resolves inactive conversations after 24 hours.

Runs as a background APScheduler job inside the FastAPI process.
Uses a separate DB session per run (not the request-scoped session).
"""

from datetime import datetime, timedelta, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.database import SessionLocal
from app.core.logging import get_logger

logger = get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _run_auto_close() -> None:
    """
    Find OPEN conversations with real visitor engagement (at least one visitor
    message) where that engagement has been idle for >= 24 hours, and resolve them.
    Sets closed_by = 'inactivity'. No rating prompt is triggered (visitor is offline).

    Conversations where the visitor only browsed without sending a message are
    intentionally excluded — they have no value to close and would pollute the
    resolved list.
    """
    from app.models.conversation import Conversation, ConversationStatus

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        # Only consider conversations where the visitor actually sent a message.
        conversations = (
            db.query(Conversation)
            .filter(
                Conversation.status == ConversationStatus.OPEN,
                Conversation.last_visitor_message_at.isnot(None),
            )
            .all()
        )

        def _to_utc(dt: datetime) -> datetime:
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt

        closed_count = 0
        for conv in conversations:
            # Use the most recent of visitor/agent message timestamps (created_at
            # intentionally excluded — it fires before any engagement).
            timestamps = [t for t in [
                conv.last_visitor_message_at,
                conv.last_agent_message_at,
            ] if t is not None]

            if not timestamps:
                continue

            last_activity = max(_to_utc(t) for t in timestamps)

            if last_activity < cutoff:
                conv.status = ConversationStatus.RESOLVED
                conv.closed_by = "inactivity"
                closed_count += 1

        if closed_count:
            db.commit()
            logger.info("auto_close_conversations", closed=closed_count)
    except Exception:
        logger.exception("auto_close_job_error")
        db.rollback()
    finally:
        db.close()


def _run_auto_resolve_visitor_ended() -> None:
    """
    Find OPEN conversations where the visitor ended the chat (event_type='visitor_ended')
    and the ended event is older than 24 hours. Resolve them as 'system_auto'.
    Fires the conversation_auto_resolved automation trigger via the orchestrator.
    """
    import asyncio
    from app.models.conversation import Conversation, ConversationStatus
    from app.models.message import Message

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        # Find OPEN conversations that have a visitor_ended system event
        subq = (
            db.query(Message.conversation_id)
            .filter(
                Message.event_type == "visitor_ended",
            )
            .subquery()
        )

        conversations = (
            db.query(Conversation)
            .filter(
                Conversation.status == ConversationStatus.OPEN,
                Conversation.id.in_(subq),
            )
            .all()
        )

        resolved_ids = []
        for conv in conversations:
            # Check when the visitor_ended event was created
            ended_msg = (
                db.query(Message)
                .filter(
                    Message.conversation_id == conv.id,
                    Message.event_type == "visitor_ended",
                )
                .order_by(Message.created_at.asc())
                .first()
            )
            if not ended_msg:
                continue
            ts = ended_msg.created_at
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts < cutoff:
                resolved_ids.append(conv.id)

        if not resolved_ids:
            return

        # Resolve via orchestrator so automations fire correctly.
        # Run in a new event loop per job execution (APScheduler sync job).
        async def _resolve_all():
            from app.services.conversation_orchestrator import ConversationOrchestrator
            db2 = SessionLocal()
            try:
                orch = ConversationOrchestrator(db2)
                for conv_id in resolved_ids:
                    try:
                        await orch.close_conversation(
                            conversation_id=conv_id,
                            closed_by="system_auto",
                        )
                    except Exception as e:
                        logger.warning("auto_resolve_visitor_ended_conv_error", conversation_id=conv_id, error=str(e))
            finally:
                db2.close()

        asyncio.run(_resolve_all())

        logger.info("auto_resolve_visitor_ended", resolved=len(resolved_ids))
    except Exception:
        logger.exception("auto_resolve_visitor_ended_job_error")
    finally:
        db.close()


def start_scheduler() -> None:
    """Start the APScheduler background jobs. Call once at app startup.

    NOTE: The automatic inactivity-close jobs (_run_auto_close and
    _run_auto_resolve_visitor_ended) have been intentionally disabled.
    Conversations now stay OPEN until an agent or visitor explicitly resolves
    them.  The job functions are preserved below for reference / manual use.

    Registered jobs:
    - Notification retry (every 5 min): Retry failed push notifications with backoff
    - Notification cleanup (daily): Clean up old completed notifications
    - Scheduled backup (every 2h): Dump DB + uploads to local disk (SA2)
    - Lead delivery retry (every 5 min): Retry failed webhook pushes with backoff
    """
    global _scheduler
    if _scheduler is not None:
        return  # Already running (e.g. reload in dev mode).

    _scheduler = AsyncIOScheduler(timezone="UTC")

    # Phase 2B: Register notification retry job
    try:
        from app.services.notification_retry_service import retry_failed_notifications, cleanup_old_notifications

        # Retry failed notifications every 5 minutes
        _scheduler.add_job(
            retry_failed_notifications,
            "interval",
            minutes=5,
            id="notification_retry_job",
            name="Retry failed push notifications with exponential backoff",
            max_instances=1,  # Prevent concurrent runs
            replace_existing=True,
        )
        logger.info("notification_retry_job_registered")

        # Clean up old notifications daily at 2 AM UTC
        _scheduler.add_job(
            cleanup_old_notifications,
            "cron",
            hour=2,
            minute=0,
            id="notification_cleanup_job",
            name="Clean up old completed notifications",
            max_instances=1,
            replace_existing=True,
        )
        logger.info("notification_cleanup_job_registered")
    except Exception as e:
        logger.warning("notification_jobs_registration_failed", error=str(e))

    # SA2: automated DB + uploads backup every 2 hours.
    try:
        from app.services.backup_service import run_scheduled_backup

        _scheduler.add_job(
            run_scheduled_backup,
            "interval",
            hours=2,
            id="scheduled_backup_job",
            name="Back up the database and uploads directory",
            max_instances=1,
            replace_existing=True,
        )
        logger.info("scheduled_backup_job_registered")
    except Exception as e:
        logger.warning("scheduled_backup_job_registration_failed", error=str(e))

    # Lead integration: retry pushes to Frappe (or future integration types)
    # that failed on their first (immediate) attempt. Same backoff schedule
    # and reasoning as the notification retry job above.
    try:
        from app.services.lead_integration_service import retry_failed_lead_deliveries

        _scheduler.add_job(
            retry_failed_lead_deliveries,
            "interval",
            minutes=5,
            id="lead_delivery_retry_job",
            name="Retry failed lead-integration deliveries with exponential backoff",
            max_instances=1,
            replace_existing=True,
        )
        logger.info("lead_delivery_retry_job_registered")
    except Exception as e:
        logger.warning("lead_delivery_retry_job_registration_failed", error=str(e))

    _scheduler.start()
    logger.info("auto_close_scheduler_started")


def stop_scheduler() -> None:
    """Stop the scheduler gracefully. Call at app shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("auto_close_scheduler_stopped")


def get_scheduler() -> AsyncIOScheduler | None:
    """Return the running scheduler instance, or None if not started."""
    return _scheduler
