"""add verification_tokens table

Revision ID: e7f8a9b0c1d2
Revises: 909696409db9
Create Date: 2026-05-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision = 'e7f8a9b0c1d2'
down_revision = '909696409db9'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'verification_tokens' not in existing_tables:
        op.create_table(
            'verification_tokens',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('token_hash', sa.String(length=64), nullable=False),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                'created_at',
                sa.DateTime(timezone=True),
                server_default=sa.text('now()'),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(
                ['user_id'], ['users.id'], ondelete='CASCADE'
            ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('token_hash'),
        )
        op.create_index(
            op.f('ix_verification_tokens_id'),
            'verification_tokens',
            ['id'],
            unique=False,
        )
        op.create_index(
            op.f('ix_verification_tokens_user_id'),
            'verification_tokens',
            ['user_id'],
            unique=False,
        )
        op.create_index(
            op.f('ix_verification_tokens_token_hash'),
            'verification_tokens',
            ['token_hash'],
            unique=True,
        )


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'verification_tokens' in existing_tables:
        op.drop_index(op.f('ix_verification_tokens_token_hash'), table_name='verification_tokens')
        op.drop_index(op.f('ix_verification_tokens_user_id'), table_name='verification_tokens')
        op.drop_index(op.f('ix_verification_tokens_id'), table_name='verification_tokens')
        op.drop_table('verification_tokens')
