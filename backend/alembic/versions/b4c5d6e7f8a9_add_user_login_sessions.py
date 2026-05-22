"""add_user_login_sessions

Revision ID: b4c5d6e7f8a9
Revises: c7d8e9f0a1b2
Create Date: 2026-05-22 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'b4c5d6e7f8a9'
down_revision = 'c7d8e9f0a1b2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_login_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column(
            'last_used_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
        ),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['user_id'], ['users.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_login_sessions_jti', 'user_login_sessions', ['jti'], unique=True)
    op.create_index('ix_user_login_sessions_user_id', 'user_login_sessions', ['user_id'])


def downgrade():
    op.drop_index('ix_user_login_sessions_user_id', table_name='user_login_sessions')
    op.drop_index('ix_user_login_sessions_jti', table_name='user_login_sessions')
    op.drop_table('user_login_sessions')
