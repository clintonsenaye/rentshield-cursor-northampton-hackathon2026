"""
Unit tests for authentication utilities.

Tests password hashing, token validation, and role-based access control.
"""

import pytest
from utils.auth import (
    hash_password,
    verify_password,
    generate_token,
    require_role,
)


class TestPasswordHashing:
    """Tests for bcrypt password hashing."""

    def test_hash_password_returns_string(self):
        hashed = hash_password("testpassword")
        assert isinstance(hashed, str)
        assert len(hashed) > 0

    def test_hash_is_different_from_plaintext(self):
        password = "mypassword123"
        hashed = hash_password(password)
        assert hashed != password

    def test_different_hashes_for_same_password(self):
        """bcrypt uses random salt, so same password produces different hashes."""
        h1 = hash_password("samepassword")
        h2 = hash_password("samepassword")
        assert h1 != h2

    def test_verify_correct_password(self):
        password = "correctpassword"
        hashed = hash_password(password)
        assert verify_password(password, hashed) is True

    def test_verify_wrong_password(self):
        hashed = hash_password("correctpassword")
        assert verify_password("wrongpassword", hashed) is False

    def test_verify_empty_password(self):
        hashed = hash_password("something")
        assert verify_password("", hashed) is False

    def test_verify_invalid_hash(self):
        """Should return False for non-bcrypt hash, not crash."""
        assert verify_password("test", "not-a-valid-hash") is False

    def test_verify_empty_hash(self):
        assert verify_password("test", "") is False


class TestTokenGeneration:
    """Tests for auth token generation."""

    def test_token_is_hex_string(self):
        token = generate_token()
        assert isinstance(token, str)
        int(token, 16)  # Should not raise if valid hex

    def test_token_length(self):
        token = generate_token()
        assert len(token) == 64  # 32 bytes = 64 hex chars

    def test_tokens_are_unique(self):
        tokens = {generate_token() for _ in range(100)}
        assert len(tokens) == 100


class TestRequireRole:
    """Tests for role-based access control."""

    def test_missing_token(self):
        user, error = require_role("", ["admin"])
        assert user is None
        assert "Missing auth token" in error

    def test_none_token(self):
        user, error = require_role(None, ["admin"])
        assert user is None

    def test_bearer_prefix_stripped(self):
        """Token with 'Bearer ' prefix should be stripped before lookup."""
        from unittest.mock import patch
        with patch("utils.auth.get_current_user", return_value=None):
            user, error = require_role("Bearer fake-token", ["admin"])
            assert user is None
            assert "Invalid or expired" in error

    def test_valid_user_wrong_role(self):
        """User exists but doesn't have the required role."""
        from unittest.mock import patch
        mock_user = {"user_id": "t1", "role": "tenant"}
        with patch("utils.auth.get_current_user", return_value=mock_user):
            user, error = require_role("valid-token", ["admin"])
            assert user is None
            assert "Access denied" in error

    def test_valid_user_correct_role(self):
        from unittest.mock import patch
        mock_user = {"user_id": "a1", "role": "admin"}
        with patch("utils.auth.get_current_user", return_value=mock_user):
            user, error = require_role("valid-token", ["admin"])
            assert user is not None
            assert error is None
            assert user["role"] == "admin"

    def test_multiple_allowed_roles(self):
        from unittest.mock import patch
        mock_user = {"user_id": "l1", "role": "landlord"}
        with patch("utils.auth.get_current_user", return_value=mock_user):
            user, error = require_role("valid-token", ["tenant", "landlord"])
            assert user is not None
            assert error is None
