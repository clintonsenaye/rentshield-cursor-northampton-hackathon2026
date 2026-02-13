"""
User models for the multi-role system.

Roles:
- Admin: can create/manage landlords
- Landlord: can create/manage tenants, create tasks, verify completions, define perks
- Tenant: can view tasks, submit proof photos, claim perks
"""

import re
from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


# === AUTH MODELS ===

class LoginRequest(BaseModel):
    """Login request with email and password."""
    email: EmailStr = Field(..., description="User email")
    password: str = Field(..., min_length=1, max_length=128, description="User password")


class LoginResponse(BaseModel):
    """Login response with token and user info."""
    token: str = Field(..., description="Auth token for API requests")
    user_id: str = Field(..., description="User's unique ID")
    role: Literal["admin", "landlord", "tenant"] = Field(..., description="User role")
    name: str = Field(..., description="User's display name")


# === PASSWORD VALIDATION MIXIN ===

def _validate_strong_password(password: str) -> str:
    """
    Validate password strength.
    Requirements: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit.
    """
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise ValueError("Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one digit")
    return password


# === USER CRUD MODELS ===

class CreateLandlordRequest(BaseModel):
    """Admin creates a landlord."""
    name: str = Field(..., min_length=1, max_length=200, description="Landlord's full name")
    email: EmailStr = Field(..., description="Landlord's email")
    password: str = Field(..., min_length=8, max_length=128, description="Landlord's password")
    properties: List[str] = Field(
        default_factory=list,
        max_length=50,
        description="List of property addresses",
    )

    @field_validator("password")
    @classmethod
    def password_strong(cls, v: str) -> str:
        return _validate_strong_password(v)

    @field_validator("properties")
    @classmethod
    def properties_not_empty_strings(cls, v: List[str]) -> List[str]:
        return [p.strip() for p in v if p.strip()]


class CreateTenantRequest(BaseModel):
    """Landlord creates a tenant."""
    name: str = Field(..., min_length=1, max_length=200, description="Tenant's full name")
    email: EmailStr = Field(..., description="Tenant's email")
    password: str = Field(..., min_length=8, max_length=128, description="Tenant's password")
    property_address: str = Field(default="", max_length=500, description="Tenant's property address")

    @field_validator("password")
    @classmethod
    def password_strong(cls, v: str) -> str:
        return _validate_strong_password(v)


class UserResponse(BaseModel):
    """Public user info (no password)."""
    user_id: str
    name: str
    email: str
    role: Literal["admin", "landlord", "tenant"]
    points: int = 0
    properties: List[str] = Field(default_factory=list)
    property_address: str = ""
    landlord_id: str = ""
    created_at: str = ""


# === PASSWORD MANAGEMENT MODELS ===

class ChangePasswordRequest(BaseModel):
    """Request to change the current user's password."""
    current_password: str = Field(..., min_length=1, max_length=128, description="Current password")
    new_password: str = Field(..., min_length=8, max_length=128, description="New password")

    @field_validator("new_password")
    @classmethod
    def new_password_strong(cls, v: str) -> str:
        return _validate_strong_password(v)


class RequestPasswordResetRequest(BaseModel):
    """Request a password reset token (admin/landlord generates for their users)."""
    email: EmailStr = Field(..., description="Email of the user to reset")


class ResetPasswordRequest(BaseModel):
    """Reset password using a one-time token."""
    email: EmailStr = Field(..., description="User's email address")
    reset_token: str = Field(..., min_length=1, max_length=100, description="One-time reset token")
    new_password: str = Field(..., min_length=8, max_length=128, description="New password")

    @field_validator("new_password")
    @classmethod
    def new_password_strong(cls, v: str) -> str:
        return _validate_strong_password(v)


# === TASK MODELS ===

class CreateTaskRequest(BaseModel):
    """Landlord creates a task for a tenant."""
    title: str = Field(..., min_length=1, max_length=200, description="Task title")
    description: str = Field(default="", max_length=2000, description="Task details")
    tenant_id: str = Field(..., min_length=1, max_length=100, description="Assigned tenant's user_id")
    points_reward: int = Field(default=10, ge=1, le=500, description="Points awarded on completion")
    category: str = Field(
        default="general",
        pattern="^(cleaning|maintenance|energy_saving|community|general)$",
        description="Task category: cleaning, maintenance, energy_saving, community, general"
    )


class TaskResponse(BaseModel):
    """Full task information."""
    task_id: str
    title: str
    description: str
    tenant_id: str
    tenant_name: str = ""
    landlord_id: str
    points_reward: int
    category: str
    status: str  # pending, submitted, approved, rejected
    proof_image: str = ""  # URL/path to uploaded photo
    rejection_reason: str = ""
    created_at: str = ""
    submitted_at: str = ""
    verified_at: str = ""


class VerifyTaskRequest(BaseModel):
    """Landlord approves or rejects a task submission."""
    approved: bool = Field(..., description="True to approve, False to reject")
    reason: str = Field(default="", max_length=1000, description="Reason for rejection (if rejected)")


# === PERK MODELS ===

class CreatePerkRequest(BaseModel):
    """Landlord creates a perk tenants can claim."""
    title: str = Field(..., min_length=1, max_length=200, description="Perk title")
    description: str = Field(default="", max_length=2000, description="Perk details")
    points_cost: int = Field(..., ge=1, description="Points required to claim")
    available_quantity: int = Field(default=-1, description="How many available (-1 = unlimited)")


class PerkResponse(BaseModel):
    """Full perk information."""
    perk_id: str
    title: str
    description: str
    points_cost: int
    available_quantity: int
    landlord_id: str
    claimed_count: int = 0
    created_at: str = ""


class ClaimPerkResponse(BaseModel):
    """Response after claiming a perk."""
    success: bool
    message: str
    remaining_points: int = 0
