"""global_tags_and_conversation_tag_fk

Revision ID: 6a1d2c3e4f50
Revises: 47762e1c8c30
Create Date: 2026-01-13

This migration introduces global tags (shared across all websites) and
upgrades conversation tag associations to use a foreign key to tags.

It is written defensively because earlier branches may or may not have
created the old `conversation_tags.tag_name` schema.

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision = "6a1d2c3e4f50"
down_revision = "47762e1c8c30"
branch_labels = None
depends_on = None


def _has_table(inspector, name: str) -> bool:
    try:
        return name in inspector.get_table_names()
    except Exception:
        return False


def _existing_index_names(inspector, table: str) -> set[str]:
    try:
        return {i.get("name") for i in inspector.get_indexes(table) if i.get("name")}
    except Exception:
        return set()


def _existing_unique_constraint_names(inspector, table: str) -> set[str]:
    try:
        return {c.get("name") for c in inspector.get_unique_constraints(table) if c.get("name")}
    except Exception:
        return set()


def _existing_fk_names(inspector, table: str) -> set[str]:
    try:
        return {fk.get("name") for fk in inspector.get_foreign_keys(table) if fk.get("name")}
    except Exception:
        return set()


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)

    # 1) Global tags table
    if not _has_table(inspector, "tags"):
        op.create_table(
            "tags",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=100), nullable=False, unique=True),
            sa.Column("color", sa.String(length=7), nullable=False, server_default="#000000"),
            sa.Column("description", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    # Refresh inspector after potential DDL
    inspector = inspect(bind)

    # 2) conversation_tags association table
    if not _has_table(inspector, "conversation_tags"):
        op.create_table(
            "conversation_tags",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tag_id", sa.Integer(), sa.ForeignKey("tags.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        )
        # Create index/constraint only if not already present (idempotent safety)
        inspector = inspect(bind)
        idx = _existing_index_names(inspector, "conversation_tags")
        uqs = _existing_unique_constraint_names(inspector, "conversation_tags")
        if "ix_conversation_tags_conversation_id" not in idx:
            op.create_index("ix_conversation_tags_conversation_id", "conversation_tags", ["conversation_id"])
        if "uq_conversation_tags_conversation_tag" not in uqs:
            op.create_unique_constraint("uq_conversation_tags_conversation_tag", "conversation_tags", ["conversation_id", "tag_id"])
        return

    cols = {c.get("name") for c in inspector.get_columns("conversation_tags")}
    idx_existing = _existing_index_names(inspector, "conversation_tags")
    uq_existing = _existing_unique_constraint_names(inspector, "conversation_tags")
    fk_existing = _existing_fk_names(inspector, "conversation_tags")

    # If older schema exists with tag_name, migrate it.
    if "tag_name" in cols and "tag_id" not in cols:
        op.add_column("conversation_tags", sa.Column("tag_id", sa.Integer(), nullable=True))
        cols.add("tag_id")

    # Backfill tag_id from tag_name if present.
    if "tag_name" in cols and "tag_id" in cols:
        # Create tags for distinct names (best-effort).
        try:
            names = [
                r[0]
                for r in bind.execute(text("SELECT DISTINCT tag_name FROM conversation_tags WHERE tag_name IS NOT NULL"))
                .fetchall()
            ]
        except Exception:
            names = []

        for name in names:
            if not name:
                continue
            try:
                bind.execute(
                    text(
                        "INSERT INTO tags (name, color) "
                        "SELECT :name, :color "
                        "WHERE NOT EXISTS (SELECT 1 FROM tags WHERE name = :name)"
                    ),
                    {"name": str(name), "color": "#000000"},
                )
            except Exception:
                # Ignore if unique constraint already satisfied or DB doesn't support the statement.
                pass

        # Update conversation_tags.tag_id using the tags lookup.
        try:
            bind.execute(
                text(
                    "UPDATE conversation_tags "
                    "SET tag_id = (SELECT tags.id FROM tags WHERE tags.name = conversation_tags.tag_name) "
                    "WHERE tag_id IS NULL AND tag_name IS NOT NULL"
                )
            )
        except Exception:
            pass

    # Ensure FK + constraints; drop tag_name if present.
    # Use batch_alter_table for SQLite compatibility.
    with op.batch_alter_table("conversation_tags") as batch:
        # Add FK if missing
        if "tag_id" in cols:
            if "fk_conversation_tags_tag_id" not in fk_existing:
                try:
                    batch.create_foreign_key(
                        "fk_conversation_tags_tag_id",
                        "tags",
                        ["tag_id"],
                        ["id"],
                        ondelete="CASCADE",
                    )
                except Exception:
                    pass

        # Unique constraint on (conversation_id, tag_id)
        if "uq_conversation_tags_conversation_tag" not in uq_existing:
            try:
                batch.create_unique_constraint(
                    "uq_conversation_tags_conversation_tag",
                    ["conversation_id", "tag_id"],
                )
            except Exception:
                pass

        # Index on conversation_id
        if "ix_conversation_tags_conversation_id" not in idx_existing:
            try:
                batch.create_index("ix_conversation_tags_conversation_id", ["conversation_id"])
            except Exception:
                pass

        if "tag_name" in cols:
            try:
                batch.drop_column("tag_name")
            except Exception:
                pass

        # Make tag_id non-null if possible.
        if "tag_id" in cols:
            try:
                batch.alter_column("tag_id", existing_type=sa.Integer(), nullable=False)
            except Exception:
                # Some DBs/SQLite may not allow if NULLs exist; keep nullable.
                pass


def downgrade():
    # Best-effort downgrade: keep data but revert schema where possible.
    bind = op.get_bind()
    inspector = inspect(bind)

    if _has_table(inspector, "conversation_tags"):
        cols = {c.get("name") for c in inspector.get_columns("conversation_tags")}
        with op.batch_alter_table("conversation_tags") as batch:
            if "tag_name" not in cols:
                try:
                    batch.add_column(sa.Column("tag_name", sa.String(length=100), nullable=True))
                except Exception:
                    pass

    # Do not drop the global tags table automatically (would be destructive).
    # If you truly need to remove it, do it manually.
