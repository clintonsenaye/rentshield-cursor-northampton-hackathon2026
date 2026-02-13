"""
Perks management routes.

Flow:
1. Landlord creates perks (e.g., "£10 off rent", "Free parking for a month")
2. Tenants browse available perks
3. Tenants spend their earned points to claim a perk
4. Landlord sees claimed perks to fulfill them
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException, Query

from database.connection import get_database
from models.users import ClaimPerkResponse, CreatePerkRequest, PerkResponse
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/perks", tags=["perks"])


# === LANDLORD: CREATE & MANAGE PERKS ===

@router.post("", response_model=PerkResponse)
def create_perk(
    request: CreatePerkRequest,
    authorization: str = Header(""),
) -> PerkResponse:
    """Landlord creates a new perk that tenants can claim with points."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    perk_id = str(uuid.uuid4())

    perk_doc = {
        "perk_id": perk_id,
        "title": request.title.strip(),
        "description": request.description.strip(),
        "points_cost": request.points_cost,
        "available_quantity": request.available_quantity,
        "landlord_id": user["user_id"],
        "claimed_count": 0,
        "created_at": now,
    }

    db["perks"].insert_one(perk_doc)
    logger.info(f"Landlord {user['user_id']} created perk: {request.title}")

    return PerkResponse(**{k: v for k, v in perk_doc.items() if k != "_id"})


@router.get("", response_model=List[PerkResponse])
def list_perks(
    authorization: str = Header(""),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
) -> List[PerkResponse]:
    """
    List perks based on role:
    - Landlord: sees perks they created
    - Tenant: sees perks from their landlord
    """
    user, error = require_role(authorization, ["landlord", "tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Determine which landlord's perks to show
    if user["role"] == "landlord":
        landlord_id = user["user_id"]
    else:
        landlord_id = user.get("landlord_id", "")

    if not landlord_id:
        logger.warning(f"Tenant {user.get('user_id')} has no landlord_id assigned")
        return []

    skip = (page - 1) * page_size
    perks = (
        db["perks"]
        .find({"landlord_id": landlord_id}, {"_id": 0})
        .sort("created_at", -1)
        .skip(skip)
        .limit(page_size)
    )
    return [PerkResponse(**p) for p in perks]


@router.delete("/{perk_id}")
def delete_perk(
    perk_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Landlord deletes a perk."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    result = db["perks"].delete_one({"perk_id": perk_id, "landlord_id": user["user_id"]})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Perk not found or not yours.")

    return {"message": "Perk deleted"}


# === TENANT: CLAIM PERKS ===

@router.post("/{perk_id}/claim", response_model=ClaimPerkResponse)
def claim_perk(
    perk_id: str,
    authorization: str = Header(""),
) -> ClaimPerkResponse:
    """
    Tenant spends points to claim a perk.

    Uses atomic operations to prevent race conditions:
    - Points deduction and quantity check are done atomically
    - Prevents overselling and double-spending
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Find the perk
    perk = db["perks"].find_one({"perk_id": perk_id})
    if not perk:
        raise HTTPException(status_code=404, detail="Perk not found.")

    # Check perk belongs to tenant's landlord
    if perk["landlord_id"] != user.get("landlord_id", ""):
        raise HTTPException(status_code=403, detail="This perk is not available to you.")

    points_cost = perk["points_cost"]

    # Check quantity availability
    if perk["available_quantity"] != -1 and perk["claimed_count"] >= perk["available_quantity"]:
        return ClaimPerkResponse(
            success=False,
            message="Sorry, this perk is no longer available (all claimed).",
            remaining_points=user.get("points", 0),
        )

    # Check points
    tenant_points = user.get("points", 0)
    if tenant_points < points_cost:
        return ClaimPerkResponse(
            success=False,
            message=f"You need {points_cost} points but only have {tenant_points}.",
            remaining_points=tenant_points,
        )

    # ATOMIC: Deduct points only if tenant still has enough
    # This prevents double-spending in concurrent requests
    users_col = db["users"]
    points_result = users_col.find_one_and_update(
        {"user_id": user["user_id"], "points": {"$gte": points_cost}},
        {"$inc": {"points": -points_cost}},
        return_document=True,
    )

    if points_result is None:
        return ClaimPerkResponse(
            success=False,
            message="Insufficient points (another claim may have been processed first).",
            remaining_points=user.get("points", 0),
        )

    # ATOMIC: Increment claimed count only if quantity available
    if perk["available_quantity"] != -1:
        perk_result = db["perks"].find_one_and_update(
            {
                "perk_id": perk_id,
                "$expr": {"$lt": ["$claimed_count", "$available_quantity"]},
            },
            {"$inc": {"claimed_count": 1}},
            return_document=True,
        )
        if perk_result is None:
            # Refund points -- perk sold out between check and claim
            users_col.update_one(
                {"user_id": user["user_id"]},
                {"$inc": {"points": points_cost}},
            )
            return ClaimPerkResponse(
                success=False,
                message="Sorry, this perk just sold out. Your points have been refunded.",
                remaining_points=points_result.get("points", 0) + points_cost,
            )
    else:
        # Unlimited quantity
        db["perks"].update_one(
            {"perk_id": perk_id},
            {"$inc": {"claimed_count": 1}},
        )

    # Record the claim
    now = datetime.now(timezone.utc).isoformat()
    try:
        db["perk_claims"].insert_one({
            "claim_id": str(uuid.uuid4()),
            "perk_id": perk_id,
            "perk_title": perk["title"],
            "tenant_id": user["user_id"],
            "tenant_name": user.get("name", ""),
            "landlord_id": perk["landlord_id"],
            "points_spent": points_cost,
            "claimed_at": now,
            "fulfilled": False,
        })
    except Exception as exc:
        logger.error(f"Failed to record perk claim: {exc}")

    remaining = points_result.get("points", tenant_points - points_cost)
    logger.info(f"Tenant {user['user_id']} claimed perk '{perk['title']}' for {points_cost} pts")

    return ClaimPerkResponse(
        success=True,
        message=f"You claimed '{perk['title']}'! Your landlord has been notified.",
        remaining_points=remaining,
    )


# === LANDLORD: VIEW CLAIMS ===

@router.get("/claims", response_model=List[Dict[str, Any]])
def list_claims(
    authorization: str = Header(""),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(50, ge=1, le=100, description="Items per page"),
) -> List[Dict[str, Any]]:
    """Landlord views all perk claims from their tenants with pagination."""
    user, error = require_role(authorization, ["landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    skip = (page - 1) * page_size
    claims = (
        db["perk_claims"]
        .find({"landlord_id": user["user_id"]}, {"_id": 0})
        .sort("claimed_at", -1)
        .skip(skip)
        .limit(page_size)
    )

    return list(claims)
