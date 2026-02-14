"""
Compliance Reminder System — automated reminders for certificate renewals.

Landlords can set up reminders for compliance certificates (gas safety, EICR,
EPC, etc.) that generate in-app notifications when renewal dates approach.
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reminders", tags=["reminders"])


# Reminder types with default lead times
REMINDER_TYPES = {
    "gas_safety": {"label": "Gas Safety Certificate", "default_lead_days": 30},
    "eicr": {"label": "Electrical Safety (EICR)", "default_lead_days": 30},
    "epc": {"label": "Energy Performance Certificate", "default_lead_days": 60},
    "fire_safety": {"label": "Fire Safety Assessment", "default_lead_days": 30},
    "legionella": {"label": "Legionella Risk Assessment", "default_lead_days": 30},
    "hmo_licence": {"label": "HMO Licence Renewal", "default_lead_days": 90},
    "selective_licence": {"label": "Selective Licence Renewal", "default_lead_days": 90},
    "insurance": {"label": "Landlord Insurance", "default_lead_days": 30},
    "custom": {"label": "Custom Reminder", "default_lead_days": 14},
}


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class CreateReminderRequest(BaseModel):
    """Create a new compliance reminder."""
    reminder_type: str = Field(..., min_length=1, max_length=50, description="Type of reminder")
    title: Optional[str] = Field(None, max_length=200, description="Custom title (overrides default)")
    property_address: Optional[str] = Field(None, max_length=300, description="Property address")
    expiry_date: str = Field(..., max_length=20, description="Certificate expiry date (YYYY-MM-DD)")
    lead_days: Optional[int] = Field(None, ge=1, le=365, description="Days before expiry to remind")
    notes: Optional[str] = Field(None, max_length=2000, description="Additional notes")


class ReminderResponse(BaseModel):
    """A single reminder."""
    reminder_id: str
    reminder_type: str
    type_label: str
    title: str
    property_address: Optional[str]
    expiry_date: str
    lead_days: int
    reminder_date: str
    days_until_expiry: int
    status: str  # active, triggered, expired, dismissed
    notes: Optional[str]
    created_at: str


class ReminderListResponse(BaseModel):
    """List of reminders."""
    reminders: List[ReminderResponse]
    total: int
    expiring_soon: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_date_str(date_str: str) -> datetime:
    """Parse a YYYY-MM-DD string to datetime."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")


def _check_and_trigger_reminders(db, landlord_id: str) -> None:
    """Check for reminders that should be triggered and create notifications."""
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    # Find active reminders where reminder_date has passed
    due_reminders = list(
        db["compliance_reminders"]
        .find({
            "user_id": landlord_id,
            "status": "active",
            "reminder_date": {"$lte": today_str},
        }, {"_id": 0})
        .limit(50)
    )

    for rem in due_reminders:
        # Create notification
        db["notifications"].insert_one({
            "notification_id": str(uuid.uuid4()),
            "recipient_id": landlord_id,
            "message": f"Reminder: {rem['title']} expires on {rem['expiry_date']}",
            "type": "compliance_reminder",
            "read": False,
            "created_at": now.isoformat(),
        })

        # Mark as triggered
        db["compliance_reminders"].update_one(
            {"reminder_id": rem["reminder_id"]},
            {"$set": {"status": "triggered"}},
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/types")
def list_reminder_types(authorization: str = Header("")) -> List[Dict[str, Any]]:
    """Return available reminder types."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return [
        {"key": k, "label": v["label"], "default_lead_days": v["default_lead_days"]}
        for k, v in REMINDER_TYPES.items()
    ]


@router.post("", response_model=ReminderResponse)
def create_reminder(
    request: CreateReminderRequest,
    authorization: str = Header(""),
) -> ReminderResponse:
    """Create a new compliance reminder."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    type_info = REMINDER_TYPES.get(request.reminder_type)
    if not type_info:
        raise HTTPException(status_code=400, detail=f"Unknown reminder type. Available: {', '.join(REMINDER_TYPES.keys())}")

    expiry_dt = _parse_date_str(request.expiry_date)
    now = datetime.now(timezone.utc)
    lead_days = request.lead_days or type_info["default_lead_days"]
    reminder_dt = expiry_dt - timedelta(days=lead_days)
    days_until = (expiry_dt - now).days

    title = request.title or type_info["label"]

    # Determine status
    if days_until < 0:
        status = "expired"
    elif (reminder_dt - now).days <= 0:
        status = "triggered"
    else:
        status = "active"

    reminder_doc = {
        "reminder_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "reminder_type": request.reminder_type,
        "type_label": type_info["label"],
        "title": title.strip(),
        "property_address": request.property_address.strip() if request.property_address else None,
        "expiry_date": request.expiry_date,
        "lead_days": lead_days,
        "reminder_date": reminder_dt.strftime("%Y-%m-%d"),
        "days_until_expiry": days_until,
        "status": status,
        "notes": request.notes.strip() if request.notes else None,
        "created_at": now.isoformat(),
    }

    db["compliance_reminders"].insert_one(reminder_doc)

    return ReminderResponse(**{k: v for k, v in reminder_doc.items() if k != "_id"})


@router.get("", response_model=ReminderListResponse)
def list_reminders(
    authorization: str = Header(""),
) -> ReminderListResponse:
    """List all reminders for the current landlord."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Check and trigger any due reminders
    _check_and_trigger_reminders(db, user["user_id"])

    reminders = list(
        db["compliance_reminders"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("expiry_date", 1)
        .limit(200)
    )

    # Recalculate days_until_expiry
    now = datetime.now(timezone.utc)
    for r in reminders:
        try:
            expiry = datetime.strptime(r["expiry_date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            r["days_until_expiry"] = (expiry - now).days
        except (ValueError, KeyError):
            r["days_until_expiry"] = 0

    expiring_soon = sum(1 for r in reminders if 0 < r.get("days_until_expiry", 999) <= 30)

    return ReminderListResponse(
        reminders=[ReminderResponse(**r) for r in reminders],
        total=len(reminders),
        expiring_soon=expiring_soon,
    )


@router.delete("/{reminder_id}")
def delete_reminder(
    reminder_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Delete a reminder."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["compliance_reminders"].delete_one({
        "reminder_id": reminder_id,
        "user_id": user["user_id"],
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reminder not found")

    return {"status": "deleted", "reminder_id": reminder_id}
