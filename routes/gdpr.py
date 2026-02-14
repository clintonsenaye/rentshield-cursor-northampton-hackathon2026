"""
GDPR Compliance routes.

Implements data subject rights under UK GDPR:
- Data export (Subject Access Request)
- Account deletion (Right to Erasure)
- Privacy policy endpoint
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role, verify_password

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gdpr", tags=["gdpr"])

# Collections that contain user data (mapped to their user ID field)
USER_DATA_COLLECTIONS = {
    "conversations": "user_id",
    "analytics": "user_id",
    "wellbeing_journal": "user_id",
    "rewards": "user_id",
    "evidence": "user_id",
    "timeline": "user_id",
    "letters": "user_id",
    "agreement_analyses": "user_id",
    "deposit_checks": "user_id",
    "tasks": "tenant_id",
    "perk_claims": "tenant_id",
    "maintenance": "tenant_id",
    "notifications": "recipient_id",
    "compliance": "user_id",
    "quiz_attempts": "user_id",
    "document_vault": "user_id",
    "messages": "sender_id",
    "emergencies": "user_id",
    "scenario_simulations": "user_id",
    "compliance_reminders": "user_id",
}


class DeleteAccountRequest(BaseModel):
    """Request to delete account — requires password confirmation."""
    password: str = Field(..., min_length=1, description="Current password for confirmation")


@router.get("/export")
def export_my_data(
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Data Subject Access Request (DSAR).

    Returns all personal data stored about the authenticated user
    across all collections, as a JSON document.
    """
    user, error = require_role(authorization, ["tenant", "landlord", "admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]
    data: Dict[str, Any] = {}

    # Get user profile
    user_doc = db["users"].find_one(
        {"user_id": user_id},
        {"_id": 0, "password_hash": 0, "auth_token": 0, "token_expires_at": 0,
         "reset_token": 0, "reset_token_expires": 0},
    )
    data["profile"] = user_doc

    # Collect data from each collection
    for collection_name, id_field in USER_DATA_COLLECTIONS.items():
        query_field = id_field
        query_value = user_id

        records = list(
            db[collection_name]
            .find({query_field: query_value}, {"_id": 0})
            .limit(1000)
        )
        if records:
            data[collection_name] = records

    data["export_metadata"] = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "user_id": user_id,
        "format": "JSON",
        "note": "This contains all personal data stored by RentShield.",
    }

    logger.info("GDPR data export for user %s", user_id)
    return data


@router.delete("/account")
def delete_my_account(
    body: DeleteAccountRequest,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """
    Right to Erasure — delete account and all associated data.

    Requires password confirmation. This action is irreversible.
    Deletes user record and all data across all collections.
    """
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    user_id = user["user_id"]

    # Verify password before deletion
    user_doc = db["users"].find_one({"user_id": user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    if not verify_password(body.password, user_doc.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Incorrect password. Account deletion cancelled.")

    # Delete uploaded evidence files from disk before removing DB records
    _delete_user_files(db, user_id)

    # Delete data from all collections
    deleted_counts = {}
    for collection_name, id_field in USER_DATA_COLLECTIONS.items():
        result = db[collection_name].delete_many({id_field: user_id})
        if result.deleted_count > 0:
            deleted_counts[collection_name] = result.deleted_count

    # Messages: also delete received messages (sender_id handled above)
    result = db["messages"].delete_many({"recipient_id": user_id})
    if result.deleted_count > 0:
        deleted_counts["messages_received"] = result.deleted_count

    # If landlord, also handle cascade (their tenants become unlinked)
    if user.get("role") == "landlord":
        db["users"].update_many(
            {"landlord_id": user_id},
            {"$set": {"landlord_id": ""}},
        )

    # Delete the user record itself
    db["users"].delete_one({"user_id": user_id})

    logger.info(
        "GDPR account deletion for user %s — deleted from %d collections",
        user_id, len(deleted_counts),
    )

    return {
        "status": "deleted",
        "message": "Your account and all associated data have been permanently deleted.",
    }


def _delete_user_files(db, user_id: str) -> None:
    """Delete all uploaded files (evidence + maintenance) from disk for a user."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Evidence files
    evidence_docs = db["evidence"].find({"user_id": user_id}, {"file_url": 1, "_id": 0})
    for doc in evidence_docs:
        _safe_remove(base_dir, doc.get("file_url", ""), "static/uploads/evidence")

    # Maintenance photos
    maint_docs = db["maintenance"].find({"tenant_id": user_id}, {"photo_url": 1, "_id": 0})
    for doc in maint_docs:
        _safe_remove(base_dir, doc.get("photo_url", ""), "static/uploads/maintenance")


def _safe_remove(base_dir: str, file_url: str, allowed_subdir: str) -> None:
    """Remove a file only if its resolved path is within the allowed upload directory."""
    if not file_url:
        return
    allowed_dir = os.path.realpath(os.path.join(base_dir, allowed_subdir))
    resolved = os.path.realpath(os.path.join(base_dir, file_url.lstrip("/")))
    if resolved.startswith(allowed_dir) and os.path.exists(resolved):
        os.remove(resolved)
        logger.info("Deleted file: %s", resolved)


@router.get("/privacy-policy")
def privacy_policy() -> Dict[str, Any]:
    """
    Return the privacy policy as structured data.

    No authentication required — publicly accessible.
    """
    return {
        "title": "RentShield Privacy Policy",
        "last_updated": "2026-02-13",
        "data_controller": "RentShield",
        "sections": [
            {
                "heading": "What data we collect",
                "content": (
                    "We collect: your name, email address, and role (tenant/landlord/admin). "
                    "We also store your chat conversations, evidence uploads, maintenance requests, "
                    "wellbeing journal entries, and other data you voluntarily provide through the platform."
                ),
            },
            {
                "heading": "How we use your data",
                "content": (
                    "Your data is used to: (1) provide AI-powered legal guidance, "
                    "(2) track your housing issues and evidence, (3) manage landlord-tenant relationships, "
                    "(4) generate analytics to improve the service. We do not sell your data to third parties."
                ),
            },
            {
                "heading": "AI and third-party services",
                "content": (
                    "Chat messages are processed by MiniMax AI to generate legal guidance. "
                    "Your messages are sent to their API but are not used for model training. "
                    "No personally identifiable information is included in AI requests beyond the "
                    "content of your message."
                ),
            },
            {
                "heading": "Data storage",
                "content": (
                    "Data is stored in MongoDB Atlas (cloud-hosted database). "
                    "Passwords are hashed with bcrypt and never stored in plain text. "
                    "Auth tokens expire after 24 hours."
                ),
            },
            {
                "heading": "Your rights",
                "content": (
                    "Under UK GDPR, you have the right to: "
                    "(1) Access your data (GET /api/gdpr/export), "
                    "(2) Delete your account and all data (DELETE /api/gdpr/account), "
                    "(3) Rectify inaccurate data (contact support), "
                    "(4) Object to processing. "
                    "To exercise these rights, use the app settings or contact us."
                ),
            },
            {
                "heading": "Data retention",
                "content": (
                    "Account data is retained while your account is active. "
                    "Chat conversations are retained for 12 months. "
                    "When you delete your account, all data is permanently erased across all collections."
                ),
            },
            {
                "heading": "Cookies and local storage",
                "content": (
                    "RentShield uses browser localStorage to store: your auth token, "
                    "theme preference (dark/light mode), language preference, and session ID. "
                    "No third-party tracking cookies are used."
                ),
            },
        ],
    }
