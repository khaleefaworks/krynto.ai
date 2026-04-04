"""Add short_id to conversations

Revision ID: a3f7e2c1b9d4
Revises: d11f4a7ff2bd
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa
import secrets
import string

# revision identifiers, used by Alembic.
revision = 'a3f7e2c1b9d4'
down_revision = 'd11f4a7ff2bd'
branch_labels = None
depends_on = None

_ALPHABET = string.ascii_letters + string.digits
_LENGTH = 8


def _generate_short_id():
    return ''.join(secrets.choice(_ALPHABET) for _ in range(_LENGTH))


def upgrade() -> None:
    # Step 1: Add column as nullable first
    op.add_column('conversations', sa.Column('short_id', sa.String(16), nullable=True))

    # Step 2: Backfill existing rows with unique short_ids
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM conversations WHERE short_id IS NULL")).fetchall()
    used = set()
    for (row_id,) in rows:
        while True:
            sid = _generate_short_id()
            if sid not in used:
                used.add(sid)
                break
        conn.execute(
            sa.text("UPDATE conversations SET short_id = :sid WHERE id = :rid"),
            {"sid": sid, "rid": row_id},
        )

    # Step 3: Make non-nullable and add unique index
    op.alter_column('conversations', 'short_id', nullable=False)
    op.create_index('ix_conversations_short_id', 'conversations', ['short_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_conversations_short_id', table_name='conversations')
    op.drop_column('conversations', 'short_id')
