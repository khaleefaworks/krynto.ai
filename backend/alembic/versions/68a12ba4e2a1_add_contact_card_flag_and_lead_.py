"""Add contact-card flag on website_forms and lead-integration tables.

Revision ID: 68a12ba4e2a1
Revises: 922726f41399
Create Date: 2026-07-17 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '68a12ba4e2a1'
down_revision = '922726f41399'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'website_forms',
        sa.Column('is_contact_card', sa.Boolean(), nullable=False, server_default='false'),
    )

    op.create_table(
        'website_integrations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('website_id', sa.Integer(), nullable=False),
        sa.Column('type', sa.Enum('webhook', name='website_integration_type'), nullable=False),
        sa.Column('name', sa.String(120), nullable=False, server_default=''),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['website_id'], ['websites.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_website_integrations_id', 'website_integrations', ['id'])
    op.create_index('ix_website_integrations_website_id', 'website_integrations', ['website_id'])

    op.create_table(
        'lead_integration_deliveries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('website_id', sa.Integer(), nullable=False),
        sa.Column('conversation_id', sa.Integer(), nullable=True),
        sa.Column('integration_id', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(30), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('status', sa.Enum('pending', 'sent', 'failed', name='lead_delivery_status'), nullable=False, server_default='pending'),
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_attempt_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('next_retry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['website_id'], ['websites.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['integration_id'], ['website_integrations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_lead_integration_deliveries_id', 'lead_integration_deliveries', ['id'])
    op.create_index('ix_lead_integration_deliveries_website_id', 'lead_integration_deliveries', ['website_id'])
    op.create_index('ix_lead_integration_deliveries_conversation_id', 'lead_integration_deliveries', ['conversation_id'])
    op.create_index('ix_lead_integration_deliveries_integration_id', 'lead_integration_deliveries', ['integration_id'])
    op.create_index('ix_lead_integration_deliveries_created_at', 'lead_integration_deliveries', ['created_at'])
    op.create_index('ix_lead_integration_deliveries_next_retry_at', 'lead_integration_deliveries', ['next_retry_at'])


def downgrade() -> None:
    op.drop_index('ix_lead_integration_deliveries_next_retry_at', table_name='lead_integration_deliveries')
    op.drop_index('ix_lead_integration_deliveries_created_at', table_name='lead_integration_deliveries')
    op.drop_index('ix_lead_integration_deliveries_integration_id', table_name='lead_integration_deliveries')
    op.drop_index('ix_lead_integration_deliveries_conversation_id', table_name='lead_integration_deliveries')
    op.drop_index('ix_lead_integration_deliveries_website_id', table_name='lead_integration_deliveries')
    op.drop_index('ix_lead_integration_deliveries_id', table_name='lead_integration_deliveries')
    op.drop_table('lead_integration_deliveries')
    op.execute('DROP TYPE IF EXISTS lead_delivery_status')

    op.drop_index('ix_website_integrations_website_id', table_name='website_integrations')
    op.drop_index('ix_website_integrations_id', table_name='website_integrations')
    op.drop_table('website_integrations')
    op.execute('DROP TYPE IF EXISTS website_integration_type')

    op.drop_column('website_forms', 'is_contact_card')
