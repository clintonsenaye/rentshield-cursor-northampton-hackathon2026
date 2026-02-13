"""
RAG (Retrieval Augmented Generation) utilities.

Retrieves relevant legal knowledge documents from MongoDB for LLM context.
"""

import logging
from typing import List

from database.connection import get_legal_knowledge_collection
from config import get_settings

logger = logging.getLogger(__name__)

# Fallback message when no legal context is found
LEGAL_CONTEXT_FALLBACK_SUFFIX = (
    "Providing general guidance based on the Renters' Rights Act 2025."
)


def get_legal_context(query: str, user_type: str = "tenant", limit: int = None) -> str:
    """
    Retrieve relevant legal knowledge documents from MongoDB using text search.
    
    This function implements the "Retrieval" part of RAG. It searches the
    legal_knowledge collection using MongoDB's full-text search, retrieves
    the most relevant documents based on weighted scoring, and formats them
    as context for the LLM.
    
    The text index weights are:
    - keywords: 10 (highest - matches user's actual language)
    - title: 5 (topic identification)
    - subtopic: 3 (specific issue matching)
    - content: 1 (broad content matching)
    
    Args:
        query: User's message to search for relevant legal documents
        user_type: Type of user - "tenant" or "landlord" (default: "tenant")
        limit: Maximum number of documents to retrieve (default: from settings)
        
    Returns:
        str: Formatted context string with legal documents, or fallback message
        
    Example:
        >>> context = get_legal_context("landlord changed locks", "tenant")
        >>> # Returns formatted string with relevant legal documents
    """
    # Get limit from settings if not provided
    if limit is None:
        settings = get_settings()
        limit = settings.rag_context_limit
    
    # Get collection (returns None if database not initialized)
    legal_collection = get_legal_knowledge_collection()
    
    if legal_collection is None:
        logger.warning("Legal knowledge collection not available - database may be disconnected")
        return (
            "No specific legal provisions found because the database is unavailable. "
            f"{LEGAL_CONTEXT_FALLBACK_SUFFIX}"
        )
    
    try:
        # Perform MongoDB text search with scoring
        cursor = (
            legal_collection.find(
                {"$text": {"$search": query}},
                {"score": {"$meta": "textScore"}},
            )
            .sort([("score", {"$meta": "textScore"})])
            .limit(limit)
        )
        
        docs = list(cursor)
        
        # If no documents found, return fallback message
        if not docs:
            logger.debug(f"No legal documents found for query: {query[:50]}...")
            return (
                "No specific legal provisions found. "
                f"{LEGAL_CONTEXT_FALLBACK_SUFFIX}"
            )
        
        # Format documents as context blocks
        blocks: List[str] = []
        
        # Normalize user_type to ensure valid value
        normalized_user_type = (
            "tenant" if user_type not in {"tenant", "landlord"} else user_type
        )
        
        # Build formatted context blocks for each document
        for doc in docs:
            title = doc.get("title", "Untitled")
            content = doc.get("content", "")
            urgency = doc.get("urgency", "unknown")
            
            # Get actions specific to user type (tenant or landlord)
            actions_key = f"actions_{normalized_user_type}"
            actions = doc.get(actions_key) or doc.get("actions_tenant") or []
            
            # Build formatted block
            block_lines = [
                f"### {title}",
                content,
                f"Urgency: {urgency}",
                f"Recommended actions for {normalized_user_type}:",
            ]
            
            # Add action items as bullet points
            for action in actions:
                block_lines.append(f"- {action}")
            
            blocks.append("\n".join(block_lines))
        
        # Join blocks with separator
        context = "\n---\n".join(blocks)
        
        logger.debug(f"Retrieved {len(docs)} legal documents for RAG context")
        return context
        
    except Exception as exc:
        # Log error but don't crash - return fallback message
        logger.error(f"Error querying MongoDB for legal context: {exc}", exc_info=True)
        return (
            "No specific legal provisions found due to a database error. "
            f"{LEGAL_CONTEXT_FALLBACK_SUFFIX}"
        )
