"""Add backups table for SA2 backup/restore tracking.

Revision ID: 922726f41399
Revises: f1a2b3c4d5e6
Create Date: 2026-07-10 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '922726f41399'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'backups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('alembic_revision', sa.String(32), nullable=True),
        sa.Column('git_commit', sa.String(40), nullable=True),
        sa.Column('status', sa.Enum('in_progress', 'completed', 'failed', name='backup_status'), nullable=False, server_default='in_progress'),
        sa.Column('triggered_by', sa.Enum('scheduled', 'manual', 'pre_restore_safety', name='backup_trigger'), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('filename'),
    )
    op.create_index('ix_backups_id', 'backups', ['id'])
    op.create_index('ix_backups_created_at', 'backups', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_backups_created_at', table_name='backups')
    op.drop_index('ix_backups_id', table_name='backups')
    op.drop_table('backups')
    op.execute('DROP TYPE IF EXISTS backup_status')
    op.execute('DROP TYPE IF EXISTS backup_trigger')
