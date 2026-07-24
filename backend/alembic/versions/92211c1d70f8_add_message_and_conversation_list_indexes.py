"""Add missing indexes behind the resolved/active chat list queries.

messages.conversation_id had NO index at all — every "message count" and
"last message" lookup for the chat list (active_conversations_with_counts_
and_last_message / resolved_conversations_with_counts_and_last_message in
app/repos/conversations.py) does a GROUP BY and a ROW_NUMBER() window
function over conversation_id, which without this index means a full scan
+ sort of the entire messages table on every single request — regardless
of which/how many conversations are actually being displayed. Same story
for conversations(status, website_id, updated_at): the resolved-chat list
filters on status + website_id and sorts by updated_at with no supporting
index, so it's a sequential scan + sort every time too. Both got a lot more
noticeable as message/conversation history grew (30k+ messages, 20k+
conversations at time of writing) — this is what made "Resolved" slow to
load.

CONCURRENTLY so this doesn't hold a lock against a live chat system while
building (messages/conversations are both actively written to).

Revision ID: 92211c1d70f8
Revises: a4b5c6d7e8f9
Create Date: 2026-07-24 00:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = '92211c1d70f8'
down_revision = 'a4b5c6d7e8f9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            'ix_messages_conversation_id_created_at',
            'messages',
            ['conversation_id', 'created_at'],
            unique=False,
            postgresql_concurrently=True,
            if_not_exists=True,
        )
        op.create_index(
            'ix_conversations_status_website_id_updated_at',
            'conversations',
            ['status', 'website_id', 'updated_at'],
            unique=False,
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.drop_index(
            'ix_conversations_status_website_id_updated_at',
            table_name='conversations',
            postgresql_concurrently=True,
            if_exists=True,
        )
        op.drop_index(
            'ix_messages_conversation_id_created_at',
            table_name='messages',
            postgresql_concurrently=True,
            if_exists=True,
        )
