from __future__ import annotations

from typing import Any, Iterable, List, Optional
import json

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.automation import Automation

logger = get_logger(__name__)


def _parse_repeat_config(conditions: Any, trigger: str) -> tuple[str, int | None]:
    """Extract repeat mode and cooldown_seconds from an automation's conditions dict."""
    try:
        c = json.loads(conditions) if isinstance(conditions, str) else (conditions or {})
    except Exception:
        c = {}
    if not isinstance(c, dict):
        c = {}

    repeat = str(c.get("repeat") or "").strip().lower()
    if repeat not in {"once", "cooldown", "always"}:
        repeat = "cooldown" if trigger == "visitor_connected" else "once"

    cooldown: int | None = None
    if repeat == "cooldown":
        raw = c.get("repeat_cooldown_seconds") or c.get("cooldown_seconds")
        if raw is None:
            hours = c.get("cooldown_hours")
            if hours is not None:
                try:
                    raw = int(hours) * 3600
                except Exception:
                    pass
        if raw is not None:
            try:
                cooldown = max(1, int(raw))
            except Exception:
                cooldown = None

    return repeat, cooldown


class AutomationService:
    """Automation runner: executes ordered multi-action pipelines per trigger."""

    def __init__(self, db: Session):
        self.db = db

    # ─── Core unified accessor ────────────────────────────────────────────────

    def get_automations_with_actions(self, *, website_id: int, trigger: str) -> list[dict]:
        """Return all enabled automations for a trigger as an ordered list.

        Each entry: {automation_id, actions: [action_dicts], repeat, cooldown_seconds}
        Actions are normalized to a list and filtered to non-empty dicts.
        """
        result: list[dict] = []
        for automation in self.list_enabled_for_trigger(website_id=website_id, trigger=trigger):
            raw = automation.actions or {}
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except Exception:
                    raw = {}
            if isinstance(raw, dict):
                actions = [raw] if raw else []
            elif isinstance(raw, list):
                actions = [a for a in raw if isinstance(a, dict)]
            else:
                actions = []
            if not actions:
                continue
            repeat, cooldown = _parse_repeat_config(automation.conditions, trigger)
            result.append({
                "automation_id": automation.id,
                "actions": actions,
                "repeat": repeat,
                "cooldown_seconds": cooldown,
            })
        return result

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

        Safe to call multiple times; only inserts missing (trigger, name) pairs.
        """
        defaults = [
            # ─── Connection / visitor type ───────────────────────────────────
            {
                "name": "Welcome message",
                "trigger": "visitor_connected",
                "enabled": True,
                "conditions": {"cooldown_hours": 24},
                "actions": [{"type": "send_bot_message", "message": "Hi! How can we help you today?", "event_type": "automation_welcome"}],
            },
            {
                "name": "New visitor welcome",
                "trigger": "visitor_new",
                "enabled": False,
                "conditions": {"repeat": "once"},
                "actions": [{"type": "send_bot_message", "message": "Hi! Welcome — is there anything we can help you with?", "event_type": "bot_new_visitor"}],
            },
            {
                "name": "Returning visitor welcome",
                "trigger": "visitor_returning",
                "enabled": False,
                "conditions": {"repeat": "once"},
                "actions": [{"type": "send_bot_message", "message": "Welcome back! How can we help?", "event_type": "bot_returning_visitor"}],
            },
            # ─── Presence timeline ───────────────────────────────────────────
            {
                "name": "Visitor connected event",
                "trigger": "visitor_socket_connected",
                "enabled": False,
                "conditions": {"repeat": "cooldown", "repeat_cooldown_seconds": 10},
                "actions": [{"type": "emit_system_event", "content": "Visitor has just connected.", "event_type": "visitor_socket_connected"}],
            },
            {
                "name": "Visitor dropped event",
                "trigger": "visitor_dropped",
                "enabled": True,
                "conditions": {"repeat": "cooldown", "repeat_cooldown_seconds": 10},
                "actions": [{"type": "emit_system_event", "content": "Visitor left the page.", "event_type": "visitor_dropped"}],
            },
            {
                "name": "Visitor reconnected",
                "trigger": "visitor_reconnected",
                "enabled": False,
                "conditions": {"repeat": "cooldown", "repeat_cooldown_seconds": 10},
                "actions": [{"type": "emit_system_event", "content": "Visitor returned to the page.", "event_type": "visitor_reconnected"}],
            },
            # ─── During conversation ─────────────────────────────────────────
            {
                "name": "Waiting message",
                "trigger": "no_agent_assigned_for",
                "enabled": True,
                "conditions": {"delay_seconds": 30},
                "actions": [{"type": "send_bot_message", "message": "Thanks! An agent will be with you shortly.", "event_type": "bot_waiting"}],
            },
            {
                "name": "Offline prompt",
                "trigger": "website_offline_first_message",
                "enabled": True,
                "conditions": {},
                "actions": [
                    {"type": "send_bot_message", "message": "We're offline right now. Leave us a message and we'll get back to you soon.", "event_type": "bot_offline"},
                ],
            },
            {
                "name": "Agent joined",
                "trigger": "agent_joined",
                "enabled": True,
                "conditions": {"repeat": "always"},
                "actions": [{"type": "tag_with_agent_name"}],
            },
            # ─── Visitor ended ───────────────────────────────────────────────
            {
                "name": "Visitor ended chat",
                "trigger": "conversation_visitor_ended",
                "enabled": True,
                "conditions": {"repeat": "once"},
                "actions": [
                    {"type": "emit_system_event", "content": "Visitor ended the chat.", "visitor_content": "You ended the chat.", "event_type": "visitor_ended"},
                    {"type": "show_rating_popup", "event_type": "rating_popup_shown"},
                ],
            },
            {
                "name": "Visitor ended bot message",
                "trigger": "conversation_visitor_ended",
                "enabled": False,
                "conditions": {"repeat": "once"},
                "actions": [{"type": "send_bot_message", "message": "Thanks for chatting! If you need more help, just send us a message.", "event_type": "bot_visitor_ended"}],
            },
            # ─── Resolved ────────────────────────────────────────────────────
            {
                "name": "Closing message",
                "trigger": "conversation_resolved",
                "enabled": False,
                "conditions": {},
                "actions": [{"type": "send_bot_message", "message": "Thanks! This conversation is now closed.", "event_type": "bot_closing"}],
            },
            {
                "name": "Resolved rating",
                "trigger": "conversation_resolved",
                "enabled": True,
                "conditions": {"repeat": "once"},
                "actions": [
                    {"type": "emit_system_event", "content": "{agent_name} resolved the chat.", "visitor_content": "{agent_name} has resolved this conversation.", "event_type": "conversation_resolved_message"},
                    {"type": "show_rating_popup", "event_type": "rating_popup_shown"},
                ],
            },
            {
                "name": "Auto-resolved event",
                "trigger": "conversation_auto_resolved",
                "enabled": True,
                "conditions": {},
                "actions": [{"type": "emit_system_event", "content": "Conversation automatically resolved after visitor ended (24 h).", "event_type": "conversation_auto_resolved"}],
            },
            # ─── Chatbot ─────────────────────────────────────────────────────
            {
                "name": "Team routing chatbot",
                "trigger": "conversation_created",
                "enabled": False,
                "category": "chatbot_flow",
                "conditions": {},
                "actions": [{"type": "bot_prompt_buttons", "message": "Welcome! What are you looking for?", "allow_input": False, "buttons": []}],
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
                    category=str(payload.get("category") or "auto_message"),
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
        """Return send_bot_message actions for a trigger (with repeat config merged in)."""
        result: List[dict] = []
        for entry in self.get_automations_with_actions(website_id=website_id, trigger=trigger):
            for action in entry["actions"]:
                if str(action.get("type") or "").lower() != "send_bot_message":
                    continue
                message = action.get("message")
                if not isinstance(message, str) or not message.strip():
                    continue
                result.append({
                    "message": message.strip(),
                    "event_type": action.get("event_type") or None,
                    "repeat": entry["repeat"],
                    "repeat_cooldown_seconds": entry["cooldown_seconds"],
                    "automation_id": entry["automation_id"],
                })
        return result

    def get_system_event_actions(self, *, website_id: int, trigger: str) -> List[dict]:
        """Return emit_system_event actions for a trigger (with repeat config merged in)."""
        result: List[dict] = []
        for entry in self.get_automations_with_actions(website_id=website_id, trigger=trigger):
            for action in entry["actions"]:
                if str(action.get("type") or "").lower() != "emit_system_event":
                    continue
                content = action.get("content") or action.get("message")
                if not isinstance(content, str) or not content.strip():
                    continue
                result.append({
                    "content": content.strip(),
                    "visitor_content": action.get("visitor_content"),
                    "event_type": action.get("event_type") or None,
                    "repeat": entry["repeat"],
                    "repeat_cooldown_seconds": entry["cooldown_seconds"],
                    "automation_id": entry["automation_id"],
                })
        return result
