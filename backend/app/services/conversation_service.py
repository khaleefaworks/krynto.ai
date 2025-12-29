"""
Conversation Service - Business logic for conversation lifecycle management

Responsibilities:
- Create conversations based on website online status
- Manage conversation state transitions (ACTIVE ↔ OFFLINE ↔ CLOSED)
- Manage conversation mode (AI ↔ AGENT)
- Create system messages
- Enforce conversation state rules
"""

from sqlalchemy.orm import Session
from app.models.conversation import Conversation, ConversationStatus, ConversationMode
from app.models.message import Message, MessageSenderType
from app.models.website import Website
from app.services.website_resolver import is_website_online
from app.core.logging import get_logger
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
        session_id: str
    ) -> Conversation:
        """
        Get existing conversation or create new one.
        
        Creation logic for STATUS:
        - IF website online → ACTIVE conversation
        - IF website offline → OFFLINE conversation + system message
        
        Creation logic for MODE:
        - IF AI enabled AND website online → AI_HANDLING
        - ELSE → WAITING_FOR_AGENT
        
        Returns:
            Conversation object with appropriate status and mode
        """
        # Check if conversation already exists
        conversation = (
            self.db.query(Conversation)
            .filter_by(session_id=session_id, website_id=website_id)
            .first()
        )
        
        if conversation:
            logger.info(
                "existing_conversation_found",
                conversation_id=conversation.id,
                status=conversation.status.value,
                mode=conversation.mode.value
            )
            return conversation
        
        # Get website to check AI enablement
        website = self.db.query(Website).filter_by(id=website_id).first()
        ai_enabled = website and website.ai_instructions and len(website.ai_instructions.strip()) > 0
        
        # Determine initial status based on website online status
        online = is_website_online(website_id)
        initial_status = ConversationStatus.ACTIVE if online else ConversationStatus.OFFLINE
        
        # Determine initial mode based on AI enabled + online status
        if ai_enabled and online:
            initial_mode = ConversationMode.AI_HANDLING
        else:
            initial_mode = ConversationMode.WAITING_FOR_AGENT
        
        # Create new conversation
        conversation = Conversation(
            website_id=website_id,
            session_id=session_id,
            status=initial_status,
            mode=initial_mode,
            is_handoff=False,
            assigned_agent_id=None
        )
        
        self.db.add(conversation)
        self.db.commit()
        self.db.refresh(conversation)
        
        logger.info(
            "conversation_created",
            conversation_id=conversation.id,
            status=initial_status.value,
            mode=initial_mode.value,
            website_online=online,
            ai_enabled=ai_enabled
        )
        
        # If offline, create system message explaining the situation
        if initial_status == ConversationStatus.OFFLINE:
            self.add_system_message(
                conversation.id,
                "We're currently offline. Your message has been saved and an agent will respond when they're back online."
            )
        
        # If waiting for agent (and online), optionally add system message
        if initial_mode == ConversationMode.WAITING_FOR_AGENT and initial_status == ConversationStatus.ACTIVE:
            self.add_system_message(
                conversation.id,
                "Please wait while we connect you with an available agent."
            )
        
        return conversation
    
    def add_system_message(self, conversation_id: int, content: str) -> Message:
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
            sender="system",
            content=content
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
    
    def transition_offline_to_active(
        self,
        conversation_id: int,
        agent_id: int,
        agent_name: str
    ) -> bool:
        """
        Transition OFFLINE → ACTIVE when agent responds.
        
        Args:
            conversation_id: Conversation to transition
            agent_id: Agent taking over conversation
            agent_name: Agent display name
            
        Returns:
            True if transition successful, False otherwise
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            logger.error("transition_failed_conversation_not_found", conversation_id=conversation_id)
            return False
        
        if conversation.status != ConversationStatus.OFFLINE:
            logger.warning(
                "transition_failed_invalid_state",
                conversation_id=conversation_id,
                current_status=conversation.status.value
            )
            return False
        
        # Update conversation
        conversation.status = ConversationStatus.ACTIVE
        conversation.assigned_agent_id = agent_id
        self.db.commit()
        
        # Add system message
        self.add_system_message(
            conversation_id,
            f"{agent_name} has joined the conversation."
        )
        
        logger.info(
            "conversation_transitioned_offline_to_active",
            conversation_id=conversation_id,
            agent_id=agent_id
        )
        
        return True
    
    def close_conversation(self, conversation_id: int) -> bool:
        """
        Close a conversation (ACTIVE → CLOSED or OFFLINE → CLOSED).
        
        Args:
            conversation_id: Conversation to close
            
        Returns:
            True if transition successful, False otherwise
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            logger.error("close_failed_conversation_not_found", conversation_id=conversation_id)
            return False
        
        if conversation.status == ConversationStatus.CLOSED:
            logger.warning("conversation_already_closed", conversation_id=conversation_id)
            return True  # Already closed is success
        
        # Update status
        old_status = conversation.status
        conversation.status = ConversationStatus.CLOSED
        self.db.commit()
        
        # Add system message
        self.add_system_message(
            conversation_id,
            "This conversation has been closed."
        )
        
        logger.info(
            "conversation_closed",
            conversation_id=conversation_id,
            previous_status=old_status.value
        )
        
        return True
    
    def claim_conversation(
        self,
        conversation_id: int,
        agent_id: int,
        agent_name: str
    ) -> tuple[bool, str]:
        """
        Claim a conversation atomically (FCFS).
        
        This implements the CRITICAL atomic claim logic that prevents race conditions.
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
                Conversation.mode == ConversationMode.WAITING_FOR_AGENT
            )
            .update(
                {
                    "assigned_agent_id": agent_id,
                    "mode": ConversationMode.AGENT_HANDLING
                },
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
            f"{agent_name} has joined the conversation."
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
        
        Rules based on mode:
        - AI_HANDLING: Only AI can respond
        - WAITING_FOR_AGENT: No one can respond (must claim first)
        - AGENT_HANDLING: Only assigned agent can respond
        
        Args:
            conversation_id: Conversation ID
            agent_id: Agent user ID
            
        Returns:
            Tuple of (allowed: bool, reason: str)
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            return False, "Conversation not found"
        
        if conversation.status == ConversationStatus.CLOSED:
            return False, "Conversation is closed"
        
        if conversation.mode == ConversationMode.AI_HANDLING:
            return False, "AI is currently handling this conversation"
        
        if conversation.mode == ConversationMode.WAITING_FOR_AGENT:
            return False, "Must claim conversation first"
        
        if conversation.mode == ConversationMode.AGENT_HANDLING:
            if conversation.assigned_agent_id != agent_id:
                return False, "Conversation is being handled by another agent"
            return True, "OK"
        
        return False, "Unknown conversation mode"
    
    def can_add_message(self, conversation_id: int) -> bool:
        """
        Check if new messages can be added to conversation.
        
        Rules:
        - ACTIVE: Yes
        - OFFLINE: Yes (visitor can leave messages)
        - CLOSED: No
        
        Args:
            conversation_id: Conversation to check
            
        Returns:
            True if messages allowed, False otherwise
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            return False
        
        return conversation.status != ConversationStatus.CLOSED
    
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
            Created Message or None if conversation closed
        """
        if not self.can_add_message(conversation_id):
            logger.warning("message_rejected_conversation_closed", conversation_id=conversation_id)
            return None
        
        message = Message(
            conversation_id=conversation_id,
            sender_type=MessageSenderType.VISITOR,
            sender="visitor",
            content=content
        )
        
        self.db.add(message)
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
        
        If conversation is OFFLINE, transitions to ACTIVE first.
        
        Args:
            conversation_id: Conversation ID
            agent_id: Agent user ID
            agent_email: Agent email
            content: Message content
            
        Returns:
            Created Message or None if conversation closed
        """
        conversation = self.db.query(Conversation).filter_by(id=conversation_id).first()
        
        if not conversation:
            logger.error("agent_message_failed_conversation_not_found", conversation_id=conversation_id)
            return None
        
        if conversation.status == ConversationStatus.CLOSED:
            logger.warning("agent_message_rejected_conversation_closed", conversation_id=conversation_id)
            return None
        
        # If OFFLINE, transition to ACTIVE
        if conversation.status == ConversationStatus.OFFLINE:
            self.transition_offline_to_active(conversation_id, agent_id, agent_email.split("@")[0])
        
        # Add message
        message = Message(
            conversation_id=conversation_id,
            sender_type=MessageSenderType.AGENT,
            sender=agent_email,
            content=content
        )
        
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)
        
        logger.info(
            "agent_message_added",
            conversation_id=conversation_id,
            message_id=message.id,
            agent_id=agent_id
        )
        
        return message
