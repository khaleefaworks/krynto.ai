"""add category to automations

Revision ID: c9d1e2f3a4b5
Revises: a2b3c4d5e6f7
Create Date: 2026-04-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = 'c9d1e2f3a4b5'
down_revision: Union[str, None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add category column with a safe default for all existing rows.
    op.add_column(
        'automations',
        sa.Column(
            'category',
            sa.String(50),
            nullable=False,
            server_default='auto_message',
        ),
    )

    # Backfill: rows that contain a bot_prompt_buttons action belong to chatbot_flow.
    # Matching on trigger = 'conversation_created' with bot_prompt_buttons in actions
    # is a reliable heuristic for all existing data.
    op.execute(
        text(
            "UPDATE automations SET category = 'chatbot_flow' "
            "WHERE trigger = 'conversation_created' "
            "AND actions::text LIKE '%bot_prompt_buttons%'"
        )
    )


def downgrade() -> None:
    op.drop_column('automations', 'category')
