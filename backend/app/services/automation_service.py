from __future__ import annotations

from typing import Any, List, Optional

from sqlalchemy.orm import Session

from app.core.logging import get_logger
from app.models.automation import Automation

logger = get_logger(__name__)


def _trigger_node_config(automation: Automation) -> dict:
    """Extract config from the trigger node in an automation's graph."""
    for node in (automation.nodes or []):
        if isinstance(node, dict) and node.get("type") == "trigger":
            return node.get("config") or {}
    return {}


class AutomationService:
    """Query layer and seed helper for the automation graph model."""

    def __init__(self, db: Session):
        self.db = db

    # ─── DB queries ───────────────────────────────────────────────────────────

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

    # ─── Trigger node config accessors ────────────────────────────────────────

    def get_delay_seconds(self, *, website_id: int, trigger: str, default_seconds: int) -> int:
        """Return delay_seconds from the trigger node config of the first enabled automation."""
        for automation in self.list_enabled_for_trigger(website_id=website_id, trigger=trigger):
            config = _trigger_node_config(automation)
            delay = config.get("delay_seconds")
            if delay is not None:
                try:
                    return max(1, int(delay))
                except Exception:
                    continue
        return default_seconds

    def get_cooldown_seconds(self, *, website_id: int, trigger: str, default_seconds: int) -> int:
        """Return cooldown_seconds from the trigger node config of the first enabled automation."""
        for automation in self.list_enabled_for_trigger(website_id=website_id, trigger=trigger):
            config = _trigger_node_config(automation)
            raw = config.get("cooldown_seconds")
            if raw is None:
                hours = config.get("cooldown_hours")
                if hours is not None:
                    try:
                        return max(1, int(hours)) * 3600
                    except Exception:
                        pass
            if raw is not None:
                try:
                    return max(1, int(raw))
                except Exception:
                    pass
        return default_seconds

    def get_actions_by_type(self, *, website_id: int, trigger: str, action_type: str) -> List[dict]:
        """Return nodes of a specific type across all enabled automations for a trigger.

        Each returned dict is the node's config merged with automation_id.
        """
        result: List[dict] = []
        for automation in self.list_enabled_for_trigger(website_id=website_id, trigger=trigger):
            for node in (automation.nodes or []):
                if not isinstance(node, dict):
                    continue
                if str(node.get("type") or "").lower() == action_type.lower():
                    config = dict(node.get("config") or {})
                    config["automation_id"] = automation.id
                    result.append(config)
        return result

    # ─── Default automation seeder ────────────────────────────────────────────

    def ensure_default_automations_for_website(self, *, website_id: int) -> None:
        """Create default automation flows for a website if missing.

        Each automation is stored as a node graph. The trigger node holds
        repeat/cooldown config; action nodes hold type-specific config.
        Safe to call multiple times — only inserts missing (trigger, name) pairs.
        """
        defaults = [
            # ─── Chatbot flow ─────────────────────────────────────────────────
            {
                "name": "Team routing chatbot",
                "trigger": "conversation_created",
                "enabled": False,
                "category": "chatbot_flow",
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "bot_prompt_buttons", "config": {"message": "Welcome! What are you looking for?", "allow_input": False, "buttons": []}, "position": {"x": 0, "y": 150}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                ],
            },
            # ─── During conversation ──────────────────────────────────────────
            {
                "name": "Waiting message",
                "trigger": "no_agent_assigned_for",
                "enabled": True,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {"delay_seconds": 30}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "send_bot_message", "config": {"message": "Thanks! An agent will be with you shortly.", "event_type": "bot_waiting"}, "position": {"x": 0, "y": 150}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                ],
            },
            # ─── Presence timeline ────────────────────────────────────────────
            {
                "name": "Visitor dropped event",
                "trigger": "visitor_dropped",
                "enabled": True,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {"repeat": "cooldown", "cooldown_seconds": 10}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "emit_system_event", "config": {"content": "Visitor left the page.", "event_type": "visitor_dropped", "send_to_visitor": False, "visitor_content": ""}, "position": {"x": 0, "y": 150}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                ],
            },
            {
                "name": "Visitor reconnected",
                "trigger": "visitor_reconnected",
                "enabled": False,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {"repeat": "cooldown", "cooldown_seconds": 10}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "emit_system_event", "config": {"content": "Visitor returned to the page.", "event_type": "visitor_reconnected", "send_to_visitor": False, "visitor_content": ""}, "position": {"x": 0, "y": 150}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                ],
            },
            # ─── Offline ─────────────────────────────────────────────────────
            {
                "name": "Offline prompt",
                "trigger": "website_offline_first_message",
                "enabled": False,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "send_bot_message", "config": {"message": "We're offline right now. Leave us a message and we'll get back to you soon.", "event_type": "bot_offline"}, "position": {"x": 0, "y": 150}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                ],
            },
            # ─── Agent joined ─────────────────────────────────────────────────
            {
                "name": "Agent joined",
                "trigger": "agent_joined",
                "enabled": False,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {"repeat": "always"}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "tag_with_agent_name", "config": {}, "position": {"x": 0, "y": 150}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                ],
            },
            # ─── Visitor ended chat ───────────────────────────────────────────
            {
                "name": "Visitor ended chat",
                "trigger": "conversation_visitor_ended",
                "enabled": False,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {"repeat": "once"}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "emit_system_event", "config": {"content": "Visitor ended the chat.", "visitor_content": "You ended the chat.", "event_type": "visitor_ended", "send_to_visitor": True}, "position": {"x": 0, "y": 150}},
                    {"id": "n_wait", "type": "wait", "config": {"seconds": 2}, "position": {"x": 0, "y": 250}},
                    {"id": "n2", "type": "show_rating_popup", "config": {"event_type": "rating_popup_shown"}, "position": {"x": 0, "y": 350}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                    {"id": "e_wait", "from": "n1", "to": "n_wait"},
                    {"id": "e2", "from": "n_wait", "to": "n2"},
                ],
            },
            # ─── Conversation resolved ────────────────────────────────────────
            {
                "name": "Resolved rating",
                "trigger": "conversation_resolved",
                "enabled": False,
                "nodes": [
                    {"id": "trigger", "type": "trigger", "config": {"repeat": "once"}, "position": {"x": 0, "y": 0}},
                    {"id": "n1", "type": "emit_system_event", "config": {"content": "{agent_name} resolved the chat.", "visitor_content": "{agent_name} has resolved this conversation.", "event_type": "conversation_resolved_message", "send_to_visitor": True}, "position": {"x": 0, "y": 150}},
                    {"id": "n_wait", "type": "wait", "config": {"seconds": 2}, "position": {"x": 0, "y": 250}},
                    {"id": "n2", "type": "show_rating_popup", "config": {"event_type": "rating_popup_shown"}, "position": {"x": 0, "y": 350}},
                ],
                "edges": [
                    {"id": "e1", "from": "trigger", "to": "n1"},
                    {"id": "e_wait", "from": "n1", "to": "n_wait"},
                    {"id": "e2", "from": "n_wait", "to": "n2"},
                ],
            },
        ]

        try:
            existing_map: dict[tuple[str, str], Automation] = {
                (str(a.trigger or ""), str(a.name or "")): a
                for a in (
                    self.db.query(Automation)
                    .filter(Automation.website_id == website_id)
                    .all()
                )
            }
        except Exception:
            existing_map = {}

        changed = False
        for payload in defaults:
            trigger = payload.get("trigger")
            name = payload.get("name")
            if not trigger or not name:
                continue
            key = (str(trigger), str(name))
            try:
                if key in existing_map:
                    # Sync nodes/edges/category from seed; preserve user-set enabled.
                    record = existing_map[key]
                    record.nodes = payload.get("nodes") or []
                    record.edges = payload.get("edges") or []
                    record.category = str(payload.get("category") or "auto_message")
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(record, "nodes")
                    flag_modified(record, "edges")
                    changed = True
                else:
                    automation = Automation(
                        website_id=website_id,
                        name=str(name),
                        trigger=str(trigger),
                        enabled=bool(payload.get("enabled", True)),
                        category=str(payload.get("category") or "auto_message"),
                        nodes=payload.get("nodes") or [],
                        edges=payload.get("edges") or [],
                    )
                    self.db.add(automation)
                    changed = True
            except Exception:
                continue

        if changed:
            self.db.commit()
