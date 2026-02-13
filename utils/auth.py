"""
Secure token-based authentication for the multi-role system.

Uses bcrypt for password hashing with automatic salting.
Tokens have expiration and can be revoked.
"""

import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

import bcrypt

from database.connection import get_database

logger = logging.getLogger(__name__)

# Token lifetime: 24 hours
TOKEN_EXPIRY_HOURS = 24


def hash_password(password: str) -> str:
    """Hash a password using bcrypt with automatic salting."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Check if a password matches its bcrypt hash (constant-time comparison)."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # Handle cases where the hash is not valid bcrypt (e.g., old SHA-256 hashes)
        return False


def generate_token() -> str:
    """Generate a cryptographically secure random auth token."""
    return secrets.token_hex(32)


def authenticate_user(email: str, password: str) -> Optional[dict]:
    """
    Authenticate a user by email and password.

    Returns the user document (without password) if valid, None otherwise.
    Logs failed authentication attempts for security monitoring.
    """
    db = get_database()
    if db is None:
        logger.error("Database unavailable during authentication attempt")
        return None

    users_col = db["users"]
    user = users_col.find_one({"email": email.lower().strip()})

    if not user:
        logger.warning(f"Failed login attempt for non-existent email: {email[:3]}***")
        return None

    if not verify_password(password, user.get("password_hash", "")):
        logger.warning(f"Failed login attempt (bad password) for user: {user.get('user_id', 'unknown')}")
        return None

    # Generate and store a new token with expiration
    token = generate_token()
    token_expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRY_HOURS)

    users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "auth_token": token,
            "token_expires_at": token_expires,
            "last_login": datetime.now(timezone.utc),
        }},
    )

    logger.info(f"Successful login for user: {user.get('user_id', 'unknown')} (role: {user.get('role')})")

    return {
        "user_id": user["user_id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "token": token,
    }


def get_current_user(token: str) -> Optional[dict]:
    """
    Look up a user by their auth token.

    Validates token existence and expiration.

    Args:
        token: The Bearer token from the Authorization header

    Returns:
        User document (without password) if token is valid and not expired, None otherwise.
    """
    if not token:
        return None

    db = get_database()
    if db is None:
        logger.error("Database unavailable during token validation")
        return None

    users_col = db["users"]
    user = users_col.find_one(
        {"auth_token": token},
        {"password_hash": 0, "_id": 0},
    )

    if not user:
        return None

    # Check token expiration
    expires_at = user.get("token_expires_at")
    if expires_at:
        # Handle both datetime objects and ISO strings
        if isinstance(expires_at, str):
            try:
                expires_at = datetime.fromisoformat(expires_at)
            except (ValueError, TypeError):
                return None

        # Ensure timezone-aware comparison (MongoDB may return naive datetimes)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)

        if datetime.now(timezone.utc) > expires_at:
            logger.info(f"Expired token used by user: {user.get('user_id', 'unknown')}")
            # Clean up expired token
            users_col.update_one(
                {"auth_token": token},
                {"$set": {"auth_token": ""}},
            )
            return None

    # Remove internal fields from response
    user.pop("auth_token", None)
    user.pop("token_expires_at", None)

    return user


def change_password(user_id: str, current_password: str, new_password: str) -> Tuple[bool, str]:
    """
    Change a user's password after verifying their current password.

    Args:
        user_id: The user's unique ID
        current_password: Their current password for verification
        new_password: The new password to set

    Returns:
        Tuple of (success, message)
    """
    db = get_database()
    if db is None:
        return False, "Database unavailable"

    users_col = db["users"]
    user = users_col.find_one({"user_id": user_id})

    if not user:
        return False, "User not found"

    if not verify_password(current_password, user.get("password_hash", "")):
        logger.warning("Failed password change attempt (bad current password) for user: %s", user_id)
        return False, "Current password is incorrect"

    users_col.update_one(
        {"user_id": user_id},
        {"$set": {
            "password_hash": hash_password(new_password),
            "auth_token": "",
            "token_expires_at": None,
        }},
    )

    logger.info("Password changed for user: %s", user_id)
    return True, "Password changed successfully. Please log in again."


def generate_password_reset_token(email: str) -> Tuple[Optional[str], str]:
    """
    Generate a one-time password reset token for a user.

    The token expires in 1 hour. This can be triggered by an admin/landlord
    for their users, or extended to email-based self-service in the future.

    Args:
        email: The user's email address

    Returns:
        Tuple of (reset_token or None, message)
    """
    db = get_database()
    if db is None:
        return None, "Database unavailable"

    users_col = db["users"]
    user = users_col.find_one({"email": email.lower().strip()})

    if not user:
        # Return generic message to avoid email enumeration
        return None, "If an account exists with that email, a reset token has been generated."

    reset_token = secrets.token_hex(16)
    reset_expiry = datetime.now(timezone.utc) + timedelta(hours=1)

    users_col.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "reset_token": reset_token,
            "reset_token_expires": reset_expiry,
        }},
    )

    logger.info("Password reset token generated for user: %s", user.get("user_id", "unknown"))
    return reset_token, "Reset token generated. It expires in 1 hour."


def reset_password_with_token(email: str, reset_token: str, new_password: str) -> Tuple[bool, str]:
    """
    Reset a user's password using a valid reset token.

    Args:
        email: The user's email
        reset_token: The one-time reset token
        new_password: The new password to set

    Returns:
        Tuple of (success, message)
    """
    db = get_database()
    if db is None:
        return False, "Database unavailable"

    users_col = db["users"]
    user = users_col.find_one({
        "email": email.lower().strip(),
        "reset_token": reset_token,
    })

    if not user:
        return False, "Invalid email or reset token."

    # Check token expiry
    reset_expiry = user.get("reset_token_expires")
    if reset_expiry:
        if isinstance(reset_expiry, str):
            try:
                reset_expiry = datetime.fromisoformat(reset_expiry)
            except (ValueError, TypeError):
                return False, "Invalid reset token."

        # Ensure timezone-aware comparison (MongoDB may return naive datetimes)
        if reset_expiry.tzinfo is None:
            reset_expiry = reset_expiry.replace(tzinfo=timezone.utc)

        if datetime.now(timezone.utc) > reset_expiry:
            # Clean up expired token
            users_col.update_one(
                {"_id": user["_id"]},
                {"$unset": {"reset_token": "", "reset_token_expires": ""}},
            )
            return False, "Reset token has expired. Please request a new one."

    # Set new password and clear reset token + auth token (force re-login)
    users_col.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "password_hash": hash_password(new_password),
                "auth_token": "",
                "token_expires_at": None,
            },
            "$unset": {
                "reset_token": "",
                "reset_token_expires": "",
            },
        },
    )

    logger.info("Password reset completed for user: %s", user.get("user_id", "unknown"))
    return True, "Password reset successfully. Please log in with your new password."


def revoke_token(token: str) -> bool:
    """
    Revoke/invalidate a user's auth token (logout).

    Args:
        token: The Bearer token to revoke

    Returns:
        True if token was revoked, False otherwise
    """
    if not token:
        return False

    db = get_database()
    if db is None:
        return False

    users_col = db["users"]
    result = users_col.update_one(
        {"auth_token": token},
        {"$set": {"auth_token": "", "token_expires_at": None}},
    )

    return result.modified_count > 0


def require_role(token: str, allowed_roles: list) -> Tuple[Optional[dict], Optional[str]]:
    """
    Validate token and check if user has one of the allowed roles.

    Returns:
        Tuple of (user_dict, error_message). If error_message is not None, auth failed.
    """
    if not token:
        return None, "Missing auth token. Include 'Authorization: Bearer <token>' header."

    # Strip 'Bearer ' prefix if present
    if token.startswith("Bearer "):
        token = token[7:]

    user = get_current_user(token)
    if not user:
        return None, "Invalid or expired auth token. Please log in again."

    if user.get("role") not in allowed_roles:
        return None, f"Access denied. Required role: {', '.join(allowed_roles)}. Your role: {user.get('role')}"

    return user, None
