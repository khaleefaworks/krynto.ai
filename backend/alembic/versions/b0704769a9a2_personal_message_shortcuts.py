"""personal message shortcuts

Revision ID: b0704769a9a2
Revises: 6a1d2c3e4f50
Create Date: 2026-01-13 13:20:47.481084

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = 'b0704769a9a2'
down_revision = '6a1d2c3e4f50'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    # Add new columns first (nullable user_id so we can backfill)
    with op.batch_alter_table('message_shortcuts') as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')))

    # Pick an owner for existing shortcuts (best-effort: SYSTEM_MANAGER -> MANAGER -> any user)
    owner_id = bind.execute(
        text(
            """
            SELECT id
            FROM users
            ORDER BY
              CASE role
                WHEN 'system_manager' THEN 0
                WHEN 'manager' THEN 1
                ELSE 2
              END,
              id ASC
            LIMIT 1
            """
        )
    ).scalar()

    if owner_id is not None:
        bind.execute(text("UPDATE message_shortcuts SET user_id = :uid WHERE user_id IS NULL"), {"uid": owner_id})

        # Normalize shortcuts to remove leading '/' or '.' and trim whitespace
        rows = bind.execute(text("SELECT id, shortcut FROM message_shortcuts"))
        updates: list[tuple[int, str]] = []
        for row in rows:
            sid = int(row[0])
            raw = (row[1] or "").strip()
            normalized = raw.lstrip("/.").strip()
            if not normalized:
                # Keep as-is; API will reject empty values on future edits
                continue
            if normalized != raw:
                updates.append((sid, normalized))

        for sid, normalized in updates:
            bind.execute(
                text("UPDATE message_shortcuts SET shortcut = :s WHERE id = :id"),
                {"s": normalized, "id": sid},
            )

        # Deduplicate by (user_id, shortcut) before adding the unique constraint
        dup_rows = bind.execute(
            text(
                """
                SELECT user_id, shortcut
                FROM message_shortcuts
                WHERE user_id IS NOT NULL
                GROUP BY user_id, shortcut
                HAVING COUNT(*) > 1
                """
            )
        ).fetchall()
        for user_id, shortcut in dup_rows:
            ids = bind.execute(
                text(
                    """
                    SELECT id
                    FROM message_shortcuts
                    WHERE user_id = :uid AND shortcut = :s
                    ORDER BY id ASC
                    """
                ),
                {"uid": user_id, "s": shortcut},
            ).fetchall()
            # Keep first, delete the rest
            for (delete_id,) in ids[1:]:
                bind.execute(text("DELETE FROM message_shortcuts WHERE id = :id"), {"id": int(delete_id)})

    # Restructure columns/constraints
    with op.batch_alter_table('message_shortcuts') as batch_op:
        # Drop old constraints/indexes if present
        batch_op.drop_index('ix_message_shortcuts_website_id')
        batch_op.drop_constraint('uq_website_shortcut', type_='unique')

        # Drop website_id column
        batch_op.drop_column('website_id')

        # Add FK + new uniqueness/indexing
        batch_op.create_foreign_key('fk_message_shortcuts_user_id_users', 'users', ['user_id'], ['id'], ondelete='CASCADE')
        batch_op.create_unique_constraint('uq_user_shortcut', ['user_id', 'shortcut'])
        batch_op.create_index('ix_message_shortcuts_user_id', ['user_id'])

        # Enforce non-null user_id once data is backfilled (if no users existed, leave nullable)
        if owner_id is not None:
            batch_op.alter_column('user_id', existing_type=sa.Integer(), nullable=False)


def downgrade():
    bind = op.get_bind()

    # Re-add website_id (nullable to allow downgrade even without websites)
    with op.batch_alter_table('message_shortcuts') as batch_op:
        batch_op.add_column(sa.Column('website_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_message_shortcuts_website_id_websites', 'websites', ['website_id'], ['id'], ondelete='CASCADE')

    # Best-effort: assign all shortcuts to the first website
    website_id = bind.execute(text("SELECT id FROM websites ORDER BY id ASC LIMIT 1")).scalar()
    if website_id is not None:
        bind.execute(text("UPDATE message_shortcuts SET website_id = :wid WHERE website_id IS NULL"), {"wid": website_id})

    with op.batch_alter_table('message_shortcuts') as batch_op:
        batch_op.drop_index('ix_message_shortcuts_user_id')
        batch_op.drop_constraint('uq_user_shortcut', type_='unique')
        batch_op.drop_constraint('fk_message_shortcuts_user_id_users', type_='foreignkey')
        batch_op.drop_column('user_id')
        batch_op.drop_column('is_active')

        # Restore old uniqueness/index
        batch_op.create_unique_constraint('uq_website_shortcut', ['website_id', 'shortcut'])
        batch_op.create_index('ix_message_shortcuts_website_id', ['website_id'])

        # Make website_id non-null again if we could backfill
        if website_id is not None:
            batch_op.alter_column('website_id', existing_type=sa.Integer(), nullable=False)
