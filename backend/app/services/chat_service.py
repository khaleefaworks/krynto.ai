from sqlalchemy.orm import Session
from app.models.conversation import Conversation
from app.models.message import Message
from app.services.ai_service import AIService


class ChatService:
    def __init__(self, db: Session, website_id: int, session_id: str):
        self.db = db
        self.website_id = website_id
        self.session_id = session_id
        self.ai = AIService()

        self.conversation = self._get_or_create_conversation()

    def _get_or_create_conversation(self):
        convo = (
            self.db.query(Conversation)
            .filter_by(session_id=self.session_id)
            .first()
        )

        if not convo:
            convo = Conversation(
                website_id=self.website_id,
                session_id=self.session_id,
                status="ai"
            )
            self.db.add(convo)
            self.db.commit()
            self.db.refresh(convo)

        return convo

    async def handle_visitor_message(self, text: str) -> str:
        # Save visitor message
        self.db.add(Message(
            conversation_id=self.conversation.id,
            sender="visitor",
            content=text
        ))
        self.db.commit()

        # AI response (stub for now)
        ai_reply = await self.ai.respond(text)

        # Save AI message
        self.db.add(Message(
            conversation_id=self.conversation.id,
            sender="ai",
            content=ai_reply
        ))
        self.db.commit()

        return ai_reply

    def close_session(self):
        pass
