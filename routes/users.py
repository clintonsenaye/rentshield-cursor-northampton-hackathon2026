"""
User management routes.

- POST /api/auth/login         -- login for any role
- POST /api/auth/logout        -- logout (revoke token)
- POST /api/admin/landlords    -- admin creates a landlord
- GET  /api/admin/landlords    -- admin lists all landlords
- DELETE /api/admin/landlords/{id} -- admin deletes a landlord
- POST /api/landlord/tenants   -- landlord creates a tenant
- GET  /api/landlord/tenants   -- landlord lists their tenants
- DELETE /api/landlord/tenants/{id} -- landlord deletes a tenant
- GET  /api/users/me           -- get current user profile
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from database.connection import get_database
from models.users import (
    ChangePasswordRequest,
    CreateLandlordRequest,
    CreateTenantRequest,
    LoginRequest,
    LoginResponse,
    RequestPasswordResetRequest,
    ResetPasswordRequest,
    UserResponse,
)
from utils.auth import (
    authenticate_user,
    change_password,
    generate_password_reset_token,
    hash_password,
    require_role,
    reset_password_with_token,
    revoke_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["users"])

# Rate limiter for auth endpoints
limiter = Limiter(key_func=get_remote_address)


# === AUTH ===

@router.post("/api/auth/login", response_model=LoginResponse)
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest) -> LoginResponse:
    """Log in with email and password. Returns an auth token. Rate limited to 10/minute."""
    result = authenticate_user(body.email, body.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    return LoginResponse(
        token=result["token"],
        user_id=result["user_id"],
        role=result["role"],
        name=result["name"],
    )


@router.post("/api/auth/logout")
def logout(authorization: str = Header("")) -> Dict[str, str]:
    """Log out and revoke the current auth token."""
    token = authorization
    if token.startswith("Bearer "):
        token = token[7:]

    if revoke_token(token):
        return {"message": "Logged out successfully."}
    return {"message": "Token not found or already revoked."}


@router.post("/api/auth/change-password")
def change_user_password(
    body: ChangePasswordRequest,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """
    Change the current user's password.

    Requires the current password for verification.
    Invalidates the current auth token (forces re-login).
    """
    user, error = require_role(authorization, ["admin", "landlord", "tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    success, message = change_password(
        user_id=user["user_id"],
        current_password=body.current_password,
        new_password=body.new_password,
    )

    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {"message": message}


@router.post("/api/auth/request-reset")
def request_password_reset(
    body: RequestPasswordResetRequest,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """
    Generate a password reset token for a user.

    Admin can reset any user. Landlord can reset their tenants.
    Returns the token directly (in production, this would be emailed).
    """
    user, error = require_role(authorization, ["admin", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    # Landlords can only reset their own tenants
    if user.get("role") == "landlord":
        db = get_database()
        if db is None:
            raise HTTPException(status_code=503, detail="Database unavailable")
        target_user = db["users"].find_one({"email": body.email.lower().strip()})
        if not target_user or target_user.get("landlord_id") != user["user_id"]:
            raise HTTPException(status_code=403, detail="You can only reset passwords for your own tenants.")

    reset_token, message = generate_password_reset_token(body.email)

    if reset_token:
        logger.info(
            "AUDIT: %s %s generated reset token for %s",
            user.get("role"), user.get("user_id"), body.email
        )
        return {"message": message, "reset_token": reset_token}

    return {"message": message}


@router.post("/api/auth/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, body: ResetPasswordRequest) -> Dict[str, str]:
    """
    Reset a user's password using a one-time reset token.

    This endpoint is unauthenticated (the user forgot their password).
    Rate limited to 5 attempts per minute.
    """
    success, message = reset_password_with_token(
        email=body.email,
        reset_token=body.reset_token,
        new_password=body.new_password,
    )

    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {"message": message}


@router.get("/api/users/me", response_model=UserResponse)
def get_my_profile(authorization: str = Header("")) -> UserResponse:
    """Get the current logged-in user's profile."""
    user, error = require_role(authorization, ["admin", "landlord", "tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return UserResponse(
        user_id=user["user_id"],
        name=user["name"],
        email=user["email"],
        role=user["role"],
        points=user.get("points", 0),
        properties=user.get("properties", []),
        property_address=user.get("property_address", ""),
        landlord_id=user.get("landlord_id", ""),
        created_at=user.get("created_at", ""),
    )


# === ADMIN: MANAGE LANDLORDS ===

@router.post("/api/admin/landlords", response_model=UserResponse)
def create_landlord(
    request: CreateLandlordRequest,
    authorization: str = Header(""),
) -> UserResponse:
    """Admin creates a new landlord account."""
    user, error = require_role(authorization, ["admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    users_col = db["users"]

    try:
        # Check if email already exists
        if users_col.find_one({"email": request.email.lower().strip()}):
            raise HTTPException(status_code=409, detail="A user with this email already exists.")

        now = datetime.now(timezone.utc).isoformat()
        landlord_id = str(uuid.uuid4())

        landlord_doc = {
            "user_id": landlord_id,
            "name": request.name.strip(),
            "email": request.email.lower().strip(),
            "password_hash": hash_password(request.password),
            "role": "landlord",
            "properties": request.properties,
            "points": 0,
            "created_at": now,
            "auth_token": "",
            "token_expires_at": None,
        }

        users_col.insert_one(landlord_doc)
        logger.info(f"AUDIT: Admin {user.get('user_id')} created landlord {landlord_id} ({request.email})")

        return UserResponse(
            user_id=landlord_id,
            name=request.name.strip(),
            email=request.email.lower().strip(),
            role="landlord",
            properties=request.properties,
            created_at=now,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to create landlord: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to create landlord: {str(exc)}")


@router.get("/api/admin/landlords", response_model=List[UserResponse])
def list_landlords(
    authorization: str = Header(""),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
) -> List[UserResponse]:
    """Admin lists all landlords with pagination."""
    user, error = require_role(authorization, ["admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    users_col = db["users"]
    skip = (page - 1) * page_size
    landlords = users_col.find(
        {"role": "landlord"},
        {"password_hash": 0, "auth_token": 0, "token_expires_at": 0, "_id": 0},
    ).skip(skip).limit(page_size)

    return [
        UserResponse(
            user_id=ll["user_id"],
            name=ll["name"],
            email=ll["email"],
            role="landlord",
            properties=ll.get("properties", []),
            created_at=ll.get("created_at", ""),
        )
        for ll in landlords
    ]


@router.delete("/api/admin/landlords/{landlord_id}")
def delete_landlord(
    landlord_id: str,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """Admin deletes a landlord and all their tenants."""
    user, error = require_role(authorization, ["admin"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    users_col = db["users"]

    # Verify landlord exists first
    landlord = users_col.find_one({"user_id": landlord_id, "role": "landlord"})
    if not landlord:
        raise HTTPException(status_code=404, detail="Landlord not found.")

    # Delete landlord's tenants first
    tenants_deleted = users_col.delete_many({"landlord_id": landlord_id, "role": "tenant"})

    # Delete the landlord
    result = users_col.delete_one({"user_id": landlord_id, "role": "landlord"})

    # Also clean up their tasks and perks
    tasks_deleted = db["tasks"].delete_many({"landlord_id": landlord_id})
    perks_deleted = db["perks"].delete_many({"landlord_id": landlord_id})

    logger.info(
        f"AUDIT: Admin {user.get('user_id')} deleted landlord {landlord_id} "
        f"(tenants removed: {tenants_deleted.deleted_count}, "
        f"tasks removed: {tasks_deleted.deleted_count}, "
        f"perks removed: {perks_deleted.deleted_count})"
    )

    return {
        "message": "Landlord deleted",
        "tenants_removed": tenants_deleted.deleted_count,
    }


# === LANDLORD: MANAGE TENANTS ===

@router.post("/api/landlord/tenants", response_model=UserResponse)
def create_tenant(
    request: CreateTenantRequest,
    authorization: str = Header(""),
) -> UserResponse:
    """Landlord creates a new tenant under their management."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    users_col = db["users"]

    try:
        # Check if email already exists
        if users_col.find_one({"email": request.email.lower().strip()}):
            raise HTTPException(status_code=409, detail="A user with this email already exists.")

        now = datetime.now(timezone.utc).isoformat()
        tenant_id = str(uuid.uuid4())

        tenant_doc = {
            "user_id": tenant_id,
            "name": request.name.strip(),
            "email": request.email.lower().strip(),
            "password_hash": hash_password(request.password),
            "role": "tenant",
            "landlord_id": user["user_id"],
            "property_address": request.property_address.strip(),
            "points": 0,
            "created_at": now,
            "auth_token": "",
            "token_expires_at": None,
        }

        users_col.insert_one(tenant_doc)
        logger.info(f"AUDIT: Landlord {user['user_id']} created tenant {tenant_id} ({request.email})")

        return UserResponse(
            user_id=tenant_id,
            name=request.name.strip(),
            email=request.email.lower().strip(),
            role="tenant",
            property_address=request.property_address.strip(),
            landlord_id=user["user_id"],
            created_at=now,
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to create tenant: {exc}")
        raise HTTPException(status_code=500, detail=f"Failed to create tenant: {str(exc)}")


@router.get("/api/landlord/tenants", response_model=List[UserResponse])
def list_tenants(
    authorization: str = Header(""),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
) -> List[UserResponse]:
    """Landlord lists their tenants with pagination."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    users_col = db["users"]
    skip = (page - 1) * page_size
    tenants = users_col.find(
        {"role": "tenant", "landlord_id": user["user_id"]},
        {"password_hash": 0, "auth_token": 0, "token_expires_at": 0, "_id": 0},
    ).skip(skip).limit(page_size)

    return [
        UserResponse(
            user_id=t["user_id"],
            name=t["name"],
            email=t["email"],
            role="tenant",
            points=t.get("points", 0),
            property_address=t.get("property_address", ""),
            landlord_id=t.get("landlord_id", ""),
            created_at=t.get("created_at", ""),
        )
        for t in tenants
    ]


@router.delete("/api/landlord/tenants/{tenant_id}")
def delete_tenant(
    tenant_id: str,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """Landlord deletes one of their tenants."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    users_col = db["users"]

    # Only delete if this tenant belongs to this landlord
    result = users_col.delete_one({
        "user_id": tenant_id,
        "role": "tenant",
        "landlord_id": user["user_id"],
    })

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tenant not found or not yours.")

    # Clean up their tasks
    tasks_deleted = db["tasks"].delete_many({"tenant_id": tenant_id})

    logger.info(
        f"AUDIT: Landlord {user['user_id']} deleted tenant {tenant_id} "
        f"(tasks removed: {tasks_deleted.deleted_count})"
    )

    return {"message": "Tenant deleted"}
