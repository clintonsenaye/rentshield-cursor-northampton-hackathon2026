"""
Task management routes.

Flow:
1. Landlord creates a task and assigns it to a tenant
2. Tenant sees the task in their dashboard
3. Tenant completes the task, takes a photo, and uploads it
4. Landlord reviews the submission and approves/rejects
5. On approval, tenant earns the points reward
"""

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile

from database.connection import get_database
from models.users import CreateTaskRequest, TaskResponse, VerifyTaskRequest
from routes.notifications import create_notification
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# Directory for uploaded proof images (use absolute path)
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# File upload constraints
MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif"}

# Magic bytes for image file validation
IMAGE_MAGIC_BYTES = {
    b"\xff\xd8\xff": "jpeg",       # JPEG
    b"\x89PNG": "png",             # PNG
    b"RIFF": "webp",               # WebP (starts with RIFF)
    b"GIF87a": "gif",              # GIF87a
    b"GIF89a": "gif",              # GIF89a
}


def _sanitize_filename(filename: str) -> str:
    """Sanitize a filename to prevent path traversal and injection."""
    if not filename:
        return "upload"
    # Remove path separators and null bytes
    name = os.path.basename(filename)
    name = name.replace("\x00", "")
    # Keep only alphanumeric, hyphens, underscores, and dots
    name = re.sub(r"[^\w.\-]", "_", name)
    return name or "upload"


def _validate_image_content(content: bytes) -> bool:
    """Validate image content by checking magic bytes."""
    for magic, _ in IMAGE_MAGIC_BYTES.items():
        if content[:len(magic)] == magic:
            return True
    return False


# === LANDLORD: CREATE & MANAGE TASKS ===

@router.post("", response_model=TaskResponse)
def create_task(
    request: CreateTaskRequest,
    authorization: str = Header(""),
) -> TaskResponse:
    """Landlord creates a task and assigns it to a tenant."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Verify the tenant exists and belongs to this landlord
    users_col = db["users"]
    tenant = users_col.find_one({
        "user_id": request.tenant_id,
        "role": "tenant",
        "landlord_id": user["user_id"],
    })
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found or not yours.")

    now = datetime.now(timezone.utc).isoformat()
    task_id = str(uuid.uuid4())

    task_doc = {
        "task_id": task_id,
        "title": request.title.strip(),
        "description": request.description.strip(),
        "tenant_id": request.tenant_id,
        "tenant_name": tenant.get("name", ""),
        "landlord_id": user["user_id"],
        "points_reward": request.points_reward,
        "category": request.category,
        "status": "pending",  # pending -> submitted -> approved/rejected
        "proof_image": "",
        "rejection_reason": "",
        "created_at": now,
        "submitted_at": "",
        "verified_at": "",
    }

    db["tasks"].insert_one(task_doc)
    logger.info(f"Landlord {user['user_id']} created task '{request.title}' for tenant {request.tenant_id}")

    return TaskResponse(**{k: v for k, v in task_doc.items() if k != "_id"})


@router.get("", response_model=List[TaskResponse])
def list_tasks(
    authorization: str = Header(""),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
) -> List[TaskResponse]:
    """
    List tasks based on role:
    - Landlord: sees all tasks they created
    - Tenant: sees all tasks assigned to them
    """
    user, error = require_role(authorization, ["landlord", "tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    tasks_col = db["tasks"]

    if user["role"] == "landlord":
        query = {"landlord_id": user["user_id"]}
    else:
        query = {"tenant_id": user["user_id"]}

    skip = (page - 1) * page_size
    tasks = tasks_col.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(page_size)

    return [TaskResponse(**t) for t in tasks]


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, authorization: str = Header("")) -> TaskResponse:
    """Get a single task by ID."""
    user, error = require_role(authorization, ["landlord", "tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    task = db["tasks"].find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    # Verify access: landlord owns it or tenant is assigned
    if user["role"] == "landlord" and task["landlord_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your task.")
    if user["role"] == "tenant" and task["tenant_id"] != user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your task.")

    return TaskResponse(**task)


# === TENANT: SUBMIT PROOF ===

@router.post("/{task_id}/submit")
async def submit_task_proof(
    task_id: str,
    photo: UploadFile = File(...),
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Tenant uploads a proof photo for a task.

    The photo is saved to static/uploads/ and the task status changes to 'submitted'.
    Validates file size (max 5MB), content type, file extension, and magic bytes.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    tasks_col = db["tasks"]
    task = tasks_col.find_one({"task_id": task_id, "tenant_id": user["user_id"]})

    if not task:
        raise HTTPException(status_code=404, detail="Task not found or not assigned to you.")

    if task["status"] not in ("pending", "rejected"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot submit proof for a task with status '{task['status']}'.",
        )

    # Validate content type
    if photo.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Please upload an image (JPEG, PNG, WebP, or GIF).")

    # Read and validate file size
    contents = await photo.read()
    if len(contents) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB.",
        )

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Validate magic bytes (actual file content)
    if not _validate_image_content(contents):
        raise HTTPException(
            status_code=400,
            detail="File content does not match a valid image format. Please upload a real image file.",
        )

    # Sanitize and validate file extension
    original_filename = _sanitize_filename(photo.filename or "upload.jpg")
    file_ext = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else "jpg"
    if file_ext not in ALLOWED_EXTENSIONS:
        file_ext = "jpg"

    # Generate safe filename
    saved_filename = f"{task_id}_{uuid.uuid4().hex[:8]}.{file_ext}"
    saved_path = os.path.join(UPLOAD_DIR, saved_filename)

    # Save file
    try:
        with open(saved_path, "wb") as f:
            f.write(contents)
    except OSError as exc:
        logger.error(f"Failed to save upload file: {exc}")
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    # Update task status to submitted
    now = datetime.now(timezone.utc).isoformat()
    image_url = f"/static/uploads/{saved_filename}"

    tasks_col.update_one(
        {"task_id": task_id},
        {
            "$set": {
                "status": "submitted",
                "proof_image": image_url,
                "submitted_at": now,
                "rejection_reason": "",  # Clear any previous rejection
            }
        },
    )

    logger.info(f"Tenant {user['user_id']} submitted proof for task {task_id}")

    return {
        "message": "Proof submitted successfully! Waiting for landlord verification.",
        "task_id": task_id,
        "proof_image": image_url,
        "status": "submitted",
    }


# === LANDLORD: VERIFY TASK ===

@router.post("/{task_id}/verify", response_model=TaskResponse)
def verify_task(
    task_id: str,
    request: VerifyTaskRequest,
    authorization: str = Header(""),
) -> TaskResponse:
    """
    Landlord approves or rejects a task submission.

    On approval: tenant earns the task's points_reward (atomic operation).
    On rejection: task goes back to 'rejected' status so tenant can resubmit.
    """
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    tasks_col = db["tasks"]
    task = tasks_col.find_one({"task_id": task_id, "landlord_id": user["user_id"]})

    if not task:
        raise HTTPException(status_code=404, detail="Task not found or not yours.")

    if task["status"] != "submitted":
        raise HTTPException(
            status_code=400,
            detail=f"Can only verify tasks with status 'submitted'. Current: '{task['status']}'.",
        )

    now = datetime.now(timezone.utc).isoformat()

    if request.approved:
        # Approve: atomically update task status AND award points to prevent race conditions
        new_status = "approved"

        # Use atomic findOneAndUpdate to prevent double-awarding
        result = tasks_col.find_one_and_update(
            {"task_id": task_id, "status": "submitted"},
            {"$set": {"status": new_status, "verified_at": now}},
        )

        if result is None:
            raise HTTPException(status_code=409, detail="Task already verified (concurrent request).")

        # Award points
        users_col = db["users"]
        users_col.update_one(
            {"user_id": task["tenant_id"]},
            {"$inc": {"points": task["points_reward"]}},
        )

        logger.info(
            f"Landlord approved task {task_id}, "
            f"tenant {task['tenant_id']} earned {task['points_reward']} points"
        )
    else:
        # Reject: send back with reason
        new_status = "rejected"

        if not request.reason.strip():
            raise HTTPException(status_code=400, detail="A reason is required when rejecting a task.")

        tasks_col.update_one(
            {"task_id": task_id},
            {
                "$set": {
                    "status": new_status,
                    "rejection_reason": request.reason.strip(),
                    "verified_at": now,
                }
            },
        )

        logger.info(f"Landlord rejected task {task_id}: {request.reason}")

    # Notify tenant
    tenant_id = task.get("tenant_id", "")
    task_title = task.get("title", "Task")
    if tenant_id:
        if request.approved:
            create_notification(
                recipient_id=tenant_id,
                title="Task Approved",
                message=f'"{task_title}" approved! You earned {task["points_reward"]} points.',
                notification_type="task_update",
                link_to="tasks",
            )
        else:
            create_notification(
                recipient_id=tenant_id,
                title="Task Returned",
                message=f'"{task_title}" needs resubmission: {request.reason.strip()[:100]}',
                notification_type="task_update",
                link_to="tasks",
            )

    # Fetch updated task
    updated_task = tasks_col.find_one({"task_id": task_id}, {"_id": 0})
    return TaskResponse(**updated_task)
