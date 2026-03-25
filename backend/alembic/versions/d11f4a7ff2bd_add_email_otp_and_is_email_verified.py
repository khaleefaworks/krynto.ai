"""add_email_otp_and_is_email_verified

Revision ID: d11f4a7ff2bd
Revises: b1c2d3e4f5a6
Create Date: 2026-03-25 15:39:16.202345

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd11f4a7ff2bd'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade():
    # Create the email_otps table for OTP-based email verification
    op.create_table(
        'email_otps',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('otp_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_email_otps_id'), 'email_otps', ['id'], unique=False)
    op.create_index(op.f('ix_email_otps_user_id'), 'email_otps', ['user_id'], unique=False)

    # Add is_email_verified to users (default True so existing accounts are unaffected)
    op.add_column(
        'users',
        sa.Column('is_email_verified', sa.Boolean(), server_default='true', nullable=False),
    )


def downgrade():
    op.drop_column('users', 'is_email_verified')
    op.drop_index(op.f('ix_email_otps_user_id'), table_name='email_otps')
    op.drop_index(op.f('ix_email_otps_id'), table_name='email_otps')
    op.drop_table('email_otps')
