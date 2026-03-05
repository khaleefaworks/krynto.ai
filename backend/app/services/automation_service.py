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

    def list_for_trigger(self, *, website_id: int, trigger: str) -> List[Automation]:
        """Return all automations for a trigger (enabled or disabled)."""
        return (
            self.db.query(Automation)
            .filter(
                Automation.website_id == website_id,
                Automation.trigger == trigger,
            )
            .order_by(Automation.id.asc())
            .all()
        )

    def has_any_for_trigger(self, *, website_id: int, trigger: str) -> bool:
        try:
            return (
                self.db.query(Automation.id)
                .filter(
                    Automation.website_id == website_id,
                    Automation.trigger == trigger,
                )
                .limit(1)
                .first()
                is not None
            )
        except Exception:
            return False

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

    def get_cooldown_seconds(self, *, website_id: int, trigger: str, default_seconds: int) -> int:
        """Return cooldown seconds for a trigger, or default.

        Supported condition keys:
        - cooldown_seconds
        - cooldown_hours (preferred)
        - welcome_cooldown_hours (legacy naming)
        """
        try:
            automations = self.list_enabled_for_trigger(website_id=website_id, trigger=trigger)
            for automation in automations:
                conditions = automation.conditions or {}
                if isinstance(conditions, str):
                    try:
                        conditions = json.loads(conditions)
                    except Exception:
                        conditions = {}

                cooldown_seconds = conditions.get("cooldown_seconds")
                if cooldown_seconds is not None:
                    try:
                        return max(1, int(cooldown_seconds))
                    except Exception:
                        pass

                cooldown_hours = conditions.get("cooldown_hours")
                if cooldown_hours is None:
                    cooldown_hours = conditions.get("welcome_cooldown_hours")
                if cooldown_hours is not None:
                    try:
                        return max(1, int(cooldown_hours)) * 3600
                    except Exception:
                        pass
        except Exception:
            pass
        return default_seconds

    def get_actions_by_type(
        self, *, website_id: int, trigger: str, action_type: str
    ) -> List[dict]:
        """Return raw action dicts of a specific type for a trigger.

        Generic accessor that works for any action type stored in the JSON
        actions column.  Each returned dict includes the originating
        ``automation_id`` for traceability.
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
                if str(action.get("type") or "").lower() == action_type.lower():
                    action_copy = dict(action)
                    action_copy["automation_id"] = getattr(automation, "id", None)
                    actions.append(action_copy)

        return actions

    def get_first_bot_message_action(self, *, website_id: int, trigger: str) -> dict | None:
        actions = self.get_bot_message_actions(website_id=website_id, trigger=trigger)
        return actions[0] if actions else None

    def get_first_system_event_action(self, *, website_id: int, trigger: str) -> dict | None:
        actions = self.get_system_event_actions(website_id=website_id, trigger=trigger)
        return actions[0] if actions else None

    def ensure_default_automations_for_website(self, *, website_id: int) -> None:
        """Create default automations for a website if missing.

        Safe to call multiple times; only inserts missing triggers.
        """
        defaults = [
            {
                "name": "Welcome message",
                "trigger": "visitor_connected",
                "enabled": True,
                "conditions": {"cooldown_hours": 24},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "Hi! How can we help you today?",
                        "event_type": "automation_welcome",
                    }
                ],
            },
            {
                "name": "Visitor connected event",
                "trigger": "visitor_socket_connected",
                "enabled": False,
                "conditions": {"repeat": "cooldown", "repeat_cooldown_seconds": 10},
                "actions": [
                    {
                        "type": "emit_system_event",
                        "content": "Visitor has just connected.",
                        "event_type": "visitor_socket_connected",
                    }
                ],
            },
            {
                "name": "Waiting message",
                "trigger": "no_agent_assigned_for",
                "enabled": True,
                "conditions": {"delay_seconds": 60},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "Thanks! An agent will be with you shortly.",
                        "event_type": "bot_waiting",
                    }
                ],
            },
            {
                "name": "Offline prompt",
                "trigger": "website_offline_first_message",
                "enabled": True,
                "conditions": {},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "We're busy at the moment. Sorry about that. Leave us your email, and we will contact you as soon as possible.",
                        "event_type": "bot_offline",
                    }
                ],
            },
            {
                "name": "Closing message",
                "trigger": "conversation_resolved",
                "enabled": False,
                "conditions": {},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "Thanks! This conversation is now closed.",
                        "event_type": "bot_closing",
                    }
                ],
            },
            {
                "name": "Resolved event",
                "trigger": "conversation_resolved",
                "enabled": False,
                "conditions": {},
                "actions": [
                    {
                        "type": "emit_system_event",
                        "content": "This conversation has been resolved.",
                        "event_type": "conversation_resolved",
                    }
                ],
            },
            {
                "name": "Reopened event",
                "trigger": "conversation_reopened",
                "enabled": False,
                "conditions": {},
                "actions": [
                    {
                        "type": "emit_system_event",
                        "content": "This conversation has been reopened.",
                        "event_type": "conversation_reopened",
                    }
                ],
            },
            {
                "name": "Visitor closed event",
                "trigger": "visitor_closed_chat",
                "enabled": True,
                "conditions": {},
                "actions": [
                    {
                        "type": "emit_system_event",
                        "content": "Visitor closed chat.",
                        "event_type": "visitor_closed_chat",
                    }
                ],
            },
            {
                "name": "Visitor closed message",
                "trigger": "visitor_closed_chat",
                "enabled": False,
                "conditions": {},
                "actions": [
                    {
                        "type": "send_bot_message",
                        "message": "Thanks! If you need anything else, just send another message.",
                        "event_type": "bot_visitor_closed",
                    }
                ],
            },
            {
                "name": "Visitor left website event",
                "trigger": "visitor_left_website",
                "enabled": True,
                "conditions": {"repeat": "cooldown", "repeat_cooldown_seconds": 10},
                "actions": [
                    {
                        "type": "emit_system_event",
                        "content": "Visitor left website.",
                        "event_type": "visitor_left_website",
                    }
                ],
            },
            {
                "name": "Team routing chatbot",
                "trigger": "conversation_created",
                "enabled": False,
                "conditions": {},
                "actions": [
                    {
                        "type": "bot_prompt_buttons",
                        "message": "Welcome! What are you looking for?",
                        "buttons": [],
                    }
                ],
            },
        ]

        try:
            existing_pairs = {
                (str(t or ""), str(n or ""))
                for (t, n) in (
                    self.db.query(Automation.trigger, Automation.name)
                    .filter(Automation.website_id == website_id)
                    .all()
                )
            }
        except Exception:
            existing_pairs = set()

        created_any = False
        for payload in defaults:
            trigger = payload.get("trigger")
            name = payload.get("name")
            if not trigger or not name:
                continue
            if (str(trigger), str(name)) in existing_pairs:
                continue

            try:
                automation = Automation(
                    website_id=website_id,
                    name=str(name),
                    trigger=str(trigger),
                    enabled=bool(payload.get("enabled", True)),
                    conditions=payload.get("conditions") or {},
                    actions=payload.get("actions") or {},
                )
                self.db.add(automation)
                created_any = True
            except Exception:
                continue

        if created_any:
            self.db.commit()

    def get_bot_message_actions(self, *, website_id: int, trigger: str) -> List[dict]:
        """Return bot message actions for a trigger.

        Supported actions schema:
        - actions: [{"type": "send_bot_message", "message": "...", "event_type": "bot_waiting"}]
        - actions: {"type": "send_bot_message", "message": "..."}
        """
        actions: List[dict] = []
        automations = self.list_enabled_for_trigger(website_id=website_id, trigger=trigger)

        def _repeat_config(*, trigger: str, conditions: Any) -> tuple[str, int | None]:
            # repeat: once | cooldown | always
            try:
                if isinstance(conditions, str):
                    conditions_obj = json.loads(conditions)
                else:
                    conditions_obj = conditions
            except Exception:
                conditions_obj = {}
            if not isinstance(conditions_obj, dict):
                conditions_obj = {}

            repeat = str(conditions_obj.get("repeat") or "").strip().lower()
            if repeat not in {"once", "cooldown", "always"}:
                # Backward-compatible defaults.
                repeat = "cooldown" if trigger == "visitor_connected" else "once"

            cooldown_seconds: int | None = None
            if repeat == "cooldown":
                raw = (
                    conditions_obj.get("repeat_cooldown_seconds")
                    if conditions_obj.get("repeat_cooldown_seconds") is not None
                    else conditions_obj.get("cooldown_seconds")
                )
                if raw is None:
                    raw = conditions_obj.get("cooldown_hours")
                    if raw is not None:
                        try:
                            raw = int(raw) * 3600
                        except Exception:
                            raw = None
                if raw is not None:
                    try:
                        cooldown_seconds = max(1, int(raw))
                    except Exception:
                        cooldown_seconds = None

            return repeat, cooldown_seconds

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

                # Backward-compatibility: older UI versions stored some system events
                # as `send_bot_message` with event_type == trigger (e.g. conversation_resolved).
                # Those should be treated as system events, not bot messages.
                if trigger in {"conversation_resolved", "conversation_reopened"}:
                    event_type = action.get("event_type")
                    if isinstance(event_type, str) and event_type.strip() == trigger:
                        continue

                message = action.get("message")
                if not isinstance(message, str) or not message.strip():
                    continue

                repeat, cooldown_seconds = _repeat_config(trigger=trigger, conditions=automation.conditions)
                actions.append(
                    {
                        "message": message.strip(),
                        "event_type": action.get("event_type") or None,
                        "repeat": repeat,
                        "repeat_cooldown_seconds": cooldown_seconds,
                        "automation_id": getattr(automation, "id", None),
                    }
                )

        return actions

    def get_system_event_actions(self, *, website_id: int, trigger: str) -> List[dict]:
        """Return system event actions for a trigger.

        Supported actions schema:
        - actions: [{"type": "emit_system_event", "content": "...", "event_type": "..."}]
        - actions: {"type": "emit_system_event", "content": "...", "event_type": "..."}

        Notes:
        - This does not persist anything by itself; callers decide whether/how to apply these.
        - `content` may also be provided as `message` for convenience.
        """
        actions: List[dict] = []
        automations = self.list_enabled_for_trigger(website_id=website_id, trigger=trigger)

        def _repeat_config(*, trigger: str, conditions: Any) -> tuple[str, int | None]:
            try:
                if isinstance(conditions, str):
                    conditions_obj = json.loads(conditions)
                else:
                    conditions_obj = conditions
            except Exception:
                conditions_obj = {}
            if not isinstance(conditions_obj, dict):
                conditions_obj = {}

            repeat = str(conditions_obj.get("repeat") or "").strip().lower()
            if repeat not in {"once", "cooldown", "always"}:
                repeat = "cooldown" if trigger == "visitor_connected" else "once"

            cooldown_seconds: int | None = None
            if repeat == "cooldown":
                raw = (
                    conditions_obj.get("repeat_cooldown_seconds")
                    if conditions_obj.get("repeat_cooldown_seconds") is not None
                    else conditions_obj.get("cooldown_seconds")
                )
                if raw is None:
                    raw = conditions_obj.get("cooldown_hours")
                    if raw is not None:
                        try:
                            raw = int(raw) * 3600
                        except Exception:
                            raw = None
                if raw is not None:
                    try:
                        cooldown_seconds = max(1, int(raw))
                    except Exception:
                        cooldown_seconds = None

            return repeat, cooldown_seconds

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
                action_type = str(action.get("type") or "").lower()

                # Primary supported action type.
                if action_type == "emit_system_event":
                    pass
                # Backward-compatibility: treat `send_bot_message` where event_type == trigger
                # as a system event (this matches how older templates were saved).
                elif action_type == "send_bot_message" and trigger in {"conversation_resolved", "conversation_reopened"}:
                    event_type = action.get("event_type")
                    if not (isinstance(event_type, str) and event_type.strip() == trigger):
                        continue
                else:
                    continue

                content = action.get("content")
                if content is None:
                    content = action.get("message")
                if not isinstance(content, str) or not content.strip():
                    continue

                event_type = action.get("event_type")
                if event_type is not None and not isinstance(event_type, str):
                    event_type = str(event_type)

                repeat, cooldown_seconds = _repeat_config(trigger=trigger, conditions=automation.conditions)

                actions.append(
                    {
                        "content": content.strip(),
                        "event_type": event_type.strip() if isinstance(event_type, str) and event_type.strip() else None,
                        "repeat": repeat,
                        "repeat_cooldown_seconds": cooldown_seconds,
                        "automation_id": getattr(automation, "id", None),
                    }
                )

        return actions
