"""
Conversation Service - Business logic for conversation lifecycle management

Responsibilities:
- Create conversations (all start as OPEN)
- Manage conversation state transitions (OPEN ↔ RESOLVED)
- Handle agent assignment
- Create system messages
- Enforce conversation state rules
"""

from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.models.conversation import Conversation, ConversationStatus
from app.models.message import Message, MessageSenderType
from app.models.website import Website
from app.services.website_resolver import is_website_online
from app.core.config import settings
from app.core.logging import get_logger
from app.core.avatar_colors import pick_avatar_color
from typing import Optional

logger = get_logger(__name__)


class ConversationService:
    """
    Single source of truth for conversation lifecycle management.
    """
    
    def __init__(self, db: Session):
        self.db = db
    

    
    def get_or_create_conversation(
        self,
        website_id: int,
        session_id: str,
        visitor_ip: str | None = None,
    ) -> Conversation:
        """
        Get existing conversation or create new one.
        
        All conversations start with status=OPEN.
        Agents are assigned when they join the conversation.
        
        Returns:
            Conversation object with status=OPEN
        """
        # Resume any OPEN conversation for this session that the visitor has NOT
        # intentionally ended. There is no inactivity cutoff: OPEN conversations
        # stay resumable until explicitly resolved.
        conversation = (
            self.db.query(Conversation)
            .filter(
                Conversation.session_id == session_id,
                Conversation.website_id == website_id,
                Conversation.status == ConversationStatus.OPEN,
                Conversation.visitor_ended == False,  # noqa: E712
            )
            .order_by(Conversation.id.desc())
            .first()
        )
        
        if conversation:
            logger.info(
                "existing_conversation_found",
                conversation_id=conversation.id,
                status=conversation.status.value
            )

            # Best-effort: backfill visitor IP if newly observed.
            try:
                ip = str(visitor_ip or "").strip() or None
                if ip and not getattr(conversation, "visitor_ip", None):
                    conversation.visitor_ip = ip
                # Best-effort: backfill avatar color.
                if not getattr(conversation, "visitor_avatar_color", None):
                    conversation.visitor_avatar_color = pick_avatar_color(str(conversation.session_id))

                if self.db.is_modified(conversation):
                    self.db.commit()
                    self.db.refresh(conversation)
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass
            return conversation
        
        # Get website to validate it exists
        website = self.db.query(Website).filter_by(id=website_id).first()
        if not website:
            logger.error(
                "website_not_found",
                website_id=website_id,
                session_id=session_id
            )
            raise ValueError(f"Website with ID {website_id} does not exist")
        
        # Create new conversation - always starts as OPEN
        conversation = Conversation(
            website_id=website_id,
            session_id=session_id,
            status=ConversationStatus.OPEN,
            is_handoff=False,
            assigned_agent_id=None,
            visitor_ip=(str(visitor_ip).strip() if visitor_ip else None),
            visitor_avatar_color=pick_avatar_color(str(session_id)),
        )

        try:
            self.db.add(conversation)
            self.db.commit()
            self.db.refresh(conversation)
        except IntegrityError:
            # Race condition: a concurrent connection for the same session
            # already inserted an OPEN conversation and the partial unique index
            # (website_id, session_id) WHERE status='open' rejected ours.
            # Roll back and resume the row that won the race.
            self.db.rollback()
            # Retry up to 3 times with a short sleep — the winning transaction
            # may not yet be visible if commit() and our SELECT overlap tightly.
            import time as _time
            conversation = None
            for _attempt in range(3):
                conversation = (
                    self.db.query(Conversation)
                    .filter(
                        Conversation.session_id == session_id,
                        Conversation.website_id == website_id,
                        Conversation.status == ConversationStatus.OPEN,
                        Conversation.visitor_ended == False,  # noqa: E712
                    )
                    .order_by(Conversation.id.desc())
                    .first()
                )
                if conversation is not None:
                    break
                _time.sleep(0.05)  # 50 ms — gives the winner time to commit
            if conversation is None:
                raise RuntimeError(
                    f"Race condition on conversation creation for session {session_id!r} "
                    "could not be resolved."
                )
            logger.info(
                "conversation_race_resolved",
                conversation_id=conversation.id,
                session_id=session_id,
            )
            return conversation

        # Attach any pre-conversation browsing events captured before the first message.
        # This preserves the invariant: we don't create a conversation just to track page views.
        try:
            from app.repos import page_views as page_views_repo

            latest = page_views_repo.attach_session_page_views_to_conversation(
                self.db,
                website_id=website_id,
                session_id=session_id,
                conversation_id=conversation.id,
            )

            # Best-effort backfill device/browser info from the latest page view.
            if latest:
                changed = False
                if latest.device_info and not conversation.device_info:
                    conversation.device_info = latest.device_info
                    changed = True
                if latest.browser_info and not conversation.browser_info:
                    conversation.browser_info = latest.browser_info
                    changed = True
                if changed:
                    self.db.commit()
                    self.db.refresh(conversation)
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        
        logger.info(
            "conversation_created",
            conversation_id=conversation.id,
            status=ConversationStatus.OPEN.value,
            website_id=website_id
        )
        
        return conversation
    
    def add_system_message(
        self,
        conversation_id: int,
        content: str,
        *,
        event_type: str | None = None,
        sender: str = "system",
        is_agent_only: bool = False,
    ) -> Message:
        """
        Add a system-generated message to a conversation.
        
        Args:
            conversation_id: ID of conversation
            content: Message content
            
        Returns:
            Created Message object
        """
        message = Message(
            conversation_id=conversation_id,
            sender_type=MessageSenderType.SYSTEM,
            sender=sender,
            event_type=event_type,
            content=content,
            is_agent_only=is_agent_only,
        )
        
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        
        logger.info(
            "system_message_added",
            conversation_id=conversation_id,
            message_id=message.id
        )
        
        return message

    def add_bot_message(self, conversation_id: int, content: str, *, event_type: str = "bot") -> Message:
        return self.add_system_message(
            conversation_id,
            content,
            event_type=event_type,
            sender="bot",
        )
    

    
    def close_conversation(self, conversation_id: int, *, closed_by: str | None = "agent") -> Optional[Conversation]:
        """
        Resolve a conversation (OPEN → RESOLVED).
        
        Args:
            conversation_id: Conversation to resolve
            
        Returns:
            Conversation if successful, None otherwise
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            logger.error("resolve_failed_conversation_not_found", conversation_id=conversation_id)
            return None
        
        if conversation.status == ConversationStatus.RESOLVED:
            if closed_by and not getattr(conversation, "closed_by", None):
                conversation.closed_by = str(closed_by)
                self.db.commit()
                try:
                    self.db.refresh(conversation)
                except Exception:
                    pass
            logger.warning("conversation_already_resolved", conversation_id=conversation_id)
            return conversation
        
        # Update status
        old_status = conversation.status
        conversation.status = ConversationStatus.RESOLVED
        conversation.closed_by = str(closed_by).strip() if closed_by else None
        conversation.resolved_at = datetime.utcnow()
        self.db.commit()
        try:
            self.db.refresh(conversation)
        except Exception:
            pass
        
        logger.info(
            "conversation_resolved",
            conversation_id=conversation_id,
            previous_status=old_status.value,
            closed_by=conversation.closed_by,
        )

        return conversation
    
    def claim_conversation(
        self,
        conversation_id: int,
        agent_id: int,
        agent_name: str
    ) -> tuple[bool, str]:
        """
        Claim a conversation atomically (FCFS).
        
        This implements CRITICAL atomic claim logic that prevents race conditions.
        Only ONE agent can successfully claim a conversation.
        
        Args:
            conversation_id: Conversation to claim
            agent_id: Agent claiming the conversation
            agent_name: Agent display name
            
        Returns:
            Tuple of (success: bool, message: str)
        """
        # Atomic UPDATE with WHERE conditions - DB guarantees FCFS
        result = (
            self.db.query(Conversation)
            .filter(
                Conversation.id == conversation_id,
                Conversation.assigned_agent_id.is_(None),
                Conversation.status == ConversationStatus.OPEN
            )
            .update(
                {"assigned_agent_id": agent_id},
                synchronize_session=False
            )
        )
        
        if result == 0:
            # Failed to claim - already claimed by someone else
            self.db.rollback()
            logger.warning(
                "claim_failed_already_claimed",
                conversation_id=conversation_id,
                agent_id=agent_id
            )
            return False, "Conversation already claimed by another agent"
        
        # Commit the atomic update
        self.db.commit()
        
        # Add system message
        self.add_system_message(
            conversation_id,
            f"{agent_name} joined the chat.",
            event_type="agent_join",
        )
        
        logger.info(
            "conversation_claimed",
            conversation_id=conversation_id,
            agent_id=agent_id
        )
        
        return True, "Conversation claimed successfully"
    
    def can_agent_message(
        self,
        conversation_id: int,
        agent_id: int
    ) -> tuple[bool, str]:
        """
        Check if agent can send message to conversation.
        
        Rules:
        - RESOLVED: No one can respond
        - OPEN + unassigned: Must claim first
        - OPEN + assigned to this agent: OK
        - OPEN + assigned to other agent: Not allowed
        
        Args:
            conversation_id: Conversation ID
            agent_id: Agent user ID
            
        Returns:
            Tuple of (allowed: bool, reason: str)
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            return False, "Conversation not found"
        
        if conversation.status == ConversationStatus.RESOLVED:
            return False, "Conversation is resolved"
        
        if not conversation.assigned_agent_id:
            return False, "Must claim conversation first"
        
        if conversation.assigned_agent_id != agent_id:
            return False, "Conversation is being handled by another agent"
        
        return True, "OK"
    
    def can_add_message(self, conversation_id: int) -> bool:
        """
        Check if new messages can be added to conversation.
        
        Rules:
        - OPEN: Yes
        - RESOLVED: No
        
        Args:
            conversation_id: Conversation to check
            
        Returns:
            True if messages allowed, False otherwise
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            return False
        
        return conversation.status == ConversationStatus.OPEN
    
    def add_visitor_message(
        self,
        conversation_id: int,
        content: str
    ) -> Optional[Message]:
        """
        Add visitor message to conversation.
        
        Args:
            conversation_id: Conversation ID
            content: Message content
            
        Returns:
            Created Message or None if conversation resolved
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            logger.error("visitor_message_failed_conversation_not_found", conversation_id=conversation_id)
            return None
        
        if not self.can_add_message(conversation_id):
            logger.warning("message_rejected_conversation_resolved", conversation_id=conversation_id)
            return None
        
        # Create visitor message
        message = Message(
            conversation_id=conversation_id,
            sender_type=MessageSenderType.VISITOR,
            sender="visitor",
            content=content
        )
        
        self.db.add(message)
        
        # Update last visitor message timestamp
        conversation.last_visitor_message_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(message)
        
        logger.info(
            "visitor_message_added",
            conversation_id=conversation_id,
            message_id=message.id
        )
        
        return message
    
    def add_agent_message(
        self,
        conversation_id: int,
        agent_id: int,
        agent_email: str,
        content: str
    ) -> Optional[Message]:
        """
        Add agent message to conversation.
        
        Args:
            conversation_id: Conversation ID
            agent_id: Agent user ID
            agent_email: Agent email
            content: Message content
            
        Returns:
            Created Message or None if conversation resolved
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            logger.error("agent_message_failed_conversation_not_found", conversation_id=conversation_id)
            return None
        
        if conversation.status == ConversationStatus.RESOLVED:
            logger.warning("agent_message_rejected_conversation_resolved", conversation_id=conversation_id)
            return None
        
        # Add message
        message = Message(
            conversation_id=conversation_id,
            sender_type=MessageSenderType.AGENT,
            sender=agent_email,
            content=content
        )
        
        self.db.add(message)
        
        # Update last agent message timestamp
        conversation.last_agent_message_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(message)
        
        logger.info(
            "agent_message_added",
            conversation_id=conversation_id,
            message_id=message.id,
            agent_id=agent_id
        )
        
        return message

    def tag_conversation(self, conversation_id: int, tag_id: int, agent_id: int) -> bool:
        """
        Add a tag to a conversation.
        """
        from app.repos import tags as tag_repo
        
        # Verify conversation exists
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        if not conversation:
            return False
            
        # Verify tag exists
        tag = tag_repo.get_tag(self.db, tag_id)
        if not tag:
            return False
            
        tag_repo.add_tag_to_conversation(self.db, conversation_id, tag_id, created_by=agent_id)
        return True

    def untag_conversation(self, conversation_id: int, tag_id: int) -> bool:
        """
        Remove a tag from a conversation.
        """
        from app.repos import tags as tag_repo
        return tag_repo.remove_tag_from_conversation(self.db, conversation_id, tag_id)
