"""merge heads (phase0 hygiene)

Revision ID: 2fdc0fc683ab
Revises: 1b2c3d4e5f60, 46963d838181, 65f8a6004dce, ed71c38d8e14
Create Date: 2026-01-08

This is a no-op merge revision to ensure the Alembic history has a single head.

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "2fdc0fc683ab"
down_revision = (
    "1b2c3d4e5f60",
    "46963d838181",
    "65f8a6004dce",
    "ed71c38d8e14",
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
