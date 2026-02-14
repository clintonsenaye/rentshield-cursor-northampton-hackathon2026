"""
Landlord Reputation Score — aggregated score from compliance, maintenance, and tasks.

Generates a reputation score for landlords based on:
- Compliance status (certificates up to date)
- Maintenance response times
- Task approval rates
- Tenant feedback
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reputation", tags=["reputation"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class ReputationBreakdown(BaseModel):
    """Individual score component."""
    category: str
    score: float = Field(..., ge=0, le=100)
    detail: str


class ReputationResponse(BaseModel):
    """Landlord reputation score and breakdown."""
    landlord_id: str
    overall_score: float = Field(..., ge=0, le=100)
    grade: str  # A+ to F
    breakdown: List[ReputationBreakdown]
    total_tenants: int
    member_since: str


# ---------------------------------------------------------------------------
# Score calculation helpers
# ---------------------------------------------------------------------------

def _grade_from_score(score: float) -> str:
    """Convert numeric score to letter grade."""
    if score >= 95:
        return "A+"
    elif score >= 90:
        return "A"
    elif score >= 85:
        return "A-"
    elif score >= 80:
        return "B+"
    elif score >= 75:
        return "B"
    elif score >= 70:
        return "B-"
    elif score >= 65:
        return "C+"
    elif score >= 60:
        return "C"
    elif score >= 50:
        return "D"
    else:
        return "F"


def _calc_compliance_score(db, landlord_id: str) -> ReputationBreakdown:
    """Score based on compliance certificate status."""
    items = list(
        db["compliance"]
        .find({"landlord_id": landlord_id}, {"_id": 0})
        .limit(100)
    )
    if not items:
        return ReputationBreakdown(
            category="Compliance",
            score=50.0,
            detail="No compliance records — score neutral",
        )

    compliant = sum(1 for i in items if i.get("status") == "compliant")
    total = len(items)
    score = round((compliant / total) * 100, 1) if total > 0 else 50.0

    return ReputationBreakdown(
        category="Compliance",
        score=score,
        detail=f"{compliant}/{total} certificates up to date",
    )


def _calc_maintenance_score(db, landlord_id: str) -> ReputationBreakdown:
    """Score based on maintenance response times."""
    requests = list(
        db["maintenance"]
        .find({"landlord_id": landlord_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )
    if not requests:
        return ReputationBreakdown(
            category="Maintenance",
            score=70.0,
            detail="No maintenance requests yet",
        )

    resolved = 0
    total = len(requests)
    for r in requests:
        if r.get("status") in ("resolved", "completed"):
            resolved += 1

    score = round((resolved / total) * 100, 1) if total > 0 else 70.0

    return ReputationBreakdown(
        category="Maintenance",
        score=score,
        detail=f"{resolved}/{total} requests resolved",
    )


def _calc_task_score(db, landlord_id: str) -> ReputationBreakdown:
    """Score based on task management and approval."""
    tasks = list(
        db["tasks"]
        .find({"landlord_id": landlord_id}, {"_id": 0})
        .limit(200)
    )
    if not tasks:
        return ReputationBreakdown(
            category="Task Management",
            score=70.0,
            detail="No tasks created yet",
        )

    approved = sum(1 for t in tasks if t.get("status") in ("approved", "completed"))
    total = len(tasks)
    score = round((approved / total) * 100, 1) if total > 0 else 70.0

    return ReputationBreakdown(
        category="Task Management",
        score=score,
        detail=f"{approved}/{total} tasks completed/approved",
    )


def _calc_tenant_count(db, landlord_id: str) -> int:
    """Count active tenants for the landlord."""
    return db["users"].count_documents({
        "landlord_id": landlord_id,
        "role": "tenant",
    })


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{landlord_id}", response_model=ReputationResponse)
def get_landlord_reputation(
    landlord_id: str,
    authorization: str = Header(""),
) -> ReputationResponse:
    """Get the reputation score for a landlord."""
    user, error = require_role(authorization, ["tenant", "landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Verify the landlord exists
    landlord = db["users"].find_one(
        {"user_id": landlord_id, "role": "landlord"},
        {"_id": 0, "created_at": 1, "user_id": 1},
    )
    if not landlord:
        raise HTTPException(status_code=404, detail="Landlord not found")

    # Calculate each component
    compliance = _calc_compliance_score(db, landlord_id)
    maintenance = _calc_maintenance_score(db, landlord_id)
    tasks = _calc_task_score(db, landlord_id)

    breakdown = [compliance, maintenance, tasks]

    # Weighted average: compliance 40%, maintenance 35%, tasks 25%
    overall = round(
        compliance.score * 0.40 +
        maintenance.score * 0.35 +
        tasks.score * 0.25,
        1,
    )

    tenant_count = _calc_tenant_count(db, landlord_id)
    member_since = landlord.get("created_at", "Unknown")

    return ReputationResponse(
        landlord_id=landlord_id,
        overall_score=overall,
        grade=_grade_from_score(overall),
        breakdown=breakdown,
        total_tenants=tenant_count,
        member_since=member_since,
    )


@router.get("/my/score", response_model=ReputationResponse)
def get_my_reputation(
    authorization: str = Header(""),
) -> ReputationResponse:
    """Get reputation score for the currently logged-in landlord."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return get_landlord_reputation(user["user_id"], authorization)
