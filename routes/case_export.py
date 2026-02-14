"""
Case Export Bundle routes.

Generates a comprehensive case file (JSON bundle) containing all of a tenant's
evidence, timeline events, chat history, letters, notices, maintenance requests,
and deposit checks — packaged for a solicitor or tribunal.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/case-export", tags=["case-export"])


@router.get("")
def export_case_bundle(
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Export a complete case file for the authenticated tenant.

    Collects all user data across collections into a single structured
    JSON bundle suitable for a solicitor or housing tribunal.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]
    now = datetime.now(timezone.utc).isoformat()

    # Collect evidence
    evidence = list(
        db["evidence"]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(500)
    )

    # Collect timeline events
    timeline = list(
        db["timeline"]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("event_date", 1)
        .limit(500)
    )

    # Collect generated letters
    letters = list(
        db["letters"]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )

    # Collect agreement analyses
    analyses = list(
        db["agreement_analyses"]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )

    # Collect deposit checks
    deposit_checks = list(
        db["deposit_checks"]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(200)
    )

    # Collect maintenance requests
    maintenance = list(
        db["maintenance"]
        .find({"tenant_id": user_id}, {"_id": 0})
        .sort("reported_at", -1)
        .limit(200)
    )

    # Collect chat conversations scoped to this user
    conversations = list(
        db["conversations"]
        .find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )

    bundle = {
        "export_info": {
            "exported_at": now,
            "exported_by": user.get("name", ""),
            "user_id": user_id,
            "format_version": "1.0",
            "disclaimer": (
                "This case file is exported from RentShield for informational "
                "purposes. It contains general legal information, not professional "
                "legal advice. Verify all details with a qualified solicitor."
            ),
        },
        "summary": {
            "total_evidence": len(evidence),
            "total_timeline_events": len(timeline),
            "total_letters": len(letters),
            "total_analyses": len(analyses),
            "total_deposit_checks": len(deposit_checks),
            "total_maintenance_requests": len(maintenance),
            "total_conversations": len(conversations),
        },
        "timeline": timeline,
        "evidence": evidence,
        "letters": letters,
        "agreement_analyses": analyses,
        "deposit_checks": deposit_checks,
        "maintenance_requests": maintenance,
        "conversations": conversations,
    }

    logger.info("Case export generated for user %s (%d items total)",
                user_id,
                sum(bundle["summary"].values()))

    return bundle
