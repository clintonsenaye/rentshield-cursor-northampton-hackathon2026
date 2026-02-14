"""
Shared pytest fixtures for RentShield tests.
"""

import os
import pytest

# Set env vars before any app imports
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/rentshield_test")
os.environ.setdefault("MINIMAX_API_KEY", "test-key")
os.environ.setdefault("MINIMAX_GROUP_ID", "test-group")


@pytest.fixture()
def test_app():
    """Create a FastAPI TestClient with mocked database."""
    from unittest.mock import patch, MagicMock

    mock_db = MagicMock()
    mock_client = MagicMock()

    with patch("database.connection._database", mock_db), \
         patch("database.connection._mongo_client", mock_client), \
         patch("database.connection.get_database", return_value=mock_db), \
         patch("database.connection.get_legal_knowledge_collection", return_value=mock_db["legal_knowledge"]):
        from fastapi.testclient import TestClient
        from app import app
        yield TestClient(app), mock_db


@pytest.fixture()
def mock_auth_tenant():
    """Return a mock tenant user dict."""
    return {
        "user_id": "tenant-001",
        "name": "Test Tenant",
        "email": "tenant@test.com",
        "role": "tenant",
        "points": 0,
        "landlord_id": "landlord-001",
    }


@pytest.fixture()
def mock_auth_landlord():
    """Return a mock landlord user dict."""
    return {
        "user_id": "landlord-001",
        "name": "Test Landlord",
        "email": "landlord@test.com",
        "role": "landlord",
        "points": 0,
    }


@pytest.fixture()
def mock_auth_admin():
    """Return a mock admin user dict."""
    return {
        "user_id": "admin-001",
        "name": "Test Admin",
        "email": "admin@test.com",
        "role": "admin",
    }
