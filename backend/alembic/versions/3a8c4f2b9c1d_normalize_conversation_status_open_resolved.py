"""normalize_conversation_status_open_resolved

Revision ID: 3a8c4f2b9c1d
Revises: 2fdc0fc683ab
Create Date: 2026-01-08

"""

from alembic import op
import sqlalchemy as sa
import re


# revision identifiers, used by Alembic.
revision = "3a8c4f2b9c1d"
down_revision = "2fdc0fc683ab"
branch_labels = None
depends_on = None


def _get_pg_enum_type_for_column(bind, table: str, column: str) -> str | None:
    """Return enum type name if the column is backed by a Postgres enum, else None."""
    row = bind.execute(
        sa.text(
            """
            SELECT t.typname
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_type t ON t.oid = a.atttypid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = :table
              AND a.attname = :column
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND t.typtype = 'e'
            """
        ),
        {"table": table, "column": column},
    ).fetchone()
    if not row:
        return None
    return str(row[0])


def upgrade():
    bind = op.get_bind()
    sa.inspect(bind)

    enum_type = None
    try:
        enum_type = _get_pg_enum_type_for_column(bind, "conversations", "status")
    except Exception:
        enum_type = None

    # If status is an enum (commonly 'conversation_status'), ensure it accepts 'open'/'resolved'.
    if enum_type:
        # Basic safety: type names should be simple identifiers.
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", enum_type):
            return

        enum_type_literal = enum_type.replace("'", "''")

        # Add enum values if missing (idempotent DO-block)
        # Postgres enum value additions cannot run inside a transaction block.
        ctx = op.get_context()
        with ctx.autocommit_block():
            op.execute(
                f"""
                DO $$
                DECLARE
                    t text := '{enum_type_literal}';
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_enum e
                        JOIN pg_type tt ON tt.oid = e.enumtypid
                        WHERE tt.typname = t AND e.enumlabel = 'open'
                    ) THEN
                        EXECUTE 'ALTER TYPE ' || quote_ident(t) || ' ADD VALUE ' || quote_literal('open');
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1
                        FROM pg_enum e
                        JOIN pg_type tt ON tt.oid = e.enumtypid
                        WHERE tt.typname = t AND e.enumlabel = 'resolved'
                    ) THEN
                        EXECUTE 'ALTER TYPE ' || quote_ident(t) || ' ADD VALUE ' || quote_literal('resolved');
                    END IF;
                END $$;
                """
            )

        # Now that enum supports them, normalize stored values.
        op.execute(
            """
            UPDATE conversations
            SET status = CASE
                WHEN status IN ('active', 'offline') THEN 'open'
                WHEN status = 'closed' THEN 'resolved'
                ELSE status
            END
            """
        )

        # Ensure default is 'open' where possible.
        try:
            op.execute("ALTER TABLE conversations ALTER COLUMN status SET DEFAULT 'open'")
        except Exception:
            pass

    else:
        # Non-enum (string) column: normalize values directly.
        op.execute(
            """
            UPDATE conversations
            SET status = CASE
                WHEN status IN ('active', 'offline') THEN 'open'
                WHEN status = 'closed' THEN 'resolved'
                ELSE status
            END
            """
        )


def downgrade():
    # Non-trivial to safely remove enum values in Postgres; leave as-is.
    pass
