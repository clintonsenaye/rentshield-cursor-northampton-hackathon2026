"""
Text-to-speech endpoint routes.

Handles standalone TTS requests.
"""

import logging

from fastapi import APIRouter, HTTPException
from typing import Dict, Any

from models.schemas import TTSRequest
from services.ai_service import get_ai_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])


@router.post("")
async def tts_endpoint(request: TTSRequest) -> Dict[str, Any]:
    """
    Convert text to speech.
    
    Standalone endpoint for generating TTS audio from any text.
    Used by the frontend for on-demand audio generation.
    
    Args:
        request: TTS request with text to convert
        
    Returns:
        Dict[str, Any]: TTS result with audio_url, audio_data, and status
        
    Raises:
        HTTPException: If TTS service fails
    """
    ai_service = get_ai_service()
    
    try:
        result = await ai_service.text_to_speech(request.text)
        
        # If TTS returned an error status, raise HTTPException
        if isinstance(result, dict) and result.get("status") == "error":
            raise HTTPException(
                status_code=502,
                detail=result.get("message", "Error from text-to-speech service."),
            )
        
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as exc:
        logger.exception("Critical error in TTS endpoint")
        raise HTTPException(
            status_code=502,
            detail="Error contacting the text-to-speech service.",
        )
