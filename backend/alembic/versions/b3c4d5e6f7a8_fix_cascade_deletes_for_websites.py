"""fix cascade deletes for websites

Add ondelete=CASCADE to foreign keys that reference websites.id and
conversations.id where it was missing, so that deleting a website
properly cascades through conversations, messages, and page views.

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-03-03
"""
from alembic import op

# revision identifiers
revision = "b3c4d5e6f7a8"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- conversations.website_id  (missing ondelete) ---
    with op.batch_alter_table("conversations") as batch_op:
        batch_op.drop_constraint(
            "conversations_website_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "conversations_website_id_fkey",
            "websites",
            ["website_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # --- messages.conversation_id  (missing ondelete) ---
    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint(
            "messages_conversation_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "messages_conversation_id_fkey",
            "conversations",
            ["conversation_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # --- conversation_page_views.website_id  (missing ondelete) ---
    # --- conversation_page_views.conversation_id  (missing ondelete) ---
    with op.batch_alter_table("conversation_page_views") as batch_op:
        batch_op.drop_constraint(
            "conversation_page_views_website_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "conversation_page_views_website_id_fkey",
            "websites",
            ["website_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.drop_constraint(
            "conversation_page_views_conversation_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "conversation_page_views_conversation_id_fkey",
            "conversations",
            ["conversation_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    # Revert to bare foreign keys (no ondelete)
    with op.batch_alter_table("conversation_page_views") as batch_op:
        batch_op.drop_constraint(
            "conversation_page_views_conversation_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "conversation_page_views_conversation_id_fkey",
            "conversations",
            ["conversation_id"],
            ["id"],
        )
        batch_op.drop_constraint(
            "conversation_page_views_website_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "conversation_page_views_website_id_fkey",
            "websites",
            ["website_id"],
            ["id"],
        )

    with op.batch_alter_table("messages") as batch_op:
        batch_op.drop_constraint(
            "messages_conversation_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "messages_conversation_id_fkey",
            "conversations",
            ["conversation_id"],
            ["id"],
        )

    with op.batch_alter_table("conversations") as batch_op:
        batch_op.drop_constraint(
            "conversations_website_id_fkey", type_="foreignkey"
        )
        batch_op.create_foreign_key(
            "conversations_website_id_fkey",
            "websites",
            ["website_id"],
            ["id"],
        )
