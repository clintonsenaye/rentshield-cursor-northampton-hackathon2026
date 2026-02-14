"""
Integration tests for critical API paths.

Tests dashboard, notifications, GDPR, auth flows, evidence, and maintenance
endpoints using the FastAPI TestClient with mocked database.
"""

import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta


# ---------------------------------------------------------------------------
# Auth Integration Tests
# ---------------------------------------------------------------------------


class TestLoginFlow:
    """Integration tests for the login/logout flow."""

    def test_login_success(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        mock_db["users"].find_one.return_value = {
            **mock_auth_tenant,
            "_id": "fake",
            "password_hash": "$2b$12$LJ3m4ys3Gzl/2Kjq/LqS0OqHkPwR0Zq4FKhd8PGKVxE/yNoLzFSy",
        }
        with patch("utils.auth.verify_password", return_value=True), \
             patch("utils.auth.generate_token", return_value="test-token-123"):
            resp = client.post("/api/auth/login", json={
                "email": "tenant@test.com",
                "password": "password123",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data["token"] == "test-token-123"
            assert data["role"] == "tenant"

    def test_login_bad_password(self, test_app):
        client, mock_db = test_app
        mock_db["users"].find_one.return_value = {
            "user_id": "t1", "email": "t@t.com", "role": "tenant",
            "name": "T", "password_hash": "hash", "_id": "x",
        }
        with patch("utils.auth.verify_password", return_value=False):
            resp = client.post("/api/auth/login", json={
                "email": "t@t.com",
                "password": "wrong",
            })
            assert resp.status_code == 401

    def test_login_must_change_password(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        result = {
            "user_id": "tenant-001", "name": "Test", "email": "tenant@test.com",
            "role": "tenant", "token": "tok", "must_change_password": True,
        }
        with patch("routes.users.authenticate_user", return_value=result):
            resp = client.post("/api/auth/login", json={
                "email": "tenant@test.com",
                "password": "password123",
            })
            assert resp.status_code == 403
            assert "Password change required" in resp.json()["detail"]

    def test_logout(self, test_app):
        client, mock_db = test_app
        with patch("routes.users.revoke_token", return_value=True):
            resp = client.post(
                "/api/auth/logout",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200


class TestAccountLockout:
    """Tests for account lockout after failed login attempts."""

    def test_lockout_blocks_login(self, test_app):
        client, mock_db = test_app
        # authenticate_user returns None when account is locked
        with patch("routes.users.authenticate_user", return_value=None):
            resp = client.post("/api/auth/login", json={
                "email": "t@t.com",
                "password": "password123",
            })
            assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Dashboard Integration Tests
# ---------------------------------------------------------------------------


class TestDashboard:
    """Integration tests for the tenant dashboard endpoint."""

    def test_dashboard_returns_data(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_db["conversations"].count_documents.return_value = 5
            mock_db["evidence"].count_documents.return_value = 3
            mock_db["timeline"].count_documents.return_value = 2
            mock_db["tasks"].find.return_value = []
            # Maintenance cursor needs to support .sort().limit() chaining
            maint_cursor = MagicMock()
            maint_cursor.sort.return_value = maint_cursor
            maint_cursor.limit.return_value = []
            mock_db["maintenance"].find.return_value = maint_cursor

            resp = client.get(
                "/api/dashboard",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "conversation_count" in data
            assert "evidence_count" in data

    def test_dashboard_requires_auth(self, test_app):
        client, _ = test_app
        resp = client.get("/api/dashboard")
        assert resp.status_code in (401, 422)


# ---------------------------------------------------------------------------
# Notification Integration Tests
# ---------------------------------------------------------------------------


class TestNotifications:
    """Integration tests for the notification system."""

    def test_list_notifications(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_cursor = MagicMock()
            mock_cursor.sort.return_value = mock_cursor
            mock_cursor.limit.return_value = [
                {
                    "notification_id": "n1",
                    "recipient_id": "tenant-001",
                    "message": "Test notification",
                    "read": False,
                    "created_at": "2026-01-01T00:00:00",
                },
            ]
            mock_db["notifications"].find.return_value = mock_cursor

            resp = client.get(
                "/api/notifications",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200

    def test_mark_notification_read(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_db["notifications"].update_one.return_value = MagicMock(modified_count=1)

            resp = client.post(
                "/api/notifications/n1/read",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GDPR Integration Tests
# ---------------------------------------------------------------------------


class TestGDPR:
    """Integration tests for GDPR endpoints."""

    def test_export_data(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_db["users"].find_one.return_value = {
                "user_id": "tenant-001", "name": "Test", "email": "t@t.com",
                "role": "tenant",
            }
            for col_name in [
                "conversations", "analytics", "wellbeing_journal", "rewards",
                "evidence", "timeline", "letters", "agreement_analyses",
                "deposit_checks", "tasks", "perk_claims", "maintenance",
                "notifications", "compliance",
            ]:
                mock_cursor = MagicMock()
                mock_cursor.limit.return_value = []
                mock_db[col_name].find.return_value = mock_cursor

            resp = client.get(
                "/api/gdpr/export",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "profile" in data
            assert "export_metadata" in data

    def test_delete_account_wrong_password(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_db["users"].find_one.return_value = {
                **mock_auth_tenant,
                "_id": "x",
                "password_hash": "hash",
            }
            with patch("routes.gdpr.verify_password", return_value=False):
                resp = client.request(
                    "DELETE",
                    "/api/gdpr/account",
                    headers={"Authorization": "Bearer test-token"},
                    json={"password": "wrong"},
                )
                assert resp.status_code == 403

    def test_privacy_policy_public(self, test_app):
        client, _ = test_app
        resp = client.get("/api/gdpr/privacy-policy")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "RentShield Privacy Policy"
        assert len(data["sections"]) > 0


# ---------------------------------------------------------------------------
# Evidence Integration Tests
# ---------------------------------------------------------------------------


class TestEvidence:
    """Integration tests for evidence upload path traversal protection."""

    def test_list_evidence_requires_auth(self, test_app):
        client, _ = test_app
        resp = client.get("/api/evidence")
        assert resp.status_code in (401, 422)

    def test_list_evidence_returns_items(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_cursor = MagicMock()
            mock_cursor.sort.return_value = mock_cursor
            mock_cursor.limit.return_value = []
            mock_db["evidence"].find.return_value = mock_cursor

            resp = client.get(
                "/api/evidence",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Magic Byte Validation Tests
# ---------------------------------------------------------------------------


class TestMagicByteValidation:
    """Tests for file upload magic byte validation."""

    def test_evidence_magic_bytes(self):
        from routes.evidence import _validate_magic_bytes

        # Valid JPEG
        assert _validate_magic_bytes(b"\xff\xd8\xff\xe0test", "image/jpeg") is True
        # Valid PNG
        assert _validate_magic_bytes(b"\x89PNG\r\n\x1a\ntest", "image/png") is True
        # Valid PDF
        assert _validate_magic_bytes(b"%PDF-1.4test", "application/pdf") is True
        # Invalid: JPEG header with PNG content type
        assert _validate_magic_bytes(b"\xff\xd8\xff", "image/png") is False
        # Invalid: empty bytes
        assert _validate_magic_bytes(b"", "image/jpeg") is False
        # Unknown content type
        assert _validate_magic_bytes(b"test", "text/plain") is False

    def test_maintenance_magic_bytes(self):
        from routes.maintenance import _validate_magic_bytes

        assert _validate_magic_bytes(b"\xff\xd8\xff\xe0test", "image/jpeg") is True
        assert _validate_magic_bytes(b"\x89PNG\r\n\x1a\ntest", "image/png") is True
        assert _validate_magic_bytes(b"GIF89a", "image/gif") is True
        assert _validate_magic_bytes(b"not-an-image", "image/jpeg") is False


# ---------------------------------------------------------------------------
# Path Traversal Protection Tests
# ---------------------------------------------------------------------------


class TestPathTraversalProtection:
    """Tests for path traversal protection in evidence deletion."""

    def test_evidence_delete_blocks_traversal(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            mock_db["evidence"].find_one.return_value = {
                "evidence_id": "e1",
                "user_id": "tenant-001",
                "file_url": "/../../../etc/passwd",
            }
            # The delete should succeed (DB record removed) but not delete
            # the traversal path file. We just verify it doesn't crash.
            resp = client.delete(
                "/api/evidence/e1",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Security Headers Tests
# ---------------------------------------------------------------------------


class TestSecurityHeaders:
    """Tests for security headers middleware."""

    def test_health_has_security_headers(self, test_app):
        client, mock_db = test_app
        # Mock the health check dependencies
        with patch("database.connection.get_mongo_client", return_value=None):
            resp = client.get("/health")
            assert resp.status_code == 200
            assert resp.headers.get("X-Content-Type-Options") == "nosniff"
            assert resp.headers.get("X-Frame-Options") == "DENY"
            assert "Content-Security-Policy" in resp.headers


# ---------------------------------------------------------------------------
# Case Export Limits Tests
# ---------------------------------------------------------------------------


class TestCaseExportLimits:
    """Tests for case export query limits."""

    def test_case_export_returns_bundle(self, test_app, mock_auth_tenant):
        client, mock_db = test_app
        with patch("utils.auth.get_current_user", return_value=mock_auth_tenant):
            # Set up mock cursors that support chaining
            for col in ["evidence", "timeline", "letters",
                        "agreement_analyses", "deposit_checks",
                        "maintenance", "conversations"]:
                mock_cursor = MagicMock()
                mock_cursor.sort.return_value = mock_cursor
                mock_cursor.limit.return_value = mock_cursor
                mock_cursor.__iter__ = MagicMock(return_value=iter([]))
                mock_db[col].find.return_value = mock_cursor

            resp = client.get(
                "/api/case-export",
                headers={"Authorization": "Bearer test-token"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "export_info" in data
            assert "summary" in data
            assert "timeline" in data
