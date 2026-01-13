"""missing revision placeholder

Revision ID: ab993fa219ef
Revises: 166e4553df6c
Create Date: 2026-01-06

This placeholder restores a missing Alembic revision referenced by existing
migrations (e.g. c6557a7eeeb7). The original file was not present in the
repository. This is a no-op migration used to repair the revision graph.

"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "ab993fa219ef"
down_revision = "166e4553df6c"
branch_labels = None
depends_on = None


def upgrade():
    # No-op placeholder
    pass


def downgrade():
    # No-op placeholder
    pass
