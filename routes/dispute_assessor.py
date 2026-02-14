"""
AI Dispute Strength Assessor — scores a tenant's case across key dimensions.

Analyses the user's collected evidence, timeline, and correspondence to give
a dispute readiness score with specific recommendations for strengthening
the case.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dispute-assessor", tags=["dispute_assessor"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class DimensionScore(BaseModel):
    """Score for a single dispute dimension."""
    dimension: str
    score: int = Field(..., ge=0, le=100)
    max_score: int = 100
    items_found: int
    recommendation: str


class DisputeAssessmentResponse(BaseModel):
    """Full dispute strength assessment."""
    overall_score: int = Field(..., ge=0, le=100)
    grade: str
    summary: str
    dimensions: List[DimensionScore]
    strengths: List[str]
    weaknesses: List[str]
    next_steps: List[str]


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _grade(score: int) -> str:
    if score >= 80:
        return "Strong"
    elif score >= 60:
        return "Moderate"
    elif score >= 40:
        return "Developing"
    else:
        return "Weak"


def _assess_evidence(db, user_id: str) -> DimensionScore:
    """Score based on evidence quantity and variety."""
    evidence = list(
        db["evidence"]
        .find({"user_id": user_id}, {"_id": 0, "evidence_type": 1})
        .limit(200)
    )
    count = len(evidence)
    types = set(e.get("evidence_type", "unknown") for e in evidence)

    # Score: 20 per piece up to 5, bonus for type variety
    base = min(count * 20, 80)
    variety_bonus = min(len(types) * 5, 20)
    score = min(base + variety_bonus, 100)

    if count == 0:
        rec = "Upload photos, screenshots, or documents to your Evidence Locker to strengthen your case."
    elif count < 3:
        rec = "Good start! Try to collect at least 3-5 pieces of evidence covering different aspects."
    elif len(types) < 2:
        rec = "Your evidence is solid but limited to one type. Add different types (photos, emails, letters)."
    else:
        rec = "Excellent evidence collection. Keep adding timestamped items as your situation develops."

    return DimensionScore(
        dimension="Evidence Collection",
        score=score,
        items_found=count,
        recommendation=rec,
    )


def _assess_timeline(db, user_id: str) -> DimensionScore:
    """Score based on timeline documentation."""
    events = list(
        db["timeline"]
        .find({"user_id": user_id}, {"_id": 0})
        .limit(200)
    )
    count = len(events)

    score = min(count * 15, 100)

    if count == 0:
        rec = "Start building your dispute timeline with key dates and events."
    elif count < 5:
        rec = "Add more timeline entries — include every interaction, report, and response."
    else:
        rec = "Well-documented timeline. Ensure all dates are accurate and entries are in order."

    return DimensionScore(
        dimension="Timeline Documentation",
        score=score,
        items_found=count,
        recommendation=rec,
    )


def _assess_correspondence(db, user_id: str) -> DimensionScore:
    """Score based on letters and formal correspondence."""
    letters = list(
        db["letters"]
        .find({"user_id": user_id}, {"_id": 0})
        .limit(100)
    )
    count = len(letters)

    score = min(count * 25, 100)

    if count == 0:
        rec = "Generate formal letters to your landlord using the Letter Generator. Written records are crucial."
    elif count < 3:
        rec = "Good start with formal correspondence. Make sure each issue has a dated letter."
    else:
        rec = "Strong paper trail established. Keep copies of all sent correspondence."

    return DimensionScore(
        dimension="Formal Correspondence",
        score=score,
        items_found=count,
        recommendation=rec,
    )


def _assess_maintenance(db, user_id: str) -> DimensionScore:
    """Score based on maintenance reports filed."""
    reports = list(
        db["maintenance"]
        .find({"tenant_id": user_id}, {"_id": 0, "status": 1})
        .limit(100)
    )
    count = len(reports)
    documented = sum(1 for r in reports if r.get("status") in ("reported", "in_progress", "resolved"))

    score = min(count * 20, 100)

    if count == 0:
        rec = "If you have repair issues, file maintenance requests to create a formal record."
    elif documented < count:
        rec = "Follow up on outstanding maintenance requests and document all responses."
    else:
        rec = "Maintenance issues are well-documented. Keep records of all landlord responses."

    return DimensionScore(
        dimension="Maintenance Reports",
        score=score,
        items_found=count,
        recommendation=rec,
    )


def _assess_chat_usage(db, user_id: str) -> DimensionScore:
    """Score based on legal guidance sought."""
    convos = db["conversations"].count_documents({"user_id": user_id})
    score = min(convos * 10, 100)

    if convos == 0:
        rec = "Use the AI Chat to get legal guidance on your specific situation."
    elif convos < 5:
        rec = "Continue seeking legal guidance. Ask about your specific rights and next steps."
    else:
        rec = "You've been proactive in seeking guidance. Consider professional legal advice too."

    return DimensionScore(
        dimension="Legal Research",
        score=score,
        items_found=convos,
        recommendation=rec,
    )


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("", response_model=DisputeAssessmentResponse)
def assess_dispute_strength(
    authorization: str = Header(""),
) -> DisputeAssessmentResponse:
    """Assess the overall strength of the tenant's dispute case."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]

    # Assess each dimension
    dimensions = [
        _assess_evidence(db, user_id),
        _assess_timeline(db, user_id),
        _assess_correspondence(db, user_id),
        _assess_maintenance(db, user_id),
        _assess_chat_usage(db, user_id),
    ]

    # Weighted overall: evidence 30%, timeline 25%, correspondence 20%, maintenance 15%, research 10%
    weights = [0.30, 0.25, 0.20, 0.15, 0.10]
    overall = round(sum(d.score * w for d, w in zip(dimensions, weights)))
    grade = _grade(overall)

    # Build strengths and weaknesses
    strengths = [d.dimension for d in dimensions if d.score >= 60]
    weaknesses = [d.dimension for d in dimensions if d.score < 40]

    # Build next steps from lowest scoring dimensions
    sorted_dims = sorted(dimensions, key=lambda d: d.score)
    next_steps = [d.recommendation for d in sorted_dims[:3] if d.score < 80]

    # Summary
    if overall >= 80:
        summary = "Your case is well-documented and strong. You have good evidence across multiple dimensions."
    elif overall >= 60:
        summary = "Your case has a reasonable foundation but could be strengthened in some areas."
    elif overall >= 40:
        summary = "Your case is developing but needs more documentation. Focus on the recommended next steps."
    else:
        summary = "Your case needs significant strengthening. Start by collecting evidence and documenting your timeline."

    return DisputeAssessmentResponse(
        overall_score=overall,
        grade=grade,
        summary=summary,
        dimensions=dimensions,
        strengths=strengths,
        weaknesses=weaknesses,
        next_steps=next_steps,
    )
