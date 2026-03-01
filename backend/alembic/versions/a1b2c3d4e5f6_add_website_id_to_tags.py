"""add_website_id_to_tags

Revision ID: a1b2c3d4e5f6
Revises: 2b7c1a4d8f21
Create Date: 2026-01-20

Scopes tags to individual websites by adding a website_id FK.
Existing tags are assigned to the first website (lowest id).
Changes unique constraint from (name) to (name, website_id).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text, inspect


revision = "a1b2c3d4e5f6"
down_revision = "2b7c1a4d8f21"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    # 1) Add website_id column (nullable first for backfill)
    op.add_column("tags", sa.Column("website_id", sa.Integer(), nullable=True))

    # 2) Backfill existing tags: assign to the lowest-ID website
    first_website = bind.execute(
        text("SELECT id FROM websites ORDER BY id LIMIT 1")
    ).scalar()

    if first_website is not None:
        bind.execute(
            text("UPDATE tags SET website_id = :wid WHERE website_id IS NULL"),
            {"wid": first_website},
        )
    else:
        # No websites exist – delete orphaned tags
        bind.execute(text("DELETE FROM conversation_tags WHERE tag_id IN (SELECT id FROM tags WHERE website_id IS NULL)"))
        bind.execute(text("DELETE FROM tags WHERE website_id IS NULL"))

    # 3) Make website_id NOT NULL
    op.alter_column("tags", "website_id", nullable=False)

    # 4) Add FK constraint
    op.create_foreign_key(
        "fk_tags_website_id",
        "tags",
        "websites",
        ["website_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 5) Drop old unique constraint on name, add composite unique on (name, website_id)
    # Find and drop the existing unique constraint on name
    inspector = inspect(bind)
    uqs = inspector.get_unique_constraints("tags")
    for uq in uqs:
        cols = uq.get("column_names", [])
        if cols == ["name"]:
            op.drop_constraint(uq["name"], "tags", type_="unique")
            break

    op.create_unique_constraint("uq_tags_name_website", "tags", ["name", "website_id"])

    # 6) Add index on website_id for faster lookups
    op.create_index("ix_tags_website_id", "tags", ["website_id"])


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    # Drop index
    op.drop_index("ix_tags_website_id", table_name="tags")

    # Drop composite unique constraint
    uqs = {c["name"] for c in inspector.get_unique_constraints("tags") if c.get("name")}
    if "uq_tags_name_website" in uqs:
        op.drop_constraint("uq_tags_name_website", "tags", type_="unique")

    # Drop FK
    op.drop_constraint("fk_tags_website_id", "tags", type_="foreignkey")

    # Re-add simple unique constraint on name (best-effort; may fail if dupes exist)
    try:
        op.create_unique_constraint("tags_name_key", "tags", ["name"])
    except Exception:
        pass

    # Drop website_id column
    op.drop_column("tags", "website_id")
