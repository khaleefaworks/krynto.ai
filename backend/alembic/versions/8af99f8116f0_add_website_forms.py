"""add_website_forms

Revision ID: 8af99f8116f0
Revises: c9d1e2f3a4b5
Create Date: 2026-04-28 09:59:55.726985

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '8af99f8116f0'
down_revision = 'c9d1e2f3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'website_forms',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('website_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('slug', sa.String(length=60), nullable=False),
        sa.Column('fields', sa.JSON(), nullable=False),
        sa.Column('submit_label', sa.String(length=80), server_default='Send', nullable=False),
        sa.Column('enabled', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['website_id'], ['websites.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_website_forms_website_id'), 'website_forms', ['website_id'], unique=False)

    op.create_table(
        'website_form_submissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('form_id', sa.Integer(), nullable=False),
        sa.Column('conversation_id', sa.Integer(), nullable=True),
        sa.Column('session_id', sa.String(length=255), nullable=True),
        sa.Column('data', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['conversation_id'], ['conversations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['form_id'], ['website_forms.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_website_form_submissions_conversation_id'), 'website_form_submissions', ['conversation_id'], unique=False)
    op.create_index(op.f('ix_website_form_submissions_form_id'), 'website_form_submissions', ['form_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_website_form_submissions_form_id'), table_name='website_form_submissions')
    op.drop_index(op.f('ix_website_form_submissions_conversation_id'), table_name='website_form_submissions')
    op.drop_table('website_form_submissions')
    op.drop_index(op.f('ix_website_forms_website_id'), table_name='website_forms')
    op.drop_table('website_forms')
