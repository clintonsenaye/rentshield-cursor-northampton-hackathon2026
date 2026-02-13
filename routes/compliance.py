"""
Landlord compliance dashboard routes.

Tracks landlord obligations under UK housing law:
gas safety, EPC, EICR, deposit protection, etc.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException, Query

from database.connection import get_compliance_collection, get_database
from models.schemas import ComplianceUpdateRequest
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/compliance", tags=["compliance"])

# Load compliance requirements from seed data
_REQUIREMENTS_PATH = Path(__file__).parent.parent / "data" / "compliance_requirements.json"


def _load_requirements() -> List[Dict[str, Any]]:
    """Load compliance requirements from JSON file."""
    try:
        with open(_REQUIREMENTS_PATH, "r") as f:
            data = json.load(f)
        # Support both old array format and new object format with _meta
        if isinstance(data, list):
            return data
        elif isinstance(data, dict):
            return data.get("requirements", [])
        return []
    except Exception as exc:
        logger.error("Failed to load compliance requirements: %s", exc)
        return []


@router.get("")
def get_compliance(
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Get compliance items for the current landlord.

    Returns all compliance requirements with the landlord's status for each.
    Requires landlord or admin role.
    """
    user, error = require_role(authorization, ["landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    compliance_col = get_compliance_collection()
    if compliance_col is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    requirements = _load_requirements()

    try:
        # Get landlord's saved compliance statuses
        saved = compliance_col.find_one({"user_id": user["user_id"]})
        statuses = saved.get("items", {}) if saved else {}

        # Merge requirements with saved statuses
        items = []
        compliant_count = 0
        for req in requirements:
            rid = req["requirement_id"]
            status_data = statuses.get(rid, {})
            item = {
                "requirement_id": rid,
                "title": req["title"],
                "description": req["description"],
                "legal_reference": req["legal_reference"],
                "category": req["category"],
                "renewal_months": req.get("renewal_months"),
                "penalty": req["penalty"],
                "status": status_data.get("status", "not_started"),
                "completed_date": status_data.get("completed_date"),
                "expiry_date": status_data.get("expiry_date"),
                "notes": status_data.get("notes", ""),
                "updated_at": status_data.get("updated_at"),
            }
            if item["status"] == "compliant":
                compliant_count += 1
            items.append(item)

        total = len(requirements)
        score = round((compliant_count / total) * 100) if total > 0 else 0

        return {
            "items": items,
            "score": score,
            "compliant_count": compliant_count,
            "total_count": total,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get compliance data: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load compliance data.")


@router.put("/{requirement_id}")
def update_compliance(
    requirement_id: str,
    request: ComplianceUpdateRequest,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """
    Update compliance status for a specific requirement.

    Requires landlord or admin role.
    """
    user, error = require_role(authorization, ["landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    compliance_col = get_compliance_collection()
    if compliance_col is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    # Validate requirement_id exists
    requirements = _load_requirements()
    valid_ids = [r["requirement_id"] for r in requirements]
    if requirement_id not in valid_ids:
        raise HTTPException(status_code=404, detail="Requirement not found.")

    try:
        update_data = {
            "status": request.status,
            "notes": request.notes or "",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if request.completed_date:
            update_data["completed_date"] = request.completed_date
        if request.expiry_date:
            update_data["expiry_date"] = request.expiry_date

        compliance_col.update_one(
            {"user_id": user["user_id"]},
            {
                "$set": {
                    "user_id": user["user_id"],
                    "items." + requirement_id: update_data,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )

        logger.info("AUDIT: Compliance updated — user=%s, item=%s, status=%s",
                     user["user_id"], requirement_id, request.status)

        return {"message": "Compliance status updated."}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update compliance: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to update compliance status.")
