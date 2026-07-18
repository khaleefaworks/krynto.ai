"""add form_id to website_integrations

Revision ID: a4996ac54d46
Revises: 2043d1f9bf0d
Create Date: 2026-07-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a4996ac54d46'
down_revision = '2043d1f9bf0d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'website_integrations',
        sa.Column('form_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_website_integrations_form_id',
        'website_integrations', 'website_forms',
        ['form_id'], ['id'],
        ondelete='CASCADE',
    )
    op.create_index(
        'ix_website_integrations_form_id',
        'website_integrations', ['form_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_website_integrations_form_id', table_name='website_integrations')
    op.drop_constraint('fk_website_integrations_form_id', 'website_integrations', type_='foreignkey')
    op.drop_column('website_integrations', 'form_id')
