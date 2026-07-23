"""Add awaiting_confirmation/cancelled to lead_delivery_status enum.

Revision ID: 9d1c2b3a4f5e
Revises: 5e71ecb6a96c
Create Date: 2026-07-21 00:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '9d1c2b3a4f5e'
down_revision = '5e71ecb6a96c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres requires each new enum value added outside the transaction
    # that will use it — fine here since this migration only adds values.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE lead_delivery_status ADD VALUE IF NOT EXISTS 'awaiting_confirmation'")
        op.execute("ALTER TYPE lead_delivery_status ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade() -> None:
    # Postgres can't drop individual enum values; rows using the new
    # statuses would need to be migrated back to 'failed' first if this
    # ever needs to be reversed. Left as a no-op like other enum-add
    # migrations in this project.
    pass
