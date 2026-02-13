"""
Analytics endpoint routes.

Provides analytics summaries and statistics.
"""

import logging
from typing import Dict, Any

from fastapi import APIRouter, HTTPException

from database.connection import get_analytics_collection, get_conversations_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
def analytics_summary() -> Dict[str, Any]:
    """
    Get analytics summary with aggregated statistics.

    Uses estimated_document_count for total counts (O(1) vs O(n) for large collections)
    and aggregation pipelines for breakdowns.

    Returns:
        Dict with total_sessions, critical_cases, issues breakdown, urgency breakdown.
    """
    analytics_col = get_analytics_collection()
    conversations_col = get_conversations_collection()

    if analytics_col is None or conversations_col is None:
        raise HTTPException(
            status_code=503,
            detail="Analytics database is unavailable.",
        )

    try:
        # Aggregate by issue_type
        issue_pipeline = [
            {
                "$group": {
                    "_id": "$issue_type",
                    "count": {"$sum": 1},
                    "latest": {"$max": "$timestamp"},
                }
            },
            {"$sort": {"count": -1}},
            {"$limit": 50},  # Cap results
        ]
        issue_results = list(analytics_col.aggregate(issue_pipeline))
        issues = [
            {
                "type": doc.get("_id") or "unknown",
                "count": doc.get("count", 0),
            }
            for doc in issue_results
            if doc.get("_id") is not None
        ]

        # Aggregate by urgency level
        urgency_pipeline = [
            {
                "$group": {
                    "_id": "$urgency",
                    "count": {"$sum": 1},
                }
            },
        ]
        urgency_results = list(analytics_col.aggregate(urgency_pipeline))
        urgency = [
            {
                "level": doc.get("_id") or "unknown",
                "count": doc.get("count", 0),
            }
            for doc in urgency_results
            if doc.get("_id") is not None
        ]

        # Use estimated_document_count for fast O(1) totals
        total_sessions = conversations_col.estimated_document_count()
        
        # Get critical count from the urgency aggregation (avoid separate query)
        critical_cases = 0
        for u in urgency:
            if u["level"] == "critical":
                critical_cases = u["count"]
                break

        return {
            "total_sessions": int(total_sessions),
            "critical_cases": int(critical_cases),
            "issues": issues,
            "urgency": urgency,
        }

    except Exception as exc:
        logger.exception("Error generating analytics summary")
        raise HTTPException(
            status_code=500,
            detail="Error generating analytics summary.",
        )
