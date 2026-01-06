"""missing revision placeholder

Revision ID: 7b896e76a93d
Revises: eeb28dc4e63a
Create Date: 2026-01-06

This file exists to restore a missing Alembic revision that is referenced by
existing migrations (e.g. 6168d0a84d56). The original revision file was not
present in the repository; this placeholder is a no-op to allow Alembic to
resolve the revision graph.

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "7b896e76a93d"
down_revision = "eeb28dc4e63a"
branch_labels = None
depends_on = None


def upgrade():
    # No-op placeholder
    pass


def downgrade():
    # No-op placeholder
    pass
