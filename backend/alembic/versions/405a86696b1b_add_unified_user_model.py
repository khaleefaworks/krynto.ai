"""add_unified_user_model

Revision ID: 405a86696b1b
Revises: cb96bda2a9b9
Create Date: 2025-12-29 12:51:01.394008

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '405a86696b1b'
down_revision = 'cb96bda2a9b9'
branch_labels = None
depends_on = None


def upgrade():
    # Create user_role enum type if it doesn't exist
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE user_role AS ENUM ('full_access', 'limited_access');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    # Create users table
    op.execute("""
        CREATE TABLE users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            role user_role NOT NULL DEFAULT 'limited_access',
            is_available BOOLEAN NOT NULL DEFAULT true,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE
        );
    """)
    
    # Create indexes
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)


def downgrade():
    # Drop users table
    op.drop_index(op.f('ix_users_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    
    # Drop enum type
    op.execute("DROP TYPE user_role")
