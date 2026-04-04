"""phase1_saas_multi_tenant_foundation

Adds the Organization model, multi-tenant foreign keys, conversation/user
columns required for the SaaS refactor, and the password-reset token table.

Revision ID: a1b2c3d4e5f7
Revises: 99c3eb5a95ca
Create Date: 2026-03-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f7'
down_revision = '99c3eb5a95ca'
branch_labels = None
depends_on = None


def upgrade():
    # ------------------------------------------------------------------
    # 1. organizations table
    # ------------------------------------------------------------------
    op.create_table(
        'organizations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('slug', sa.String(length=100), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=True),
        sa.Column('plan', sa.String(length=50), nullable=False, server_default='free'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('settings', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        # owner_id FK added after users table is patched (deferred below via add_column)
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)

    # ------------------------------------------------------------------
    # 2. Add OWNER to the user_role enum
    # ------------------------------------------------------------------
    # SQLite (tests): enums are plain VARCHAR — no ALTER TYPE needed.
    # PostgreSQL (prod): must extend the enum type.
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'owner' AFTER 'system_manager'")

    # ------------------------------------------------------------------
    # 3. users: add organization_id + password_changed_at
    # ------------------------------------------------------------------
    op.add_column(
        'users',
        sa.Column('organization_id', sa.Integer(), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_users_organization_id', 'users', ['organization_id'])
    op.create_foreign_key(
        'fk_users_organization_id',
        'users', 'organizations',
        ['organization_id'], ['id'],
        ondelete='SET NULL',
    )

    # ------------------------------------------------------------------
    # 4. Now add the deferred owner_id FK on organizations → users
    # ------------------------------------------------------------------
    op.create_foreign_key(
        'fk_organizations_owner_id',
        'organizations', 'users',
        ['owner_id'], ['id'],
        ondelete='SET NULL',
    )

    # ------------------------------------------------------------------
    # 5. websites: add organization_id + show_conversation_history
    # ------------------------------------------------------------------
    op.add_column(
        'websites',
        sa.Column('organization_id', sa.Integer(), nullable=True),
    )
    op.add_column(
        'websites',
        sa.Column(
            'show_conversation_history',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )
    op.create_index('ix_websites_organization_id', 'websites', ['organization_id'])
    op.create_foreign_key(
        'fk_websites_organization_id',
        'websites', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE',
    )

    # ------------------------------------------------------------------
    # 6. conversations: add closed_by
    # ------------------------------------------------------------------
    op.add_column(
        'conversations',
        sa.Column('closed_by', sa.String(length=20), nullable=True),
    )

    # ------------------------------------------------------------------
    # 7. password_reset_tokens table
    # ------------------------------------------------------------------
    op.create_table(
        'password_reset_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_password_reset_tokens_user_id', 'password_reset_tokens', ['user_id'])
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'], unique=True)


def downgrade():
    op.drop_table('password_reset_tokens')
    op.drop_column('conversations', 'closed_by')
    op.drop_constraint('fk_websites_organization_id', 'websites', type_='foreignkey')
    op.drop_index('ix_websites_organization_id', table_name='websites')
    op.drop_column('websites', 'show_conversation_history')
    op.drop_column('websites', 'organization_id')
    op.drop_constraint('fk_organizations_owner_id', 'organizations', type_='foreignkey')
    op.drop_constraint('fk_users_organization_id', 'users', type_='foreignkey')
    op.drop_index('ix_users_organization_id', table_name='users')
    op.drop_column('users', 'password_changed_at')
    op.drop_column('users', 'organization_id')
    op.drop_index('ix_organizations_slug', table_name='organizations')
    op.drop_table('organizations')
