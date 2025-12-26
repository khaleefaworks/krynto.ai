"""phase5 knowledge system schema

Revision ID: 7b896e76a93d
Revises: 65f8a6004dce
Create Date: 2025-12-24 18:26:35.862552

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7b896e76a93d'
down_revision = '65f8a6004dce'
branch_labels = None
depends_on = None


def upgrade():
    # --- knowledge_sources ---
    op.create_table(
        "knowledge_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("website_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["website_id"],
            ["websites.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_knowledge_sources_website_id",
        "knowledge_sources",
        ["website_id"],
    )

    # --- documents ---
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("website_id", sa.Integer(), nullable=False),
        sa.Column("knowledge_source_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("source_uri", sa.String(length=1024), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["website_id"],
            ["websites.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_source_id"],
            ["knowledge_sources.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_documents_website_id",
        "documents",
        ["website_id"],
    )

    op.create_index(
        "ix_documents_knowledge_source_id",
        "documents",
        ["knowledge_source_id"],
    )

    # --- knowledge_chunks ---
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("website_id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("meta", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["website_id"],
            ["websites.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["documents.id"],
            ondelete="CASCADE",
        ),
    )

    op.create_index(
        "ix_knowledge_chunks_website_id",
        "knowledge_chunks",
        ["website_id"],
    )

    op.create_index(
        "ix_knowledge_chunks_document_id",
        "knowledge_chunks",
        ["document_id"],
    )


def downgrade():
    op.drop_index("ix_knowledge_chunks_document_id", table_name="knowledge_chunks")
    op.drop_index("ix_knowledge_chunks_website_id", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")

    op.drop_index("ix_documents_knowledge_source_id", table_name="documents")
    op.drop_index("ix_documents_website_id", table_name="documents")
    op.drop_table("documents")

    op.drop_index("ix_knowledge_sources_website_id", table_name="knowledge_sources")
    op.drop_table("knowledge_sources")

