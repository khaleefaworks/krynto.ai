"""fix_conversation_row_explosion

Drop the orphaned `mode` column and the dead `title` column from conversations.
Add a partial unique index on (website_id, session_id) WHERE status = 'open'
to prevent duplicate open conversations for the same session (race condition guard).

Revision ID: c7d8e9f0a1b2
Revises: f2a3b4c5d6e7
Create Date: 2025-01-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c7d8e9f0a1b2'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Drop orphaned column: conversations.mode
    #    This column exists in the DB but was removed from the SQLAlchemy
    #    model without a corresponding migration.
    #    Use IF EXISTS — some environments already had this column removed.
    # ------------------------------------------------------------------
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS mode")

    # ------------------------------------------------------------------
    # 2. Drop dead column: conversations.title
    #    Auto-generation of conversation titles from the first visitor
    #    message was intentionally removed. The column has been NULL in
    #    production since then.
    # ------------------------------------------------------------------
    op.drop_column('conversations', 'title')

    # ------------------------------------------------------------------
    # 3. Add partial unique index: one OPEN conversation per session.
    #    This prevents duplicate open rows for the same (website, session)
    #    pair that could be caused by a race condition when a visitor opens
    #    multiple WebSocket connections simultaneously before any INSERT
    #    commits.
    #
    #    PostgreSQL partial unique index:
    #      CREATE UNIQUE INDEX ... WHERE status = 'open'
    #    Only one row may exist per (website_id, session_id) while OPEN.
    #    Resolved / archived conversations are unaffected.
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE UNIQUE INDEX conversations_open_session_unique
        ON conversations (website_id, session_id)
        WHERE status = 'open'
        """
    )


def downgrade() -> None:
    # Remove the partial unique index.
    op.execute("DROP INDEX IF EXISTS conversations_open_session_unique")

    # Restore columns (nullable so existing rows are unaffected).
    op.add_column(
        'conversations',
        sa.Column('title', sa.String(120), nullable=True),
    )
    op.add_column(
        'conversations',
        sa.Column('mode', sa.String(17), nullable=True),
    )
