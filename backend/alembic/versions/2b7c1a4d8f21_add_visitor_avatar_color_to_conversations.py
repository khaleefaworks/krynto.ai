"""Add visitor avatar color to conversations

Revision ID: 2b7c1a4d8f21
Revises: 19f7e4a4c1aa
Create Date: 2026-02-18

"""

from __future__ import annotations

import hashlib

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "2b7c1a4d8f21"
down_revision = "19f7e4a4c1aa"
branch_labels = None
depends_on = None


AVATAR_COLOR_PALETTE = (
    "#DBEAFE",  # blue-100
    "#D1FAE5",  # emerald-100
    "#FEF3C7",  # amber-100
    "#FFE4E6",  # rose-100
    "#E0E7FF",  # indigo-100
    "#CFFAFE",  # cyan-100
    "#EDE9FE",  # violet-100
    "#F1F5F9",  # slate-100
)


def _pick_avatar_color(seed: str) -> str:
    s = str(seed or "").encode("utf-8")
    digest = hashlib.md5(s).hexdigest()
    idx = int(digest, 16) % len(AVATAR_COLOR_PALETTE)
    return AVATAR_COLOR_PALETTE[idx]


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("visitor_avatar_color", sa.String(length=16), nullable=True),
    )

    # Best-effort backfill for existing rows.
    conn = op.get_bind()

    rows = conn.execute(
        sa.text(
            """
            SELECT id, session_id
            FROM conversations
            WHERE visitor_avatar_color IS NULL
            """
        )
    ).fetchall()

    for row in rows:
        conv_id = getattr(row, "id", row[0])
        session_id = getattr(row, "session_id", row[1])
        color = _pick_avatar_color(str(session_id))
        conn.execute(
            sa.text(
                """
                UPDATE conversations
                SET visitor_avatar_color = :color
                WHERE id = :id
                """
            ),
            {"color": color, "id": conv_id},
        )


def downgrade() -> None:
    op.drop_column("conversations", "visitor_avatar_color")
