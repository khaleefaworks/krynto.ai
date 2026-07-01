"""
Notification Retry Service - Handles automatic retry of failed push notifications.

Purpose:
- Retry failed push notifications with exponential backoff
- Prevent thundering herd (limit retries per run)
- Clean up old completed notifications
- Provide metrics on retry success rates
"""

from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.database import SessionLocal
from app.models.notification_event import NotificationEventStatus
from app.repos import notification_events as events_repo
from app.repos import push_subscriptions as push_subs_repo
from app.services.push_service import send_web_push_to_subscriptions

logger = get_logger(__name__)


# Exponential backoff schedule: each attempt triggers next retry at these intervals (in minutes)
# Attempt 0 → first failure: retry at 30s
# Attempt 1 → second failure: retry at 2m
# Attempt 2 → third failure: retry at 5m
# Attempt 3 → fourth failure: retry at 15m
# Attempt 4 → fifth failure: retry at 60m
# Attempt 5+ → give up (mark as failed)
RETRY_BACKOFF_MINUTES = [0.5, 2, 5, 15, 60]
MAX_RETRIES = len(RETRY_BACKOFF_MINUTES)


def retry_failed_notifications(db: Session | None = None, *, max_retries: int = 50) -> dict:
    """
    Retry push notifications that failed or are pending.

    Called periodically (every 5 minutes) by APScheduler.

    Args:
        db: Database session (creates new one if None)
        max_retries: Maximum number of retries to attempt in this run (prevents thundering herd)

    Returns:
        dict with metrics: {
            "attempted": number of notifications retried,
            "succeeded": number of successful retries,
            "rescheduled": number rescheduled for future retry,
            "failed_exhausted": number that exceeded max retries,
            "duration_seconds": runtime in seconds
        }
    """
    start_time = datetime.utcnow()

    # Use provided DB session or create new one
    should_close_db = False
    if db is None:
        db = SessionLocal()
        should_close_db = True

    try:
        attempted = 0
        succeeded = 0
        rescheduled = 0
        failed_exhausted = 0

        # Find pending notifications due for retry
        pending = events_repo.find_pending_retries(db, limit=max_retries)

        if not pending:
            logger.info("notification_retry_job_no_pending")
            return {
                "attempted": 0,
                "succeeded": 0,
                "rescheduled": 0,
                "failed_exhausted": 0,
                "duration_seconds": (datetime.utcnow() - start_time).total_seconds(),
            }

        logger.info("notification_retry_job_found_pending", count=len(pending))

        for event in pending:
            attempted += 1

            try:
                # Get agent's subscriptions
                agent_subs = push_subs_repo.list_subscriptions_for_agent(db, agent_id=event.agent_id)

                if not agent_subs:
                    # No subscriptions — can't retry
                    logger.warning(
                        "notification_retry_no_subscriptions",
                        event_id=event.id,
                        agent_id=event.agent_id,
                    )
                    events_repo.mark_as_failed_with_retry(
                        db,
                        event.id,
                        attempt_count=MAX_RETRIES,  # Mark as exhausted
                        error_message="No subscriptions available for retry",
                    )
                    failed_exhausted += 1
                    continue

                # Attempt to send push
                try:
                    count = send_web_push_to_subscriptions(
                        subscriptions=agent_subs,
                        title=f"Conversation #{event.conversation_id}",
                        body="",
                        push_type="new_message",
                    )

                    if count > 0:
                        # Success
                        events_repo.mark_as_sent(db, event.id)
                        succeeded += 1
                        logger.info(
                            "notification_retry_success",
                            event_id=event.id,
                            agent_id=event.agent_id,
                            attempt=event.attempt_count + 1,
                        )
                    else:
                        # No subscriptions were attempted
                        raise RuntimeError("No subscriptions were delivered to")

                except Exception as retry_error:
                    # Retry failed — schedule next attempt or mark as failed
                    error_str = str(retry_error)[:200]

                    if event.attempt_count < MAX_RETRIES:
                        # Schedule next retry
                        events_repo.mark_as_failed_with_retry(
                            db,
                            event.id,
                            attempt_count=event.attempt_count,
                            error_message=error_str,
                            retry_backoff_minutes=RETRY_BACKOFF_MINUTES,
                        )
                        rescheduled += 1
                        logger.warning(
                            "notification_retry_rescheduled",
                            event_id=event.id,
                            agent_id=event.agent_id,
                            attempt=event.attempt_count + 1,
                            error=error_str,
                        )
                    else:
                        # Exceeded max retries — give up
                        events_repo.mark_as_failed_with_retry(
                            db,
                            event.id,
                            attempt_count=event.attempt_count,
                            error_message=f"Max retries exceeded. Last error: {error_str}",
                        )
                        failed_exhausted += 1
                        logger.error(
                            "notification_retry_exhausted",
                            event_id=event.id,
                            agent_id=event.agent_id,
                            total_attempts=event.attempt_count + 1,
                            error=error_str,
                        )

            except Exception as e:
                # Unexpected error in retry logic — log and skip this event
                logger.error(
                    "notification_retry_unexpected_error",
                    event_id=event.id,
                    error=str(e)[:200],
                )

        duration = (datetime.utcnow() - start_time).total_seconds()
        logger.info(
            "notification_retry_job_complete",
            attempted=attempted,
            succeeded=succeeded,
            rescheduled=rescheduled,
            failed_exhausted=failed_exhausted,
            duration_seconds=duration,
        )

        return {
            "attempted": attempted,
            "succeeded": succeeded,
            "rescheduled": rescheduled,
            "failed_exhausted": failed_exhausted,
            "duration_seconds": duration,
        }

    finally:
        if should_close_db:
            db.close()


def cleanup_old_notifications(db: Session | None = None, *, older_than_days: int = 30) -> int:
    """
    Clean up old completed (sent/failed) notification events.

    Called periodically (daily) to prevent table bloat.

    Args:
        db: Database session (creates new one if None)
        older_than_days: Delete notifications older than this many days

    Returns:
        Number of records deleted
    """
    should_close_db = False
    if db is None:
        db = SessionLocal()
        should_close_db = True

    try:
        deleted = events_repo.delete_old_completed(db, older_than_days=older_than_days)
        logger.info("notification_cleanup_complete", deleted=deleted, older_than_days=older_than_days)
        return deleted
    finally:
        if should_close_db:
            db.close()
