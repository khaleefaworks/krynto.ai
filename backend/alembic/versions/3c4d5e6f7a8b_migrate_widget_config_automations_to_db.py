"""migrate widget_config.automations into DB automations

Revision ID: 3c4d5e6f7a8b
Revises: 2f3e4d5c6b7a
Create Date: 2026-02-11

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "3c4d5e6f7a8b"
down_revision = "2f3e4d5c6b7a"
branch_labels = None
depends_on = None


def _as_int(value, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default


def upgrade() -> None:
    bind = op.get_bind()
    meta = sa.MetaData()

    websites = sa.Table(
        "websites",
        meta,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("widget_config", sa.JSON),
    )

    automations = sa.Table(
        "automations",
        meta,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("website_id", sa.Integer, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("trigger", sa.String(length=100), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False),
        sa.Column("conditions", sa.JSON),
        sa.Column("actions", sa.JSON),
    )

    default_welcome = "Hi! How can we help you today?"
    default_closing = "Thanks! This conversation is now closed."

    rows = list(bind.execute(sa.select(websites.c.id, websites.c.widget_config)).fetchall())

    for website_id, widget_config in rows:
        cfg = widget_config if isinstance(widget_config, dict) else {}
        legacy = cfg.get("automations") if isinstance(cfg.get("automations"), dict) else None

        # If no legacy automations config exists, still ensure the key is removed (noop)
        # and keep moving.

        # --- Welcome (visitor_connected) ---
        if legacy is not None:
            welcome_enabled = legacy.get("welcome_enabled")
            if welcome_enabled is None:
                welcome_enabled = True

            welcome_message = legacy.get("welcome_message")
            if not (isinstance(welcome_message, str) and welcome_message.strip()):
                welcome_message = cfg.get("welcome_message")
            if not (isinstance(welcome_message, str) and welcome_message.strip()):
                welcome_message = default_welcome
            welcome_message = str(welcome_message).strip()

            cooldown_hours = legacy.get("welcome_cooldown_hours")
            cooldown_hours = max(1, _as_int(cooldown_hours, 24))

            existing = bind.execute(
                sa.select(automations.c.id)
                .where(
                    sa.and_(
                        automations.c.website_id == int(website_id),
                        automations.c.trigger == "visitor_connected",
                    )
                )
                .limit(1)
            ).first()

            if existing is None:
                bind.execute(
                    automations.insert().values(
                        website_id=int(website_id),
                        name="Welcome message",
                        trigger="visitor_connected",
                        enabled=bool(welcome_enabled),
                        conditions={"cooldown_hours": int(cooldown_hours)},
                        actions=[
                            {
                                "type": "send_bot_message",
                                "message": welcome_message,
                                "event_type": "automation_welcome",
                            }
                        ],
                    )
                )

        # --- Closing (conversation_resolved) ---
        if legacy is not None:
            closing_enabled = legacy.get("closing_enabled")
            if closing_enabled is None:
                closing_enabled = False

            closing_message = legacy.get("closing_message")
            if not (isinstance(closing_message, str) and closing_message.strip()):
                closing_message = default_closing
            closing_message = str(closing_message).strip()

            existing_row = bind.execute(
                sa.select(
                    automations.c.id,
                    automations.c.enabled,
                    automations.c.actions,
                ).where(
                    sa.and_(
                        automations.c.website_id == int(website_id),
                        automations.c.trigger == "conversation_resolved",
                    )
                )
                .limit(1)
            ).first()

            if existing_row is None:
                bind.execute(
                    automations.insert().values(
                        website_id=int(website_id),
                        name="Closing message",
                        trigger="conversation_resolved",
                        enabled=bool(closing_enabled),
                        conditions={},
                        actions=[
                            {
                                "type": "send_bot_message",
                                "message": closing_message,
                                "event_type": "bot_closing",
                            }
                        ],
                    )
                )
            else:
                # Only overwrite the seeded default closing automation.
                # If an admin edited it already, we leave it unchanged.
                existing_id, existing_enabled, existing_actions = existing_row
                first_msg = None
                if isinstance(existing_actions, list) and existing_actions:
                    a0 = existing_actions[0]
                    if isinstance(a0, dict):
                        first_msg = a0.get("message")

                looks_default = (existing_enabled is False) and (
                    (first_msg is None) or (str(first_msg).strip() in {"", default_closing})
                )

                if looks_default and (bool(closing_enabled) or closing_message != default_closing):
                    bind.execute(
                        automations.update()
                        .where(automations.c.id == int(existing_id))
                        .values(
                            enabled=bool(closing_enabled),
                            actions=[
                                {
                                    "type": "send_bot_message",
                                    "message": closing_message,
                                    "event_type": "bot_closing",
                                }
                            ],
                        )
                    )

        # --- Cleanup: remove legacy key ---
        if isinstance(cfg, dict) and "automations" in cfg:
            next_cfg = dict(cfg)
            try:
                next_cfg.pop("automations", None)
            except Exception:
                next_cfg = cfg
            bind.execute(
                websites.update().where(websites.c.id == int(website_id)).values(widget_config=next_cfg)
            )


def downgrade() -> None:
    # Non-reversible cleanup: we do not reconstruct widget_config.automations.
    pass
