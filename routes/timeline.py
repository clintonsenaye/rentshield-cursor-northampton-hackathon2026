"""
Dispute Timeline routes.

Provides a chronological case tracker for tenants to log every interaction
with their landlord — messages, repair requests, notices, phone calls, etc.
Each event is timestamped and can reference evidence from the Evidence Locker.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/timeline", tags=["timeline"])

# Valid event types for the dispute timeline
EVENT_TYPES = [
    "message_sent",
    "message_received",
    "phone_call",
    "repair_requested",
    "repair_completed",
    "notice_received",
    "notice_sent",
    "complaint_filed",
    "inspection",
    "payment_made",
    "meeting",
    "other",
]


class TimelineEventRequest(BaseModel):
    """Request model for creating a timeline event."""
    title: str = Field(..., min_length=1, max_length=200, description="Short event title")
    description: str = Field(default="", max_length=5000, description="Detailed description")
    event_type: str = Field(default="other", description="Type of event")
    event_date: Optional[str] = Field(
        None,
        description="Date of event (ISO format). Defaults to now if not provided."
    )
    evidence_ids: List[str] = Field(
        default_factory=list,
        description="IDs of evidence items linked to this event"
    )


class TimelineEventUpdateRequest(BaseModel):
    """Request model for updating a timeline event."""
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    event_type: Optional[str] = None
    event_date: Optional[str] = None
    evidence_ids: Optional[List[str]] = None


@router.post("")
def create_timeline_event(
    body: TimelineEventRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Add a new event to the dispute timeline.

    Events are logged with a timestamp and can be linked to evidence items.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    if body.event_type not in EVENT_TYPES:
        body.event_type = "other"

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    event_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Use provided event_date or default to now
    event_date = body.event_date or now

    event_doc = {
        "event_id": event_id,
        "user_id": user["user_id"],
        "title": body.title.strip(),
        "description": body.description.strip(),
        "event_type": body.event_type,
        "event_date": event_date,
        "evidence_ids": body.evidence_ids[:10],  # Limit to 10 linked evidence items
        "created_at": now,
        "updated_at": now,
    }

    db["timeline"].insert_one(event_doc)
    logger.info("Timeline event created: %s by user %s", event_id, user["user_id"])

    event_doc.pop("_id", None)
    return event_doc


@router.get("")
def list_timeline_events(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """
    List all timeline events for the current tenant, sorted by event date (newest first).
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    events = list(
        db["timeline"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("event_date", -1)
        .limit(200)
    )

    return events


@router.put("/{event_id}")
def update_timeline_event(
    event_id: str,
    body: TimelineEventUpdateRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """Update an existing timeline event."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Build update fields (only include non-None values)
    update_fields = {"updated_at": datetime.now(timezone.utc).isoformat()}

    if body.title is not None:
        update_fields["title"] = body.title.strip()
    if body.description is not None:
        update_fields["description"] = body.description.strip()
    if body.event_type is not None and body.event_type in EVENT_TYPES:
        update_fields["event_type"] = body.event_type
    if body.event_date is not None:
        update_fields["event_date"] = body.event_date
    if body.evidence_ids is not None:
        update_fields["evidence_ids"] = body.evidence_ids[:10]

    result = db["timeline"].find_one_and_update(
        {"event_id": event_id, "user_id": user["user_id"]},
        {"$set": update_fields},
        return_document=True,
    )

    if not result:
        raise HTTPException(status_code=404, detail="Event not found.")

    result.pop("_id", None)
    return result


@router.delete("/{event_id}")
def delete_timeline_event(
    event_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Delete a timeline event."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["timeline"].delete_one({
        "event_id": event_id,
        "user_id": user["user_id"],
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found.")

    return {"message": "Event deleted."}
