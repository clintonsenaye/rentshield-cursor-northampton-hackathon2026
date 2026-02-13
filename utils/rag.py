"""
RAG (Retrieval Augmented Generation) utilities.

Retrieves relevant legal knowledge documents from MongoDB for LLM context.
"""

import logging
from typing import Any, Dict, List, Tuple

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

            # Get source citations
            sources = doc.get("sources", [])
            confidence = doc.get("confidence", "medium")
            last_verified = doc.get("last_verified", "unknown")

            # Build formatted block
            block_lines = [
                f"### {title}",
                f"[Confidence: {confidence} | Last verified: {last_verified}]",
                content,
                f"Urgency: {urgency}",
                f"Recommended actions for {normalized_user_type}:",
            ]

            # Add action items as bullet points
            for action in actions:
                block_lines.append(f"- {action}")

            # Add source citations
            if sources:
                block_lines.append("Sources:")
                for src in sources:
                    src_title = src.get("title", "")
                    src_url = src.get("url", "")
                    block_lines.append(f"- {src_title}: {src_url}")

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


def get_legal_context_with_sources(
    query: str, user_type: str = "tenant", limit: int = None
) -> Tuple[str, List[Dict[str, str]], str]:
    """
    Retrieve legal context along with extracted sources and confidence level.

    Returns:
        Tuple of (context_string, sources_list, confidence_level).
        sources_list contains dicts with "title" and "url" keys.
        confidence_level is "high", "medium", or "low".
    """
    if limit is None:
        settings = get_settings()
        limit = settings.rag_context_limit

    legal_collection = get_legal_knowledge_collection()

    if legal_collection is None:
        return (
            "No specific legal provisions found because the database is unavailable. "
            + LEGAL_CONTEXT_FALLBACK_SUFFIX,
            [],
            "low",
        )

    try:
        cursor = (
            legal_collection.find(
                {"$text": {"$search": query}},
                {"score": {"$meta": "textScore"}},
            )
            .sort([("score", {"$meta": "textScore"})])
            .limit(limit)
        )

        docs = list(cursor)

        if not docs:
            return (
                "No specific legal provisions found. " + LEGAL_CONTEXT_FALLBACK_SUFFIX,
                [],
                "low",
            )

        # Collect unique sources and determine overall confidence
        all_sources: List[Dict[str, str]] = []
        seen_urls = set()
        confidence_levels: List[str] = []

        normalized_user_type = (
            "tenant" if user_type not in {"tenant", "landlord"} else user_type
        )

        blocks: List[str] = []

        for doc in docs:
            title = doc.get("title", "Untitled")
            content = doc.get("content", "")
            urgency = doc.get("urgency", "unknown")
            actions_key = f"actions_{normalized_user_type}"
            actions = doc.get(actions_key) or doc.get("actions_tenant") or []
            sources = doc.get("sources", [])
            confidence = doc.get("confidence", "medium")
            last_verified = doc.get("last_verified", "unknown")

            confidence_levels.append(confidence)

            # Collect unique sources
            for src in sources:
                src_url = src.get("url", "")
                if src_url and src_url not in seen_urls:
                    seen_urls.add(src_url)
                    all_sources.append({
                        "title": src.get("title", ""),
                        "url": src_url,
                    })

            # Build formatted block
            block_lines = [
                f"### {title}",
                f"[Confidence: {confidence} | Last verified: {last_verified}]",
                content,
                f"Urgency: {urgency}",
                f"Recommended actions for {normalized_user_type}:",
            ]
            for action in actions:
                block_lines.append(f"- {action}")
            if sources:
                block_lines.append("Sources:")
                for src in sources:
                    block_lines.append(
                        f"- {src.get('title', '')}: {src.get('url', '')}"
                    )
            blocks.append("\n".join(block_lines))

        context = "\n---\n".join(blocks)

        # Determine overall confidence: use highest confidence from matched docs
        if "high" in confidence_levels:
            overall_confidence = "high"
        elif "medium" in confidence_levels:
            overall_confidence = "medium"
        else:
            overall_confidence = "low"

        logger.debug(
            "RAG: %d docs, %d sources, confidence=%s",
            len(docs), len(all_sources), overall_confidence,
        )

        return context, all_sources, overall_confidence

    except Exception as exc:
        logger.error(f"Error in get_legal_context_with_sources: {exc}", exc_info=True)
        return (
            "No specific legal provisions found due to a database error. "
            + LEGAL_CONTEXT_FALLBACK_SUFFIX,
            [],
            "low",
        )
