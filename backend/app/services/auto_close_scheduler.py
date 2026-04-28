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
    Find all OPEN conversations with no activity for >= 24 hours and resolve them.
    Sets closed_by = 'inactivity'. No rating prompt is triggered (visitor is offline).
    """
    from app.models.conversation import Conversation, ConversationStatus

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

        # Build a query for OPEN conversations where the latest activity is older than cutoff.
        # last_activity = max(last_visitor_message_at, last_agent_message_at, created_at)
        conversations = (
            db.query(Conversation)
            .filter(Conversation.status == ConversationStatus.OPEN)
            .all()
        )

        closed_count = 0
        for conv in conversations:
            # Determine the most recent activity timestamp.
            timestamps = [t for t in [
                conv.last_visitor_message_at,
                conv.last_agent_message_at,
                conv.created_at,
            ] if t is not None]

            if not timestamps:
                continue

            # Normalise to UTC-aware for comparison.
            def _to_utc(dt: datetime) -> datetime:
                if dt.tzinfo is None:
                    return dt.replace(tzinfo=timezone.utc)
                return dt

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

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        loop.run_until_complete(_resolve_all())

        logger.info("auto_resolve_visitor_ended", resolved=len(resolved_ids))
    except Exception:
        logger.exception("auto_resolve_visitor_ended_job_error")
    finally:
        db.close()


def start_scheduler() -> None:
    """Start the APScheduler background jobs. Call once at app startup."""
    global _scheduler
    if _scheduler is not None:
        return  # Already running (e.g. reload in dev mode).

    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_auto_close,
        trigger="interval",
        hours=1,
        id="auto_close_conversations",
        replace_existing=True,
    )
    _scheduler.add_job(
        _run_auto_resolve_visitor_ended,
        trigger="interval",
        minutes=30,
        id="auto_resolve_visitor_ended",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("auto_close_scheduler_started")


def stop_scheduler() -> None:
    """Stop the scheduler gracefully. Call at app shutdown."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("auto_close_scheduler_stopped")
