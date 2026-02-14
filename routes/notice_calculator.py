"""
Notice Validity Calculator (deterministic wizard).

Validates landlord notices based on hard legal rules — dates, minimum notice
periods, and prescribed requirements — without relying on the LLM.

This is more reliable than AI for date-based legal calculations.
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notice-calculator", tags=["notice-calculator"])


# Notice types and their legal requirements under Renters' Rights Act 2025
NOTICE_RULES = {
    "section_8": {
        "name": "Section 8 (Fault-Based Eviction)",
        "description": "Used when a tenant has breached the tenancy agreement (e.g. rent arrears, antisocial behaviour).",
        "min_notice_days": {
            "rent_arrears_2_months": 14,
            "antisocial_behaviour": 0,
            "other_grounds": 28,
        },
        "prescribed_requirements": [
            "Notice must be in writing",
            "Must specify the ground(s) for possession",
            "Must give the correct notice period for each ground",
            "Must be served on the tenant (not just posted through letterbox)",
        ],
        "source": "Housing Act 1988, Section 8 (as amended by Renters' Rights Act 2025)",
    },
    "rent_increase": {
        "name": "Section 13 (Rent Increase)",
        "description": "Landlord proposes a rent increase via formal notice.",
        "min_notice_days": {
            "default": 60,
        },
        "prescribed_requirements": [
            "Must use Form 4 (or prescribed form)",
            "Must give at least 2 months' notice",
            "Can only increase rent once per year",
            "Must not be used within the first 12 months of tenancy",
            "Tenant can challenge at First-tier Tribunal within the notice period",
        ],
        "source": "Housing Act 1988, Section 13 (as amended by Renters' Rights Act 2025)",
    },
    "landlord_notice_to_end": {
        "name": "Landlord Notice to End Tenancy",
        "description": "Under Renters' Rights Act 2025, Section 21 no-fault evictions are abolished. Landlord must use valid grounds.",
        "min_notice_days": {
            "selling_property": 120,
            "moving_in": 120,
            "other_no_fault": 120,
        },
        "prescribed_requirements": [
            "Section 21 no-fault evictions are ABOLISHED — landlords cannot use them",
            "Must use a valid ground under the new legislation",
            "Must give at least 4 months' notice for no-fault grounds (selling, moving in)",
            "Must have owned the property for at least 12 months before serving notice",
            "Must provide prescribed information (gas safety, EPC, How to Rent guide)",
        ],
        "source": "Renters' Rights Act 2025",
    },
    "tenant_notice": {
        "name": "Tenant Notice to Leave",
        "description": "Tenant gives notice to end a periodic tenancy.",
        "min_notice_days": {
            "default": 28,
        },
        "prescribed_requirements": [
            "Must give at least 4 weeks' notice",
            "Must be in writing",
            "Notice period runs from the next rent due date",
        ],
        "source": "Renters' Rights Act 2025",
    },
}


class NoticeCalculatorRequest(BaseModel):
    """Request for the notice validity calculator."""
    notice_type: str = Field(..., description="Type of notice (section_8, rent_increase, landlord_notice_to_end, tenant_notice)")
    date_received: str = Field(..., description="Date the notice was received (YYYY-MM-DD)")
    effective_date: str = Field(..., description="Date the notice says you must leave/pay (YYYY-MM-DD)")
    ground: str = Field(default="default", description="Specific ground if applicable")
    has_prescribed_info: bool = Field(default=False, description="Whether landlord has provided all prescribed information")
    tenancy_start_date: str = Field(default="", description="When the tenancy started (YYYY-MM-DD), if known")


class NoticeValidityResult(BaseModel):
    """Result of the notice validity calculation."""
    is_valid: bool
    notice_type_name: str
    problems: List[str]
    minimum_notice_required_days: int
    actual_notice_given_days: int
    prescribed_requirements: List[str]
    actions: List[str]
    source: str


@router.get("/types")
def list_notice_types() -> Dict[str, Any]:
    """Return all notice types with their rules and requirements."""
    return {"notice_types": NOTICE_RULES}


@router.post("/validate")
def validate_notice(request: NoticeCalculatorRequest) -> NoticeValidityResult:
    """
    Validate a notice using deterministic legal rules.

    Checks minimum notice periods, prescribed requirements,
    and other hard legal constraints.
    """
    rules = NOTICE_RULES.get(request.notice_type)
    if not rules:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown notice type. Valid types: {', '.join(NOTICE_RULES.keys())}"
        )

    problems: List[str] = []
    actions: List[str] = []

    # Parse dates
    try:
        date_received = datetime.strptime(request.date_received, "%Y-%m-%d")
        effective_date = datetime.strptime(request.effective_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")

    # Calculate actual notice period given
    actual_days = (effective_date - date_received).days

    # Get minimum required notice period
    min_notice_options = rules["min_notice_days"]
    ground = request.ground if request.ground in min_notice_options else "default"
    # If no default, use the first available ground's value
    if ground not in min_notice_options:
        ground = next(iter(min_notice_options))
    min_days = min_notice_options[ground]

    # Check 1: Sufficient notice period
    if actual_days < min_days:
        problems.append(
            f"Insufficient notice period: {actual_days} days given, "
            f"but minimum {min_days} days required."
        )
        actions.append(
            "The notice period is too short. You may be able to challenge this notice."
        )

    # Check 2: Notice in the future
    if effective_date <= date_received:
        problems.append("The effective date is on or before the date received — this is invalid.")

    # Check 3: Prescribed information
    if not request.has_prescribed_info:
        problems.append(
            "Landlord has not provided all prescribed information "
            "(gas safety certificate, EPC, How to Rent guide)."
        )
        actions.append(
            "Without prescribed information, certain notices may be invalid. "
            "Ask your landlord to provide all required documents."
        )

    # Check 4: Section 21 abolition
    if request.notice_type == "landlord_notice_to_end":
        actions.append(
            "Remember: Section 21 no-fault evictions are abolished under the "
            "Renters' Rights Act 2025. Your landlord must have a valid ground."
        )

    # Check 5: Tenancy duration for no-fault grounds
    if request.notice_type == "landlord_notice_to_end" and request.tenancy_start_date:
        try:
            tenancy_start = datetime.strptime(request.tenancy_start_date, "%Y-%m-%d")
            months_since_start = (date_received - tenancy_start).days / 30.44
            if months_since_start < 12:
                problems.append(
                    f"Tenancy started only {int(months_since_start)} months ago. "
                    "Landlord must wait at least 12 months before serving this type of notice."
                )
        except ValueError:
            pass

    # Check 6: Rent increase frequency
    if request.notice_type == "rent_increase":
        actions.append(
            "You can challenge this rent increase at the First-tier Tribunal "
            "before the notice period expires. The tribunal will set a market rate."
        )

    # Standard actions
    if problems:
        actions.append("Contact Shelter (0808 800 4444) or Citizens Advice (0800 144 8848) for help.")
        actions.append("Do NOT leave your property — an invalid notice does not require you to move out.")
    else:
        actions.append(
            "The notice appears to meet the minimum legal requirements, but you should "
            "still seek professional advice about your specific circumstances."
        )

    is_valid = len(problems) == 0

    return NoticeValidityResult(
        is_valid=is_valid,
        notice_type_name=rules["name"],
        problems=problems,
        minimum_notice_required_days=min_days,
        actual_notice_given_days=actual_days,
        prescribed_requirements=rules["prescribed_requirements"],
        actions=actions,
        source=rules["source"],
    )
