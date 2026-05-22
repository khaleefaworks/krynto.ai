"""fix open session unique index to exclude visitor_ended conversations

Allow a new open conversation to be created for a session whose previous
conversation was ended by the visitor (visitor_ended=True, status='open').

The old index  WHERE status = 'open'  blocked the INSERT because the
visitor_ended conversation still held the unique slot.

Revision ID: f0a1b2c3d4e5
Revises: b4c5d6e7f8a9
Create Date: 2026-05-22 00:00:00.000000
"""

from alembic import op

revision = 'f0a1b2c3d4e5'
down_revision = 'b4c5d6e7f8a9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old partial index that only filtered on status='open'.
    op.execute("DROP INDEX IF EXISTS conversations_open_session_unique")

    # Recreate with an additional visitor_ended=FALSE predicate so that
    # conversations ended by the visitor no longer occupy the unique slot.
    op.execute(
        """
        CREATE UNIQUE INDEX conversations_open_session_unique
        ON conversations (website_id, session_id)
        WHERE status = 'open' AND visitor_ended = FALSE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS conversations_open_session_unique")
    op.execute(
        """
        CREATE UNIQUE INDEX conversations_open_session_unique
        ON conversations (website_id, session_id)
        WHERE status = 'open'
        """
    )
