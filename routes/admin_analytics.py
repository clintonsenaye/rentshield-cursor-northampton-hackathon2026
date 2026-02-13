"""
Admin analytics dashboard routes.

Provides comprehensive analytics for administrators including
user statistics, issue trends, and system health metrics.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict

from fastapi import APIRouter, Header, HTTPException

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["admin-analytics"])


@router.get("")
def get_admin_analytics(
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Get comprehensive analytics for the admin dashboard.

    Returns user counts, issue breakdown, urgency distribution,
    maintenance stats, and recent activity.
    Requires admin role.
    """
    user, error = require_role(authorization, ["admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    try:
        # --- User counts by role ---
        users_col = db["users"]
        total_landlords = users_col.count_documents({"role": "landlord"})
        total_tenants = users_col.count_documents({"role": "tenant"})
        total_admins = users_col.count_documents({"role": "admin"})

        # --- Issue breakdown from analytics ---
        analytics_col = db["analytics"]
        issue_pipeline = [
            {"$group": {"_id": "$issue_type", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": 20},
        ]
        issue_results = list(analytics_col.aggregate(issue_pipeline))
        issues = [
            {"type": doc.get("_id") or "unknown", "count": doc.get("count", 0)}
            for doc in issue_results
            if doc.get("_id") is not None
        ]

        # --- Urgency distribution ---
        urgency_pipeline = [
            {"$group": {"_id": "$urgency", "count": {"$sum": 1}}},
        ]
        urgency_results = list(analytics_col.aggregate(urgency_pipeline))
        urgency = [
            {"level": doc.get("_id") or "unknown", "count": doc.get("count", 0)}
            for doc in urgency_results
            if doc.get("_id") is not None
        ]

        # --- Conversation stats ---
        conversations_col = db["conversations"]
        total_conversations = conversations_col.estimated_document_count()

        # --- Maintenance stats ---
        maint_col = db["maintenance"]
        maint_open = maint_col.count_documents({"status": {"$in": ["pending", "in_progress"]}})
        maint_resolved = maint_col.count_documents({"status": "resolved"})
        maint_total = maint_col.estimated_document_count()

        # --- Recent activity (last 10 analytics events) ---
        recent_pipeline = [
            {"$sort": {"timestamp": -1}},
            {"$limit": 10},
            {"$project": {"_id": 0, "issue_type": 1, "urgency": 1, "user_type": 1, "timestamp": 1}},
        ]
        recent = list(analytics_col.aggregate(recent_pipeline))
        for item in recent:
            if "timestamp" in item and isinstance(item["timestamp"], datetime):
                item["timestamp"] = item["timestamp"].isoformat()

        # --- Wellbeing stats ---
        wellbeing_col = db["wellbeing_journal"]
        mood_pipeline = [
            {"$group": {"_id": None, "avg_mood": {"$avg": "$mood"}, "count": {"$sum": 1}}},
        ]
        mood_result = list(wellbeing_col.aggregate(mood_pipeline))
        avg_mood = round(mood_result[0]["avg_mood"], 1) if mood_result else 0
        journal_entries = mood_result[0]["count"] if mood_result else 0

        return {
            "users": {
                "landlords": total_landlords,
                "tenants": total_tenants,
                "admins": total_admins,
                "total": total_landlords + total_tenants + total_admins,
            },
            "issues": issues,
            "urgency": urgency,
            "conversations": total_conversations,
            "maintenance": {
                "open": maint_open,
                "resolved": maint_resolved,
                "total": maint_total,
            },
            "wellbeing": {
                "average_mood": avg_mood,
                "journal_entries": journal_entries,
            },
            "recent_activity": recent,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to generate admin analytics: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate analytics.")
