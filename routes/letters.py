"""
AI Legal Letter Generator routes.

Generates formal legal letters (complaints, repair requests, notice responses)
using AI, pre-filled with the tenant's details and citing relevant legislation.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from services.ai_service import get_ai_service
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/letters", tags=["letters"])

# Available letter templates
LETTER_TYPES = {
    "repair_request": {
        "name": "Repair Request",
        "description": "Formal request to landlord to carry out repairs",
    },
    "complaint": {
        "name": "Formal Complaint",
        "description": "Formal complaint about landlord conduct or property condition",
    },
    "notice_response": {
        "name": "Response to Notice",
        "description": "Formal response to an eviction or rent increase notice",
    },
    "deposit_demand": {
        "name": "Deposit Return Demand",
        "description": "Demand for return of tenancy deposit",
    },
    "disrepair_claim": {
        "name": "Disrepair Notification",
        "description": "Notification of disrepair under Awaab's Law / Section 11",
    },
    "rent_increase_challenge": {
        "name": "Rent Increase Challenge",
        "description": "Challenge to an unfair or invalid rent increase",
    },
}

# AI prompt for generating legal letters
LETTER_GENERATION_PROMPT = """
You are RentShield's Legal Letter Generator, an expert in UK housing law.

Generate a formal letter from a tenant to their landlord. The letter must be:

1. PROFESSIONAL: Formal tone, properly structured with date, addresses, subject line
2. LEGALLY ACCURATE: Cite the correct legislation (Renters' Rights Act 2025, 
   Landlord and Tenant Act 1985, etc.)
3. SPECIFIC: Include relevant section numbers, timeframes, and deadlines
4. ACTIONABLE: State clearly what the tenant is requesting and by when
5. EVIDENTIAL: Reference any evidence the tenant has mentioned

LETTER TYPE: {letter_type} ({letter_description})

TENANT DETAILS:
- Name: {tenant_name}
- Property address: {property_address}

SITUATION:
{situation}

{additional_context}

FORMAT THE LETTER EXACTLY AS FOLLOWS:
- Start with [DATE] placeholder
- Include [LANDLORD NAME AND ADDRESS] placeholder
- Include proper salutation
- Reference specific legislation
- Include a clear deadline for response (typically 14 days)
- Include "Yours faithfully/sincerely" closing
- Include tenant name at the end

IMPORTANT:
- Do NOT invent legislation that doesn't exist
- Include a note at the bottom: "This letter was generated using RentShield 
  and should be reviewed before sending. Consider seeking professional legal 
  advice from Shelter (0808 800 4444) or Citizens Advice (0800 144 8848)."
"""


class GenerateLetterRequest(BaseModel):
    """Request model for generating a legal letter."""
    letter_type: str = Field(..., description="Type of letter to generate")
    situation: str = Field(
        ...,
        min_length=10,
        max_length=5000,
        description="Description of the situation requiring the letter"
    )
    property_address: str = Field(default="", max_length=500, description="Property address")
    additional_context: str = Field(
        default="",
        max_length=2000,
        description="Any additional details (evidence collected, previous communications, etc.)"
    )


@router.get("/types")
def list_letter_types() -> Dict[str, Any]:
    """Return all available letter types with descriptions."""
    return {"letter_types": LETTER_TYPES}


@router.post("/generate")
async def generate_letter(
    body: GenerateLetterRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Generate a legal letter using AI.

    The letter is tailored to the tenant's situation, cites relevant legislation,
    and follows a professional format suitable for formal correspondence.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    # Validate letter type
    if body.letter_type not in LETTER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid letter type. Choose from: {', '.join(LETTER_TYPES.keys())}"
        )

    letter_info = LETTER_TYPES[body.letter_type]

    # Build the AI prompt
    additional_context = ""
    if body.additional_context.strip():
        additional_context = f"ADDITIONAL CONTEXT:\n{body.additional_context.strip()}"

    prompt_text = LETTER_GENERATION_PROMPT.format(
        letter_type=letter_info["name"],
        letter_description=letter_info["description"],
        tenant_name=user.get("name", "[TENANT NAME]"),
        property_address=body.property_address.strip() or "[PROPERTY ADDRESS]",
        situation=body.situation.strip(),
        additional_context=additional_context,
    )

    # Generate letter using AI
    ai_service = get_ai_service()

    try:
        letter_content = await ai_service.chat_completion(
            user_message=prompt_text,
            context="",
            history="",
            user_type="tenant",
        )
    except Exception as exc:
        logger.error("Error generating letter: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Could not generate the letter. Please try again."
        )

    if not letter_content or letter_content.startswith("Configuration error"):
        raise HTTPException(
            status_code=503,
            detail="AI service unavailable. Please try again later."
        )

    # Save letter to database
    db = get_database()
    letter_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    letter_doc = {
        "letter_id": letter_id,
        "user_id": user["user_id"],
        "letter_type": body.letter_type,
        "letter_type_name": letter_info["name"],
        "situation": body.situation.strip(),
        "property_address": body.property_address.strip(),
        "content": letter_content,
        "created_at": now,
    }

    if db is not None:
        try:
            db["letters"].insert_one(letter_doc)
        except Exception as exc:
            logger.warning("Failed to save letter: %s", exc)

    letter_doc.pop("_id", None)
    return letter_doc


@router.get("")
def list_letters(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """List all previously generated letters for the current tenant."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        return []

    letters = list(
        db["letters"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )

    return letters


@router.delete("/{letter_id}")
def delete_letter(
    letter_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Delete a saved letter."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["letters"].delete_one({
        "letter_id": letter_id,
        "user_id": user["user_id"],
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Letter not found.")

    return {"message": "Letter deleted."}
