"""
Deposit Protection Checker routes.

Helps tenants check whether their deposit is protected with one of the
three UK government-approved deposit protection schemes, and explains
their rights if it is not.
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

router = APIRouter(prefix="/api/deposit", tags=["deposit"])


# UK government-approved deposit protection schemes
DEPOSIT_SCHEMES = {
    "dps": {
        "name": "Deposit Protection Service (DPS)",
        "type": "Custodial (free) or Insured",
        "website": "https://www.depositprotection.com",
        "phone": "0330 303 0030",
        "check_url": "https://www.depositprotection.com/is-my-deposit-protected",
    },
    "mydeposits": {
        "name": "Mydeposits",
        "type": "Insured or Custodial",
        "website": "https://www.mydeposits.co.uk",
        "phone": "0333 321 9401",
        "check_url": "https://www.mydeposits.co.uk/tenants/deposit-checker/",
    },
    "tds": {
        "name": "Tenancy Deposit Scheme (TDS)",
        "type": "Custodial (free) or Insured",
        "website": "https://www.tenancydepositscheme.com",
        "phone": "0300 037 1000",
        "check_url": "https://www.tenancydepositscheme.com/is-my-deposit-protected/",
    },
}


# AI prompt for deposit rights explanation
DEPOSIT_RIGHTS_PROMPT = """
You are RentShield's Deposit Protection Advisor, an expert in UK housing law.

A tenant has provided their deposit details. Analyze their situation and provide
detailed, actionable advice.

TENANT DETAILS:
- Deposit amount: £{deposit_amount}
- Date paid: {date_paid}
- Scheme name (if known): {scheme_name}
- Landlord provided prescribed information: {has_prescribed_info}
- Additional notes: {notes}

Provide a STRUCTURED response with the following sections using markdown:

## Your Rights

Explain the tenant's key rights under the Housing Act 2004 (as amended):
- Deposit MUST be protected within 30 days of receipt
- Landlord MUST provide "prescribed information" within 30 days
- If not protected: tenant can claim 1x to 3x the deposit amount
- Landlord cannot serve a valid Section 21 notice if deposit is unprotected
  (note: Section 21 is abolished under Renters' Rights Act 2025, but deposit
  protection is still required)

## Assessment

Based on the information provided, assess the tenant's situation:
- Is the deposit likely protected correctly?
- Are there any red flags?
- What deadlines may have passed?

## Steps to Check Protection

Provide specific steps to verify deposit protection:
1. Check all three schemes (provide the actual URLs)
2. What information to look for
3. What to do if not found in any scheme

## If Your Deposit Is NOT Protected

Explain the legal remedies available:
- County Court claim for 1-3x deposit compensation
- How to file a claim
- Time limits for claims
- Legal aid options

## Recommended Actions

3-5 specific, actionable next steps including:
- Contact details for Shelter (0808 800 4444) and Citizens Advice (0800 144 8848)
- When to seek legal advice
- Template letter references

IMPORTANT:
- Only cite legislation that actually exists
- Be specific about timeframes and amounts
- Add disclaimer: "This guidance is for information only. For binding legal advice,
  consult a solicitor or contact Shelter."
"""


class CheckDepositRequest(BaseModel):
    """Request model for checking deposit protection."""
    deposit_amount: float = Field(..., gt=0, description="Deposit amount in GBP")
    date_paid: str = Field(default="", description="Date deposit was paid (approximate)")
    scheme_name: str = Field(default="", description="Name of scheme if known")
    has_prescribed_info: bool = Field(
        default=False,
        description="Whether landlord provided prescribed information document"
    )
    notes: str = Field(
        default="",
        max_length=2000,
        description="Any additional details about the deposit situation"
    )


@router.get("/schemes")
def list_schemes() -> Dict[str, Any]:
    """Return details of all three UK deposit protection schemes."""
    return {"schemes": DEPOSIT_SCHEMES}


@router.post("/check")
async def check_deposit(
    body: CheckDepositRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Analyze the tenant's deposit situation and provide detailed guidance
    on their rights, how to verify protection, and next steps.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    prompt_text = DEPOSIT_RIGHTS_PROMPT.format(
        deposit_amount=body.deposit_amount,
        date_paid=body.date_paid or "Not specified",
        scheme_name=body.scheme_name or "Not known",
        has_prescribed_info="Yes" if body.has_prescribed_info else "No",
        notes=body.notes.strip() or "None provided",
    )

    ai_service = get_ai_service()

    try:
        guidance = await ai_service.chat_completion(
            user_message=prompt_text,
            context="",
            history="",
            user_type="tenant",
        )
    except Exception as exc:
        logger.error("Error checking deposit: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Could not analyze deposit situation. Please try again."
        )

    if not guidance or guidance.startswith("Configuration error"):
        raise HTTPException(
            status_code=503,
            detail="AI service unavailable. Please try again later."
        )

    # Save to database
    db = get_database()
    check_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    check_doc = {
        "check_id": check_id,
        "user_id": user["user_id"],
        "deposit_amount": body.deposit_amount,
        "date_paid": body.date_paid,
        "scheme_name": body.scheme_name,
        "has_prescribed_info": body.has_prescribed_info,
        "guidance": guidance,
        "created_at": now,
    }

    if db is not None:
        try:
            db["deposit_checks"].insert_one(check_doc)
        except Exception as exc:
            logger.warning("Failed to save deposit check: %s", exc)

    check_doc.pop("_id", None)
    return check_doc


@router.get("/history")
def list_deposit_checks(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """List previous deposit checks for the current tenant."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        return []

    checks = list(
        db["deposit_checks"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(20)
    )

    return checks
