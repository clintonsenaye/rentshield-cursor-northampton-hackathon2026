"""
Notice checker endpoint routes.

Handles analysis of landlord notices for legal validity.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from typing import Dict, Any

from models.schemas import NoticeRequest
from services.ai_service import get_ai_service
from database.connection import get_analytics_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notice", tags=["notice"])
limiter = Limiter(key_func=get_remote_address)


@router.post("/check")
@limiter.limit("5/minute")
async def notice_check_endpoint(http_request: Request, request: NoticeRequest) -> Dict[str, Any]:
    """
    Analyze a landlord's notice for legal validity.
    
    Uses MiniMax LLM to analyze the notice and determine:
    - Notice type (Section 21, Section 8, Section 13, etc.)
    - Legal validity under Renters' Rights Act 2025
    - Specific problems found
    - Verdict (VALID, ISSUES FOUND, or INVALID)
    - Recommended actions
    
    Args:
        request: Notice request with notice_text and optional session_id
        
    Returns:
        Dict[str, Any]: Analysis text and session_id
        
    Raises:
        HTTPException: If analysis service fails
    """
    # Generate session ID if not provided
    session_id = request.session_id or str(uuid.uuid4())
    
    # Call AI service for notice analysis
    ai_service = get_ai_service()
    try:
        analysis_text = await ai_service.analyze_notice(
            request.notice_text,
            language=getattr(request, "language", "en") or "en",
        )
    except Exception as exc:
        logger.exception("Critical error in notice analysis")
        raise HTTPException(
            status_code=502,
            detail="Error contacting the notice analysis service.",
        )
    
    # Log to analytics collection
    analytics_col = get_analytics_collection()
    if analytics_col is not None:
        try:
            now = datetime.now(timezone.utc)
            analytics_col.insert_one(
                {
                    "session_id": session_id,
                    "issue_type": "notice_check",
                    "urgency": "high",
                    "user_type": "tenant",  # Notice checker is typically used by tenants
                    "timestamp": now,
                }
            )
        except Exception as exc:
            logger.warning(f"Failed to log notice check analytics: {exc}")
    
    return {"analysis": analysis_text, "session_id": session_id}
