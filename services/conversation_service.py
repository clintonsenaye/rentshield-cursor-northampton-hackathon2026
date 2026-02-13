"""
Conversation service for managing chat history and analytics.

Handles saving conversations, retrieving history, and analytics tracking.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from database.connection import (
    get_analytics_collection,
    get_conversations_collection,
)
from config import get_settings

logger = logging.getLogger(__name__)


class ConversationService:
    """
    Service for managing conversations and analytics.
    
    Handles persistence of chat messages, conversation history retrieval,
    and analytics event tracking.
    """
    
    def __init__(self):
        """Initialize conversation service."""
        self.settings = get_settings()
    
    def get_conversation_history(self, session_id: str, limit: Optional[int] = None) -> str:
        """
        Retrieve conversation history for a session.
        
        Gets the last N messages from a conversation session and formats them
        as plain text for use in LLM context.
        
        Args:
            session_id: Unique session identifier
            limit: Maximum number of messages to retrieve (default: from settings)
            
        Returns:
            str: Formatted conversation history, or empty string if none found
        """
        if limit is None:
            limit = self.settings.conversation_history_limit
        
        conversations_col = get_conversations_collection()
        
        if conversations_col is None:
            logger.debug("Conversations collection not available")
            return ""
        
        try:
            # Find conversation document by session_id
            doc = conversations_col.find_one({"session_id": session_id})
            
            if not doc:
                return ""
            
            messages = doc.get("messages", [])
            if not messages:
                return ""
            
            # Get last N messages
            recent = messages[-limit:]
            
            # Format as "User: ..." or "RentShield: ..."
            lines: List[str] = []
            for msg in recent:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                prefix = "User" if role == "user" else "RentShield"
                lines.append(f"{prefix}: {content}")
            
            return "\n".join(lines)
            
        except Exception as exc:
            logger.error(f"Error retrieving conversation history: {exc}", exc_info=True)
            return ""
    
    def save_conversation(
        self,
        session_id: str,
        user_message: str,
        assistant_response: str,
        detected_issue: str,
        urgency: str,
        user_type: str,
    ) -> None:
        """
        Save a conversation exchange to MongoDB.
        
        Persists both user and assistant messages, along with metadata
        (issue type, urgency, user type) for analytics.
        
        Args:
            session_id: Unique session identifier
            user_message: User's message text
            assistant_response: AI assistant's response text
            detected_issue: Type of issue detected (e.g., "illegal_eviction")
            urgency: Urgency level ("critical", "high", "medium", "low")
            user_type: Type of user ("tenant" or "landlord")
        """
        conversations_col = get_conversations_collection()
        analytics_col = get_analytics_collection()
        
        if conversations_col is None or analytics_col is None:
            logger.warning("MongoDB collections not available - cannot save conversation")
            return
        
        now = datetime.now(timezone.utc)
        
        # Create message documents
        user_msg_doc = {
            "role": "user",
            "content": user_message,
            "timestamp": now,
        }
        assistant_msg_doc = {
            "role": "assistant",
            "content": assistant_response,
            "timestamp": now,
        }
        
        try:
            # Upsert conversation document (create if doesn't exist, update if does)
            conversations_col.update_one(
                {"session_id": session_id},
                {
                    "$push": {
                        "messages": {
                            "$each": [user_msg_doc, assistant_msg_doc],
                        }
                    },
                    "$set": {
                        "detected_issue": detected_issue,
                        "urgency": urgency,
                        "user_type": user_type,
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "created_at": now,
                        "session_id": session_id,
                    },
                },
                upsert=True,
            )
            
            # Insert analytics event
            analytics_col.insert_one(
                {
                    "session_id": session_id,
                    "issue_type": detected_issue,
                    "urgency": urgency,
                    "user_type": user_type,
                    "timestamp": now,
                }
            )
            
            logger.debug(f"Saved conversation for session: {session_id}")
            
        except Exception as exc:
            logger.error(f"Error saving conversation: {exc}", exc_info=True)


# Singleton instance
_conversation_service: Optional[ConversationService] = None


def get_conversation_service() -> ConversationService:
    """
    Get singleton conversation service instance.
    
    Returns:
        ConversationService: Initialized conversation service instance
    """
    global _conversation_service
    if _conversation_service is None:
        _conversation_service = ConversationService()
    return _conversation_service
