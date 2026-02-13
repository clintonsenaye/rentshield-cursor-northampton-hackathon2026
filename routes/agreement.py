"""
Tenancy Agreement Analyzer routes.

Allows tenants to paste or upload their tenancy agreement text and have
the AI flag unfair clauses, illegal terms, and missing required information
under the Renters' Rights Act 2025 and related legislation.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from services.ai_service import get_ai_service
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agreement", tags=["agreement"])


# AI prompt for analyzing tenancy agreements
AGREEMENT_ANALYSIS_PROMPT = """
You are RentShield's Tenancy Agreement Analyzer, an expert in UK housing law.

A tenant has provided text from their tenancy agreement. Analyze it thoroughly.

TENANCY AGREEMENT TEXT:
---
{agreement_text}
---

Produce a STRUCTURED analysis with the following sections. Use markdown formatting.

## Summary
A brief 2-3 sentence overview of this agreement — is it broadly fair, or are there
significant concerns?

## Illegal or Unenforceable Clauses
List any clauses that are ILLEGAL under current UK law, including:
- Blanket pet bans (Renters' Rights Act 2025 gives tenants the right to request pets)
- No-DSS / discriminatory clauses (illegal under Equality Act 2010)
- Section 21 no-fault eviction clauses (abolished under Renters' Rights Act 2025)
- Clauses requiring tenants to pay landlord's legal fees
- Excessive penalty clauses
- Clauses that attempt to waive the tenant's statutory rights
For each, cite the relevant legislation and explain why it's unenforceable.

## Unfair Terms
List clauses that may be UNFAIR under the Consumer Rights Act 2015 / Unfair
Contract Terms Act 1977, including:
- Unreasonable restrictions on guests or decoration
- Excessive cleaning fees or deductions
- One-sided break clauses
- Unreasonable inspection frequency
- Clauses that shift landlord responsibilities to the tenant

## Missing Required Information
Flag any information that SHOULD be included but is missing:
- Landlord's legal name and address (required for serving notices)
- Deposit protection scheme details (Housing Act 2004)
- Gas Safety certificate reference
- Energy Performance Certificate (EPC) rating
- How to Rent guide acknowledgment
- Smoke and CO alarm compliance
- Electrical safety certificate

## Positive Points
Note any tenant-friendly or well-drafted clauses.

## Recommended Actions
Provide 3-5 specific next steps the tenant should take, such as:
- Contact Shelter (0808 800 4444) or Citizens Advice (0800 144 8848)
- Challenge specific clauses in writing
- Request missing documentation

IMPORTANT:
- Be specific — reference actual clause numbers/text from the agreement
- Only cite legislation that actually exists
- If the text is too short or unclear to analyze properly, say so
- Add a disclaimer: "This analysis is for guidance only. For binding legal advice,
  consult a solicitor or contact Shelter."
"""


class AnalyzeAgreementRequest(BaseModel):
    """Request model for analyzing a tenancy agreement."""
    agreement_text: str = Field(
        ...,
        min_length=50,
        max_length=50000,
        description="The full text of the tenancy agreement"
    )


@router.post("/analyze")
async def analyze_agreement(
    body: AnalyzeAgreementRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Analyze a tenancy agreement using AI to flag illegal, unfair,
    or missing clauses.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    prompt_text = AGREEMENT_ANALYSIS_PROMPT.format(
        agreement_text=body.agreement_text.strip()
    )

    ai_service = get_ai_service()

    try:
        analysis = await ai_service.chat_completion(
            user_message=prompt_text,
            context="",
            history="",
            user_type="tenant",
        )
    except Exception as exc:
        logger.error("Error analyzing agreement: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Could not analyze the agreement. Please try again."
        )

    if not analysis or analysis.startswith("Configuration error"):
        raise HTTPException(
            status_code=503,
            detail="AI service unavailable. Please try again later."
        )

    # Save to database for history
    db = get_database()
    analysis_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    analysis_doc = {
        "analysis_id": analysis_id,
        "user_id": user["user_id"],
        "agreement_preview": body.agreement_text[:300],
        "analysis": analysis,
        "created_at": now,
    }

    if db is not None:
        try:
            db["agreement_analyses"].insert_one(analysis_doc)
        except Exception as exc:
            logger.warning("Failed to save analysis: %s", exc)

    analysis_doc.pop("_id", None)
    return analysis_doc


@router.get("/history")
def list_analyses(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """List previous agreement analyses for the current tenant."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        return []

    analyses = list(
        db["agreement_analyses"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(20)
    )

    return analyses


@router.delete("/{analysis_id}")
def delete_analysis(
    analysis_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Delete a saved agreement analysis."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["agreement_analyses"].delete_one({
        "analysis_id": analysis_id,
        "user_id": user["user_id"],
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Analysis not found.")

    return {"message": "Analysis deleted."}
