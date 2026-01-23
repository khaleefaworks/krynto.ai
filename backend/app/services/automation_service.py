from __future__ import annotations

from typing import Any, Iterable, List, Optional
import json

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.automation import Automation

logger = get_logger(__name__)


class AutomationService:
    """Minimal automation runner for MVP triggers (bot message actions only)."""

    def __init__(self, db: Session):
        self.db = db

    def list_enabled_for_trigger(self, *, website_id: int, trigger: str) -> List[Automation]:
        return (
            self.db.query(Automation)
            .filter(
                Automation.website_id == website_id,
                Automation.trigger == trigger,
                Automation.enabled == True,  # noqa: E712
            )
            .order_by(Automation.id.asc())
            .all()
        )

    def get_delay_seconds(self, *, website_id: int, trigger: str, default_seconds: int) -> int:
        """Return the first configured delay_seconds for a trigger, or default."""
        try:
            automations = self.list_enabled_for_trigger(website_id=website_id, trigger=trigger)
            for automation in automations:
                conditions = automation.conditions or {}
                if isinstance(conditions, str):
                    try:
                        conditions = json.loads(conditions)
                    except Exception:
                        conditions = {}
                delay = conditions.get("delay_seconds") or conditions.get("wait_seconds")
                if delay is None:
                    continue
                try:
                    return max(1, int(delay))
                except Exception:
                    continue
        except Exception:
            pass
        return default_seconds

    def get_bot_message_actions(self, *, website_id: int, trigger: str) -> List[dict]:
        """Return bot message actions for a trigger.

        Supported actions schema:
        - actions: [{"type": "send_bot_message", "message": "...", "event_type": "bot_waiting"}]
        - actions: {"type": "send_bot_message", "message": "..."}
        """
        actions: List[dict] = []
        automations = self.list_enabled_for_trigger(website_id=website_id, trigger=trigger)

        for automation in automations:
            raw_actions = automation.actions or {}
            if isinstance(raw_actions, str):
                try:
                    raw_actions = json.loads(raw_actions)
                except Exception:
                    raw_actions = {}
            normalized: Iterable[dict]
            if isinstance(raw_actions, list):
                normalized = [a for a in raw_actions if isinstance(a, dict)]
            elif isinstance(raw_actions, dict):
                normalized = [raw_actions]
            else:
                normalized = []

            for action in normalized:
                if str(action.get("type") or "").lower() != "send_bot_message":
                    continue
                message = action.get("message")
                if not isinstance(message, str) or not message.strip():
                    continue
                actions.append(
                    {
                        "message": message.strip(),
                        "event_type": action.get("event_type") or None,
                    }
                )

        return actions
