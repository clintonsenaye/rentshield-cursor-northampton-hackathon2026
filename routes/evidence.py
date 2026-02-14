"""
Evidence Locker routes.

Allows tenants to upload, categorize, and manage evidence files
(photos, screenshots, documents) related to their housing situation.
Each item is timestamped and categorized for use in disputes or tribunals.
"""

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/evidence", tags=["evidence"])

# Upload directory for evidence files
UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "static", "uploads", "evidence"
)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# File upload constraints
MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
}
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "pdf"}

# Valid evidence categories
EVIDENCE_CATEGORIES = [
    "mould_damp",
    "property_damage",
    "correspondence",
    "notice_letter",
    "repair_request",
    "photo_condition",
    "receipt_payment",
    "other",
]


def _sanitize_filename(filename: str) -> str:
    """Remove unsafe characters from a filename."""
    name = os.path.splitext(filename)[0]
    ext = os.path.splitext(filename)[1].lower()
    safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:50]
    return safe_name + ext


# Magic byte signatures for allowed file types
_MAGIC_BYTES = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/gif": [b"GIF87a", b"GIF89a"],
    "image/webp": [b"RIFF"],  # RIFF....WEBP
    "application/pdf": [b"%PDF"],
}


def _validate_magic_bytes(data: bytes, content_type: str) -> bool:
    """Verify file content matches its declared MIME type via magic bytes."""
    signatures = _MAGIC_BYTES.get(content_type)
    if signatures is None:
        return False
    return any(data[:len(sig)] == sig for sig in signatures)


@router.post("")
async def upload_evidence(
    file: UploadFile = File(...),
    title: str = Form(""),
    description: str = Form(""),
    category: str = Form("other"),
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Upload a new evidence file.

    Accepts images and PDFs up to 10 MB. Each file is stored with metadata
    including title, description, category, and upload timestamp.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    # Validate category
    if category not in EVIDENCE_CATEGORIES:
        category = "other"

    # Validate file type
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="File type not allowed. Upload images (JPG, PNG, WebP, GIF) or PDF."
        )

    file_ext = os.path.splitext(file.filename or "file")[1].lower().lstrip(".")
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="File extension not allowed.")

    # Validate file size
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10 MB.")

    # Validate file magic bytes match claimed content type
    if not _validate_magic_bytes(contents, file.content_type or ""):
        raise HTTPException(status_code=400, detail="File content does not match its declared type.")

    # Save file to disk
    evidence_id = str(uuid.uuid4())
    safe_filename = _sanitize_filename(file.filename or "evidence")
    stored_filename = f"{evidence_id}_{safe_filename}"
    file_path = os.path.join(UPLOAD_DIR, stored_filename)

    with open(file_path, "wb") as out_file:
        out_file.write(contents)

    file_url = f"/static/uploads/evidence/{stored_filename}"

    # Save metadata to database
    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    evidence_doc = {
        "evidence_id": evidence_id,
        "user_id": user["user_id"],
        "title": (title.strip() or file.filename or "Untitled")[:200],
        "description": description.strip()[:2000],
        "category": category,
        "file_url": file_url,
        "file_type": file.content_type,
        "file_size": len(contents),
        "original_filename": file.filename or "unknown",
        "created_at": now,
    }

    db["evidence"].insert_one(evidence_doc)
    logger.info("Evidence uploaded: %s by user %s", evidence_id, user["user_id"])

    evidence_doc.pop("_id", None)
    return evidence_doc


@router.get("")
def list_evidence(
    authorization: str = Header(""),
    category: str = "",
) -> List[Dict[str, Any]]:
    """
    List all evidence files for the current tenant.

    Optionally filter by category. Returns newest first.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    query = {"user_id": user["user_id"]}
    if category and category in EVIDENCE_CATEGORIES:
        query["category"] = category

    items = list(
        db["evidence"]
        .find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(100)
    )

    return items


@router.delete("/{evidence_id}")
def delete_evidence(
    evidence_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Delete an evidence file (only the owner can delete)."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Find and verify ownership
    evidence = db["evidence"].find_one({
        "evidence_id": evidence_id,
        "user_id": user["user_id"],
    })

    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found.")

    # Delete file from disk (with path traversal protection)
    file_url = evidence.get("file_url", "")
    if file_url:
        file_path = os.path.realpath(
            os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                file_url.lstrip("/"),
            )
        )
        # Ensure resolved path is within the upload directory
        if file_path.startswith(os.path.realpath(UPLOAD_DIR)) and os.path.exists(file_path):
            os.remove(file_path)
        elif not file_path.startswith(os.path.realpath(UPLOAD_DIR)):
            logger.warning("Path traversal attempt blocked: %s", file_url)

    # Delete from database
    db["evidence"].delete_one({"evidence_id": evidence_id})
    logger.info("Evidence deleted: %s by user %s", evidence_id, user["user_id"])

    return {"message": "Evidence deleted."}
