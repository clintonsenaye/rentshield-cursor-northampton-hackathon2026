"""
Proactive Deadline Tracker — auto-populates deadlines from maintenance, notices, and compliance.

Scans the user's data to find upcoming deadlines and creates a unified
timeline of action-required items with countdown timers.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/deadlines", tags=["deadline_tracker"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class Deadline(BaseModel):
    """A single deadline item."""
    deadline_id: str
    title: str
    description: str
    deadline_date: str
    days_remaining: int
    urgency: str  # overdue, urgent, upcoming, future
    source: str   # maintenance, compliance, notice, custom
    source_id: Optional[str] = None
    action_required: str


class DeadlineListResponse(BaseModel):
    """All deadlines for a user."""
    deadlines: List[Deadline]
    overdue_count: int
    urgent_count: int
    upcoming_count: int


# ---------------------------------------------------------------------------
# Deadline extraction helpers
# ---------------------------------------------------------------------------

def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Safely parse an ISO date string."""
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        return None


def _urgency(days: int) -> str:
    """Classify urgency based on days remaining."""
    if days < 0:
        return "overdue"
    elif days <= 7:
        return "urgent"
    elif days <= 30:
        return "upcoming"
    else:
        return "future"


def _extract_compliance_deadlines(db, landlord_id: str, now: datetime) -> List[Deadline]:
    """Extract deadlines from compliance certificates."""
    items = list(
        db["compliance"]
        .find({"landlord_id": landlord_id}, {"_id": 0})
        .limit(100)
    )

    deadlines = []
    for item in items:
        expiry = _parse_date(item.get("expiry_date"))
        if not expiry:
            continue

        days = (expiry - now).days
        name = item.get("requirement_name", item.get("requirement_id", "Certificate"))

        deadlines.append(Deadline(
            deadline_id=f"compliance-{item.get('requirement_id', 'unknown')}",
            title=f"{name} Renewal",
            description=f"Compliance certificate expires on {expiry.strftime('%d %b %Y')}",
            deadline_date=expiry.isoformat(),
            days_remaining=days,
            urgency=_urgency(days),
            source="compliance",
            source_id=item.get("requirement_id"),
            action_required=f"Renew {name} before expiry to remain legally compliant.",
        ))

    return deadlines


def _extract_maintenance_deadlines(db, user_id: str, role: str, now: datetime) -> List[Deadline]:
    """Extract deadlines from open maintenance requests."""
    query = {"landlord_id": user_id} if role == "landlord" else {"tenant_id": user_id}
    query["status"] = {"$in": ["reported", "in_progress"]}

    requests = list(
        db["maintenance"]
        .find(query, {"_id": 0})
        .sort("created_at", 1)
        .limit(100)
    )

    deadlines = []
    for r in requests:
        created = _parse_date(r.get("created_at"))
        if not created:
            continue

        # Reasonable response deadline: 14 days for standard, 1 day for emergency
        priority = r.get("priority", "standard")
        response_days = 1 if priority == "emergency" else 14
        deadline_dt = created + timedelta(days=response_days)
        days = (deadline_dt - now).days

        title = r.get("title", r.get("description", "Maintenance request"))[:80]

        deadlines.append(Deadline(
            deadline_id=f"maint-{r.get('request_id', 'unknown')}",
            title=f"Respond to: {title}",
            description=f"Maintenance request filed on {created.strftime('%d %b %Y')}",
            deadline_date=deadline_dt.isoformat(),
            days_remaining=days,
            urgency=_urgency(days),
            source="maintenance",
            source_id=r.get("request_id"),
            action_required="Acknowledge and schedule the repair." if role == "landlord" else "Follow up if no response received.",
        ))

    return deadlines


def _extract_notice_deadlines(db, user_id: str, now: datetime) -> List[Deadline]:
    """Extract deadlines from notices (if tracked in conversations)."""
    # Check for notice-related conversations
    notices = list(
        db["conversations"]
        .find(
            {"user_id": user_id, "detected_issue": {"$regex": "notice|eviction|section"}},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(20)
    )

    deadlines = []
    for n in notices:
        created = _parse_date(n.get("created_at"))
        if not created:
            continue

        # Standard notice response window: 14 days
        deadline_dt = created + timedelta(days=14)
        days = (deadline_dt - now).days
        if days < -60:
            continue  # Skip very old items

        deadlines.append(Deadline(
            deadline_id=f"notice-{n.get('conversation_id', 'unknown')}",
            title="Notice Response Deadline",
            description=f"Notice-related conversation from {created.strftime('%d %b %Y')}",
            deadline_date=deadline_dt.isoformat(),
            days_remaining=days,
            urgency=_urgency(days),
            source="notice",
            source_id=n.get("conversation_id"),
            action_required="Review the notice and take action before the deadline.",
        ))

    return deadlines


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=DeadlineListResponse)
def get_deadlines(
    authorization: str = Header(""),
) -> DeadlineListResponse:
    """Get all upcoming deadlines for the current user."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]
    role = user["role"]
    now = datetime.now(timezone.utc)

    deadlines: List[Deadline] = []

    # Compliance deadlines (landlords see their own, tenants see their landlord's)
    if role == "landlord":
        deadlines.extend(_extract_compliance_deadlines(db, user_id, now))
    else:
        landlord_id = user.get("landlord_id")
        if landlord_id:
            deadlines.extend(_extract_compliance_deadlines(db, landlord_id, now))

    # Maintenance deadlines
    deadlines.extend(_extract_maintenance_deadlines(db, user_id, role, now))

    # Notice deadlines (tenants only)
    if role == "tenant":
        deadlines.extend(_extract_notice_deadlines(db, user_id, now))

    # Sort by days remaining (most urgent first)
    deadlines.sort(key=lambda d: d.days_remaining)

    overdue = sum(1 for d in deadlines if d.urgency == "overdue")
    urgent = sum(1 for d in deadlines if d.urgency == "urgent")
    upcoming = sum(1 for d in deadlines if d.urgency == "upcoming")

    return DeadlineListResponse(
        deadlines=deadlines,
        overdue_count=overdue,
        urgent_count=urgent,
        upcoming_count=upcoming,
    )
