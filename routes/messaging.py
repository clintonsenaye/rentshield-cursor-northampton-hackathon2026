"""
Landlord-Tenant Secure Messaging — in-app messaging with audit trail.

Provides a threaded messaging system between tenants and landlords with
read receipts and full audit trail for dispute documentation.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["messaging"])


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SendMessageRequest(BaseModel):
    """Send a message to another user."""
    recipient_id: str = Field(..., min_length=1, max_length=100, description="Recipient user ID")
    subject: str = Field(..., min_length=1, max_length=200, description="Message subject")
    body: str = Field(..., min_length=1, max_length=10000, description="Message body")
    thread_id: Optional[str] = Field(None, description="Thread ID for replies")


class MessageResponse(BaseModel):
    """A single message."""
    message_id: str
    thread_id: str
    sender_id: str
    sender_name: str
    sender_role: str
    recipient_id: str
    recipient_name: str
    subject: str
    body: str
    read: bool
    created_at: str


class ThreadSummary(BaseModel):
    """Summary of a message thread."""
    thread_id: str
    subject: str
    other_party_name: str
    other_party_role: str
    last_message_at: str
    message_count: int
    unread_count: int


class ThreadListResponse(BaseModel):
    """List of message threads."""
    threads: List[ThreadSummary]
    total: int


class ThreadDetailResponse(BaseModel):
    """Full message thread with all messages."""
    thread_id: str
    subject: str
    messages: List[MessageResponse]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_user_name(db, user_id: str) -> str:
    """Look up a user's display name."""
    user = db["users"].find_one({"user_id": user_id}, {"_id": 0, "name": 1})
    return user["name"] if user else "Unknown"


def _get_user_role(db, user_id: str) -> str:
    """Look up a user's role."""
    user = db["users"].find_one({"user_id": user_id}, {"_id": 0, "role": 1})
    return user["role"] if user else "unknown"


def _create_notification(db, recipient_id: str, sender_name: str) -> None:
    """Create a notification for a new message."""
    db["notifications"].insert_one({
        "notification_id": str(uuid.uuid4()),
        "recipient_id": recipient_id,
        "message": f"New message from {sender_name}",
        "type": "message",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=MessageResponse)
def send_message(
    request: SendMessageRequest,
    authorization: str = Header(""),
) -> MessageResponse:
    """Send a message to a tenant or landlord."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    sender_id = user["user_id"]
    sender_name = user.get("name", "Unknown")
    sender_role = user["role"]

    # Verify recipient exists and is a tenant/landlord
    recipient = db["users"].find_one(
        {"user_id": request.recipient_id, "role": {"$in": ["tenant", "landlord"]}},
        {"_id": 0, "name": 1, "role": 1},
    )
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient not found")

    # Tenants can only message their landlord; landlords can only message their tenants
    if sender_role == "tenant":
        landlord_id = user.get("landlord_id")
        if request.recipient_id != landlord_id:
            raise HTTPException(status_code=403, detail="You can only message your landlord")
    elif sender_role == "landlord":
        tenant_check = db["users"].find_one(
            {"user_id": request.recipient_id, "landlord_id": sender_id},
            {"_id": 0, "user_id": 1},
        )
        if not tenant_check:
            raise HTTPException(status_code=403, detail="You can only message your tenants")

    now = datetime.now(timezone.utc).isoformat()
    message_id = str(uuid.uuid4())

    # Use existing thread or create new one
    thread_id = request.thread_id or str(uuid.uuid4())

    # If replying to a thread, verify it belongs to the user
    if request.thread_id:
        existing = db["messages"].find_one({
            "thread_id": request.thread_id,
            "$or": [
                {"sender_id": sender_id},
                {"recipient_id": sender_id},
            ],
        })
        if not existing:
            raise HTTPException(status_code=404, detail="Thread not found")

    msg_doc = {
        "message_id": message_id,
        "thread_id": thread_id,
        "sender_id": sender_id,
        "sender_name": sender_name,
        "sender_role": sender_role,
        "recipient_id": request.recipient_id,
        "recipient_name": recipient["name"],
        "subject": request.subject.strip(),
        "body": request.body.strip(),
        "read": False,
        "created_at": now,
    }

    db["messages"].insert_one(msg_doc)
    _create_notification(db, request.recipient_id, sender_name)

    return MessageResponse(**{k: v for k, v in msg_doc.items() if k != "_id"})


@router.get("/threads", response_model=ThreadListResponse)
def list_threads(
    authorization: str = Header(""),
) -> ThreadListResponse:
    """List all message threads for the current user."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]

    # Get all messages involving this user
    messages = list(
        db["messages"]
        .find(
            {"$or": [{"sender_id": user_id}, {"recipient_id": user_id}]},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(500)
    )

    # Group by thread
    threads_map: Dict[str, Dict[str, Any]] = {}
    for msg in messages:
        tid = msg["thread_id"]
        if tid not in threads_map:
            # Determine the "other party"
            if msg["sender_id"] == user_id:
                other_id = msg["recipient_id"]
                other_name = msg["recipient_name"]
                other_role = _get_user_role(db, other_id)
            else:
                other_id = msg["sender_id"]
                other_name = msg["sender_name"]
                other_role = msg.get("sender_role", "unknown")

            threads_map[tid] = {
                "thread_id": tid,
                "subject": msg["subject"],
                "other_party_name": other_name,
                "other_party_role": other_role,
                "last_message_at": msg["created_at"],
                "message_count": 0,
                "unread_count": 0,
            }

        threads_map[tid]["message_count"] += 1
        if not msg["read"] and msg["recipient_id"] == user_id:
            threads_map[tid]["unread_count"] += 1

    thread_list = sorted(
        threads_map.values(),
        key=lambda t: t["last_message_at"],
        reverse=True,
    )

    return ThreadListResponse(
        threads=[ThreadSummary(**t) for t in thread_list],
        total=len(thread_list),
    )


@router.get("/threads/{thread_id}", response_model=ThreadDetailResponse)
def get_thread(
    thread_id: str,
    authorization: str = Header(""),
) -> ThreadDetailResponse:
    """Get all messages in a thread and mark them as read."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]

    messages = list(
        db["messages"]
        .find(
            {
                "thread_id": thread_id,
                "$or": [{"sender_id": user_id}, {"recipient_id": user_id}],
            },
            {"_id": 0},
        )
        .sort("created_at", 1)
        .limit(200)
    )

    if not messages:
        raise HTTPException(status_code=404, detail="Thread not found")

    # Mark unread messages as read
    db["messages"].update_many(
        {"thread_id": thread_id, "recipient_id": user_id, "read": False},
        {"$set": {"read": True}},
    )

    return ThreadDetailResponse(
        thread_id=thread_id,
        subject=messages[0]["subject"],
        messages=[MessageResponse(**m) for m in messages],
    )


@router.get("/unread-count")
def get_unread_count(
    authorization: str = Header(""),
) -> Dict[str, int]:
    """Get the count of unread messages."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    count = db["messages"].count_documents({
        "recipient_id": user["user_id"],
        "read": False,
    })

    return {"unread_count": count}
