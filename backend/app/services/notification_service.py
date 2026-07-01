"""
Consolidated Notification Service - Single source of truth for all notification delivery.

Purpose:
- Unified notification pipeline (WS, push, email) through one service
- Automatic fallback (WS → push if offline)
- Database tracking for audit trail and retry
- Deduplication at database level

Replaces scattered push calls throughout the codebase with a single,
trackable notification mechanism.
"""

import asyncio
from datetime import datetime
from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.core.database import SessionLocal
from app.repos import notification_events as events_repo
from app.repos import push_subscriptions as push_subs_repo
from app.services.push_service import send_web_push_to_subscriptions
from app.services.agent_service import AgentService

logger = get_logger(__name__)


class NotificationService:
    """
    Unified notification delivery service.

    Usage:
        service = NotificationService(db)
        await service.notify_agent_about_conversation(
            conversation_id=conv.id,
            agent_id=agent.id,
            trigger_type="visitor_message",
            message_id=msg.id,
            title="New message",
            body="Visitor message preview"
        )
    """

    def __init__(self, db: Session):
        self.db = db
        self.agent_service = AgentService(db)

    async def notify_agent_about_conversation(
        self,
        *,
        conversation_id: int,
        agent_id: int,
        trigger_type: str,  # "new_chat", "visitor_message", "bot_message"
        message_id: int | None = None,
        title: str = "",
        body: str = "",
    ) -> None:
        """
        Notify an agent about a conversation via all available channels.

        Delivery order:
        1. Record in database for audit + retry
        2. Real-time: WebSocket if agent is connected
        3. Fallback: Push notification (with automatic retry on failure)
        4. Future: Email (not yet implemented)

        Args:
            conversation_id: Which conversation this notification is about
            agent_id: Which agent to notify
            trigger_type: What triggered the notification
            message_id: Optional message ID (for audit trail)
            title: Notification title
            body: Notification body (preview text)

        Returns:
            None (notification is sent asynchronously)
        """
        try:
            # Step 1: Record in database for audit + retry capability
            event = events_repo.create(
                self.db,
                conversation_id=conversation_id,
                agent_id=agent_id,
                trigger_type=trigger_type,
                message_id=message_id,
            )
            logger.info(
                "notification_created_for_audit",
                event_id=event.id,
                agent_id=agent_id,
                conversation_id=conversation_id,
                trigger_type=trigger_type,
            )

            # Step 2: Attempt real-time delivery via WebSocket
            ws_delivered = False
            try:
                await self.agent_service.send_to_agent(
                    agent_id=agent_id,
                    message_data={
                        "type": "notification",
                        "event_id": event.id,
                        "conversation_id": conversation_id,
                        "title": title,
                        "body": body,
                        "trigger_type": trigger_type,
                    }
                )
                ws_delivered = True
                events_repo.mark_as_sent(self.db, event.id)
                logger.info(
                    "notification_delivered_via_ws",
                    event_id=event.id,
                    agent_id=agent_id,
                    conversation_id=conversation_id,
                )
            except Exception as ws_error:
                # Agent not connected — will rely on push
                logger.debug(
                    "ws_delivery_failed_will_use_push",
                    event_id=event.id,
                    agent_id=agent_id,
                    error=str(ws_error)[:100],
                )

            # Step 3: Fallback: Push notification (async, with retry queue)
            # Send in background so we don't block the main request
            if not ws_delivered:
                loop = asyncio.get_running_loop()
                loop.run_in_executor(
                    None,
                    lambda: self._send_push_with_tracking(
                        event_id=event.id,
                        agent_id=agent_id,
                        conversation_id=conversation_id,
                        title=title,
                        body=body,
                    ),
                )

        except Exception as e:
            logger.error(
                "notification_service_error",
                agent_id=agent_id,
                conversation_id=conversation_id,
                error=str(e)[:200],
            )

    def _send_push_with_tracking(
        self,
        *,
        event_id: int,
        agent_id: int,
        conversation_id: int,
        title: str,
        body: str,
    ) -> None:
        """
        Send push notification and track result in database.

        This runs in a background thread executor (non-blocking).
        On failure, the event is queued for automatic retry with exponential backoff.

        Args:
            event_id: NotificationEvent ID for tracking
            agent_id: Which agent's subscriptions to send to
            conversation_id: Context for the notification
            title: Notification title
            body: Notification body
        """
        # Create a fresh DB session for this background task
        db = SessionLocal()
        try:
            # Get agent's push subscriptions
            subs = push_subs_repo.list_subscriptions_for_agent(db, agent_id=agent_id)

            if not subs:
                logger.warning(
                    "push_send_no_subscriptions",
                    event_id=event_id,
                    agent_id=agent_id,
                )
                events_repo.update(
                    db,
                    event_id,
                    status="failed",
                    error_message="No push subscriptions available",
                )
                return

            # Attempt to send push
            try:
                count = send_web_push_to_subscriptions(
                    subscriptions=subs,
                    title=title,
                    body=body,
                    url=f"/dashboard/chats/{conversation_id}",
                    push_type="new_message",
                )

                if count > 0:
                    events_repo.mark_as_sent(db, event_id)
                    logger.info(
                        "push_notification_sent",
                        event_id=event_id,
                        agent_id=agent_id,
                        conversation_id=conversation_id,
                        subscriptions_delivered=count,
                    )
                else:
                    raise RuntimeError(f"Push service sent 0/{len(subs)} subscriptions")

            except Exception as send_error:
                # Push failed — queue for retry
                error_str = str(send_error)[:200]

                events_repo.mark_as_failed_with_retry(
                    db,
                    event_id,
                    attempt_count=0,
                    error_message=error_str,
                )

                logger.warning(
                    "push_notification_failed_queued_for_retry",
                    event_id=event_id,
                    agent_id=agent_id,
                    conversation_id=conversation_id,
                    error=error_str,
                )

        except Exception as e:
            logger.error(
                "push_tracking_error",
                event_id=event_id,
                agent_id=agent_id,
                error=str(e)[:200],
            )
        finally:
            db.close()
