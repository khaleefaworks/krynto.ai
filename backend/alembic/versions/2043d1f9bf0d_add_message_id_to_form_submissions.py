"""Link WebsiteFormSubmission to the specific message/card it was submitted for.

Revision ID: 2043d1f9bf0d
Revises: 68a12ba4e2a1
Create Date: 2026-07-17 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '2043d1f9bf0d'
down_revision = '68a12ba4e2a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'website_form_submissions',
        sa.Column('message_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_website_form_submissions_message_id',
        'website_form_submissions', 'messages',
        ['message_id'], ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_website_form_submissions_message_id',
        'website_form_submissions', ['message_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_website_form_submissions_message_id', table_name='website_form_submissions')
    op.drop_constraint('fk_website_form_submissions_message_id', 'website_form_submissions', type_='foreignkey')
    op.drop_column('website_form_submissions', 'message_id')
