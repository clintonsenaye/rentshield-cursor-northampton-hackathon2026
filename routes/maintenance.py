"""
Maintenance Request System routes.

Structured workflow for reporting and tracking property maintenance issues:
1. Tenant reports issue with description, category, and optional photo
2. Landlord receives the request and can respond
3. System tracks Awaab's Law timeframes and flags non-compliance
4. Tenant can track progress and escalate if necessary

Awaab's Law timeframes (Renters' Rights Act 2025):
- Emergency hazards: 24 hours to make safe
- Significant hazards (e.g. damp/mould): 14 calendar days to begin repairs
- All reported hazards: written response within 14 days
"""

import logging
import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])

# Upload directory for maintenance photos
UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "static", "uploads", "maintenance"
)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# File constraints
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

# Maintenance categories with Awaab's Law urgency levels
MAINTENANCE_CATEGORIES = {
    "emergency": {
        "name": "Emergency",
        "description": "Gas leak, flooding, no heating in winter, structural danger",
        "deadline_hours": 24,
        "urgency": "critical",
    },
    "damp_mould": {
        "name": "Damp & Mould",
        "description": "Mould growth, rising damp, condensation damage",
        "deadline_days": 14,
        "urgency": "high",
    },
    "plumbing": {
        "name": "Plumbing",
        "description": "Leaking pipes, broken toilet, drainage issues",
        "deadline_days": 14,
        "urgency": "high",
    },
    "electrical": {
        "name": "Electrical",
        "description": "Faulty wiring, broken sockets, tripping breaker",
        "deadline_days": 14,
        "urgency": "high",
    },
    "heating": {
        "name": "Heating & Hot Water",
        "description": "Broken boiler, radiator issues, no hot water",
        "deadline_days": 14,
        "urgency": "high",
    },
    "structural": {
        "name": "Structural",
        "description": "Cracks, broken windows, damaged roof, doors",
        "deadline_days": 28,
        "urgency": "medium",
    },
    "pest_control": {
        "name": "Pest Control",
        "description": "Mice, rats, insects, birds",
        "deadline_days": 28,
        "urgency": "medium",
    },
    "appliance": {
        "name": "Appliance",
        "description": "Broken oven, fridge, washing machine (if landlord-provided)",
        "deadline_days": 28,
        "urgency": "low",
    },
    "other": {
        "name": "Other",
        "description": "General wear and tear, cosmetic issues",
        "deadline_days": 28,
        "urgency": "low",
    },
}

# Valid statuses for maintenance requests
MAINTENANCE_STATUSES = [
    "reported",         # Tenant submitted the request
    "acknowledged",     # Landlord has seen it
    "in_progress",      # Repair work has begun
    "completed",        # Landlord marked as completed
    "confirmed",        # Tenant confirmed repair is satisfactory
    "escalated",        # Tenant escalated due to no response / inadequate repair
]


def _calculate_deadline(category: str, reported_at: str) -> str:
    """
    Calculate the repair deadline based on Awaab's Law timeframes.

    Args:
        category: Maintenance category key
        reported_at: ISO format timestamp of when the issue was reported

    Returns:
        ISO format timestamp of the deadline
    """
    cat_info = MAINTENANCE_CATEGORIES.get(category, MAINTENANCE_CATEGORIES["other"])
    reported = datetime.fromisoformat(reported_at)

    if "deadline_hours" in cat_info:
        deadline = reported + timedelta(hours=cat_info["deadline_hours"])
    else:
        deadline = reported + timedelta(days=cat_info.get("deadline_days", 28))

    return deadline.isoformat()


def _sanitize_filename(filename: str) -> str:
    """Remove unsafe characters from a filename."""
    name = os.path.splitext(filename)[0]
    ext = os.path.splitext(filename)[1].lower()
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:50]
    return safe_name + ext


# === TENANT: REPORT AND TRACK MAINTENANCE ISSUES ===

@router.post("")
async def report_issue(
    description: str = Form(...),
    category: str = Form("other"),
    location: str = Form(""),
    file: Optional[UploadFile] = File(None),
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Tenant reports a maintenance issue.

    Accepts an optional photo and stores the request with a calculated
    Awaab's Law deadline based on the category.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    if category not in MAINTENANCE_CATEGORIES:
        category = "other"

    if len(description.strip()) < 10:
        raise HTTPException(status_code=400, detail="Please provide a detailed description (at least 10 characters).")

    # Handle photo upload
    photo_url = ""
    if file and file.filename:
        if file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail="Only image files are allowed (JPG, PNG, WebP, GIF).")

        contents = await file.read()
        if len(contents) > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(status_code=400, detail="File too large. Maximum 10 MB.")

        safe_name = _sanitize_filename(file.filename)
        stored_name = f"{uuid.uuid4()}_{safe_name}"
        file_path = os.path.join(UPLOAD_DIR, stored_name)

        with open(file_path, "wb") as out:
            out.write(contents)

        photo_url = f"/static/uploads/maintenance/{stored_name}"

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Get landlord ID from the tenant's record
    landlord_id = user.get("landlord_id", "")

    request_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    deadline = _calculate_deadline(category, now)

    cat_info = MAINTENANCE_CATEGORIES[category]

    request_doc = {
        "request_id": request_id,
        "tenant_id": user["user_id"],
        "tenant_name": user.get("name", ""),
        "landlord_id": landlord_id,
        "description": description.strip()[:5000],
        "category": category,
        "category_name": cat_info["name"],
        "urgency": cat_info["urgency"],
        "location": location.strip()[:200],
        "photo_url": photo_url,
        "status": "reported",
        "deadline": deadline,
        "landlord_response": "",
        "reported_at": now,
        "acknowledged_at": "",
        "completed_at": "",
        "escalated_at": "",
    }

    db["maintenance"].insert_one(request_doc)
    logger.info("Maintenance request %s by tenant %s (category: %s)",
                request_id, user["user_id"], category)

    request_doc.pop("_id", None)
    return request_doc


@router.get("")
def list_my_requests(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """
    List maintenance requests.
    - Tenants see their own requests.
    - Landlords see requests from their tenants.
    """
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    if user["role"] == "tenant":
        query = {"tenant_id": user["user_id"]}
    else:
        query = {"landlord_id": user["user_id"]}

    requests = list(
        db["maintenance"]
        .find(query, {"_id": 0})
        .sort("reported_at", -1)
        .limit(100)
    )

    # Flag overdue requests
    now = datetime.now(timezone.utc)
    for req in requests:
        if req.get("deadline") and req["status"] in ("reported", "acknowledged"):
            try:
                deadline_dt = datetime.fromisoformat(req["deadline"])
                req["is_overdue"] = now > deadline_dt
            except (ValueError, TypeError):
                req["is_overdue"] = False
        else:
            req["is_overdue"] = False

    return requests


@router.get("/categories")
def list_categories() -> Dict[str, Any]:
    """Return all maintenance categories with urgency levels and deadlines."""
    return {"categories": MAINTENANCE_CATEGORIES}


@router.post("/{request_id}/escalate")
def escalate_request(
    request_id: str,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """Tenant escalates a request that hasn't been addressed in time."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    result = db["maintenance"].find_one_and_update(
        {
            "request_id": request_id,
            "tenant_id": user["user_id"],
            "status": {"$in": ["reported", "acknowledged"]},
        },
        {"$set": {"status": "escalated", "escalated_at": now}},
        return_document=True,
    )

    if not result:
        raise HTTPException(status_code=404, detail="Request not found or cannot be escalated.")

    result.pop("_id", None)
    return result


@router.post("/{request_id}/confirm")
def confirm_completion(
    request_id: str,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """Tenant confirms a completed repair is satisfactory."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["maintenance"].find_one_and_update(
        {
            "request_id": request_id,
            "tenant_id": user["user_id"],
            "status": "completed",
        },
        {"$set": {"status": "confirmed"}},
        return_document=True,
    )

    if not result:
        raise HTTPException(status_code=404, detail="Request not found or not yet completed.")

    result.pop("_id", None)
    return result


# === LANDLORD: RESPOND TO MAINTENANCE REQUESTS ===

class LandlordResponseRequest(BaseModel):
    """Request model for landlord responding to a maintenance issue."""
    response_text: str = Field(..., min_length=1, max_length=2000)
    new_status: str = Field(
        default="acknowledged",
        description="New status: acknowledged, in_progress, or completed"
    )


@router.put("/{request_id}/respond")
def respond_to_request(
    request_id: str,
    body: LandlordResponseRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """Landlord responds to a maintenance request and updates its status."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    valid_landlord_statuses = ["acknowledged", "in_progress", "completed"]
    if body.new_status not in valid_landlord_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Choose from: {', '.join(valid_landlord_statuses)}"
        )

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    update_fields = {
        "landlord_response": body.response_text.strip(),
        "status": body.new_status,
    }

    if body.new_status == "acknowledged":
        update_fields["acknowledged_at"] = now
    elif body.new_status == "completed":
        update_fields["completed_at"] = now

    result = db["maintenance"].find_one_and_update(
        {"request_id": request_id, "landlord_id": user["user_id"]},
        {"$set": update_fields},
        return_document=True,
    )

    if not result:
        raise HTTPException(status_code=404, detail="Request not found.")

    result.pop("_id", None)
    return result
