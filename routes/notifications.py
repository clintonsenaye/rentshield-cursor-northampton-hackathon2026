"""
In-app Notification System routes.

Manages notifications for cross-role events:
- Task approved/rejected
- Maintenance responded/escalated
- Deadline approaching (within 48 hours)
- Perk claim fulfilled
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationCreateRequest(BaseModel):
    """Internal model for creating notifications (used by other routes)."""
    recipient_id: str
    title: str = Field(..., max_length=200)
    message: str = Field(..., max_length=1000)
    notification_type: str = Field(..., max_length=50)
    link_to: str = Field(default="", max_length=200)


def create_notification(
    recipient_id: str,
    title: str,
    message: str,
    notification_type: str,
    link_to: str = "",
) -> None:
    """
    Create a notification for a user. Called internally by other routes.

    Args:
        recipient_id: user_id of the notification recipient
        title: Short notification title
        message: Notification body text
        notification_type: Category (task_update, maintenance_update, deadline_warning, perk_update)
        link_to: Frontend page/section to navigate to when clicked
    """
    db = get_database()
    if db is None:
        logger.warning("Cannot create notification — database unavailable")
        return

    doc = {
        "notification_id": str(uuid.uuid4()),
        "recipient_id": recipient_id,
        "title": title,
        "message": message,
        "notification_type": notification_type,
        "link_to": link_to,
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        db["notifications"].insert_one(doc)
    except Exception as exc:
        logger.error("Failed to create notification: %s", exc)


@router.get("")
def get_notifications(
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Get all notifications for the authenticated user.

    Returns unread count and the 50 most recent notifications.
    """
    user, error = require_role(authorization, ["tenant", "landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]

    notifications = list(
        db["notifications"]
        .find({"recipient_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )

    unread_count = sum(1 for n in notifications if not n.get("is_read"))

    return {
        "notifications": notifications,
        "unread_count": unread_count,
    }


@router.post("/{notification_id}/read")
def mark_as_read(
    notification_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Mark a single notification as read."""
    user, error = require_role(authorization, ["tenant", "landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["notifications"].update_one(
        {"notification_id": notification_id, "recipient_id": user["user_id"]},
        {"$set": {"is_read": True}},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")

    return {"status": "ok"}


@router.post("/read-all")
def mark_all_as_read(
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Mark all notifications as read for the authenticated user."""
    user, error = require_role(authorization, ["tenant", "landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    db["notifications"].update_many(
        {"recipient_id": user["user_id"], "is_read": False},
        {"$set": {"is_read": True}},
    )

    return {"status": "ok"}
