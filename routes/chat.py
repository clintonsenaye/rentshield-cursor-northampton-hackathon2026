"""
Chat endpoint routes.

Handles the main chat API endpoint for legal guidance.
"""

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from models.schemas import ChatRequest, ChatResponse, SourceCitation
from services.ai_service import get_ai_service
from services.conversation_service import get_conversation_service
from utils.issue_detection import detect_issue_and_urgency
from utils.rag import get_legal_context_with_sources

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])
limiter = Limiter(key_func=get_remote_address)


@router.post("", response_model=ChatResponse)
@limiter.limit("10/minute")
async def chat_endpoint(http_request: Request, request: ChatRequest) -> ChatResponse:
    """
    Main chat endpoint for legal guidance.
    
    This is the core RAG pipeline endpoint:
    1. Detects issue type and urgency from user message
    2. Retrieves relevant legal documents from MongoDB
    3. Gets conversation history for context
    4. Calls MiniMax LLM for legal reasoning
    5. Optionally generates TTS audio for critical/high urgency
    6. Saves conversation and analytics
    
    Args:
        request: Chat request with message, session_id, and user_type
        
    Returns:
        ChatResponse: AI response with session_id, urgency, detected_issue, and optional audio_url
        
    Raises:
        HTTPException: If LLM service fails critically
    """
    # Generate session ID if not provided
    session_id = request.session_id or str(uuid.uuid4())
    
    # Detect issue type and urgency
    detected_issue, urgency = detect_issue_and_urgency(request.message)
    
    # Get legal context from RAG (with sources and confidence)
    context, rag_sources, confidence = get_legal_context_with_sources(
        request.message, request.user_type
    )
    
    # Get conversation history
    conversation_service = get_conversation_service()
    history = conversation_service.get_conversation_history(session_id)
    
    # Call AI service for legal guidance
    ai_service = get_ai_service()
    try:
        response_text = await ai_service.chat_completion(
            user_message=request.message,
            context=context,
            history=history,
            user_type=request.user_type,
            language=request.language or "en",
        )
    except Exception as exc:
        logger.exception("Critical error in chat_completion")
        raise HTTPException(
            status_code=502,
            detail="Error contacting the legal reasoning service.",
        )
    
    # Save conversation and analytics
    conversation_service.save_conversation(
        session_id=session_id,
        user_message=request.message,
        assistant_response=response_text,
        detected_issue=detected_issue,
        urgency=urgency,
        user_type=request.user_type,
    )
    
    # Generate TTS audio for critical/high urgency messages
    audio_url: Optional[str] = None
    if urgency in {"critical", "high"}:
        try:
            tts_result = await ai_service.text_to_speech(response_text)
            if isinstance(tts_result, dict) and tts_result.get("status") == "success":
                audio_url = tts_result.get("audio_url") or None
        except Exception as exc:
            # Don't fail the request if TTS fails - log and continue
            logger.warning(f"TTS generation failed: {exc}")
    
    # Build source citations from RAG results
    sources = [
        SourceCitation(title=src["title"], url=src["url"])
        for src in rag_sources
    ]

    return ChatResponse(
        response=response_text,
        session_id=session_id,
        urgency=urgency,
        detected_issue=detected_issue,
        audio_url=audio_url,
        sources=sources,
        confidence=confidence,
    )
