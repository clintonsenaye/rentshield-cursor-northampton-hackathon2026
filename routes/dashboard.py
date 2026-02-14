"""
Dashboard Home Screen routes.

Provides a summary overview for each user role:
- Tenants: active maintenance, pending tasks, wellbeing streak, points
- Landlords: tenant count, open maintenance, overdue compliance, pending tasks
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from fastapi import APIRouter, Header, HTTPException

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
def get_dashboard(
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Get a role-specific dashboard summary.

    Returns key metrics and alerts relevant to the user's role.
    """
    user, error = require_role(authorization, ["tenant", "landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    role = user["role"]
    user_id = user["user_id"]

    if role == "tenant":
        return _tenant_dashboard(db, user_id, user)
    elif role == "landlord":
        return _landlord_dashboard(db, user_id)
    else:
        return _admin_dashboard(db)


def _tenant_dashboard(db, user_id: str, user: dict) -> Dict[str, Any]:
    """Build tenant dashboard data."""
    now = datetime.now(timezone.utc)

    # Active maintenance requests
    active_maintenance = list(
        db["maintenance"]
        .find(
            {"tenant_id": user_id, "status": {"$in": ["reported", "acknowledged", "in_progress"]}},
            {"_id": 0, "request_id": 1, "category_name": 1, "status": 1, "deadline": 1, "description": 1},
        )
        .sort("reported_at", -1)
        .limit(5)
    )

    # Flag overdue
    overdue_count = 0
    for req in active_maintenance:
        deadline = req.get("deadline", "")
        if deadline:
            try:
                req["is_overdue"] = now > datetime.fromisoformat(deadline)
                if req["is_overdue"]:
                    overdue_count += 1
            except (ValueError, TypeError):
                req["is_overdue"] = False

    # Pending tasks from landlord
    pending_tasks = db["tasks"].count_documents(
        {"tenant_id": user_id, "status": "pending"}
    )

    # Points and rewards
    rewards = db["rewards"].find_one(
        {"session_id": user_id}, {"_id": 0, "total_points": 1}
    )
    total_points = rewards.get("total_points", 0) if rewards else user.get("points", 0)

    # Wellbeing streak (count consecutive days with entries)
    recent_entries = list(
        db["wellbeing_journal"]
        .find({"session_id": user_id}, {"_id": 0, "created_at": 1})
        .sort("created_at", -1)
        .limit(30)
    )
    streak = _calculate_streak(recent_entries)

    # Recent chat count (scoped to this user)
    conversation_count = db["conversations"].count_documents({"user_id": user_id})

    # Evidence count
    evidence_count = db["evidence"].count_documents({"user_id": user_id})

    return {
        "role": "tenant",
        "name": user.get("name", ""),
        "active_maintenance": active_maintenance,
        "overdue_maintenance_count": overdue_count,
        "pending_tasks": pending_tasks,
        "total_points": total_points,
        "wellbeing_streak": streak,
        "conversation_count": conversation_count,
        "evidence_count": evidence_count,
    }


def _landlord_dashboard(db, user_id: str) -> Dict[str, Any]:
    """Build landlord dashboard data."""
    now = datetime.now(timezone.utc)

    # Tenant count
    tenant_count = db["users"].count_documents(
        {"landlord_id": user_id, "role": "tenant"}
    )

    # Open maintenance requests
    open_maintenance = db["maintenance"].count_documents(
        {"landlord_id": user_id, "status": {"$in": ["reported", "escalated"]}}
    )

    # Overdue maintenance
    overdue_requests = list(
        db["maintenance"]
        .find(
            {"landlord_id": user_id, "status": {"$in": ["reported", "acknowledged"]}},
            {"_id": 0, "deadline": 1},
        )
    )
    overdue_count = 0
    for req in overdue_requests:
        deadline = req.get("deadline", "")
        if deadline:
            try:
                if now > datetime.fromisoformat(deadline):
                    overdue_count += 1
            except (ValueError, TypeError):
                pass

    # Pending task submissions awaiting verification
    pending_verifications = db["tasks"].count_documents(
        {"landlord_id": user_id, "status": "submitted"}
    )

    # Compliance score
    compliance_doc = db["compliance"].find_one(
        {"user_id": user_id}, {"_id": 0, "items": 1}
    )
    compliance_score = _calculate_compliance_score(compliance_doc)

    # Pending perk claims
    pending_claims = db["perk_claims"].count_documents(
        {"landlord_id": user_id, "fulfilled": {"$ne": True}}
    )

    return {
        "role": "landlord",
        "tenant_count": tenant_count,
        "open_maintenance": open_maintenance,
        "overdue_maintenance": overdue_count,
        "pending_verifications": pending_verifications,
        "compliance_score": compliance_score,
        "pending_perk_claims": pending_claims,
    }


def _admin_dashboard(db) -> Dict[str, Any]:
    """Build admin dashboard data."""
    return {
        "role": "admin",
        "total_landlords": db["users"].count_documents({"role": "landlord"}),
        "total_tenants": db["users"].count_documents({"role": "tenant"}),
        "total_conversations": db["conversations"].estimated_document_count(),
        "total_maintenance": db["maintenance"].estimated_document_count(),
    }


def _calculate_streak(entries: list) -> int:
    """Calculate consecutive days with wellbeing entries."""
    if not entries:
        return 0

    dates = set()
    for entry in entries:
        created = entry.get("created_at")
        if created:
            if isinstance(created, str):
                try:
                    created = datetime.fromisoformat(created)
                except (ValueError, TypeError):
                    continue
            dates.add(created.date())

    if not dates:
        return 0

    today = datetime.now(timezone.utc).date()
    streak = 0
    check_date = today
    while check_date in dates:
        streak += 1
        check_date -= timedelta(days=1)

    return streak


def _calculate_compliance_score(compliance_doc: dict) -> int:
    """Calculate compliance percentage from stored items."""
    if not compliance_doc or not compliance_doc.get("items"):
        return 0

    items = compliance_doc["items"]
    if not items:
        return 0

    total = len(items)
    compliant = sum(
        1 for item in items.values()
        if isinstance(item, dict) and item.get("status") == "compliant"
    )

    return round((compliant / total) * 100) if total > 0 else 0
