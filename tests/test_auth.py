"""Tests for authentication utilities."""

import pytest
from utils.auth import hash_password, verify_password, generate_token


class TestPasswordHashing:
    """Test bcrypt password hashing and verification."""

    def test_hash_password_returns_string(self):
        result = hash_password("TestPass123")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_hash_password_produces_bcrypt_hash(self):
        result = hash_password("TestPass123")
        assert result.startswith("$2b$") or result.startswith("$2a$")

    def test_hash_password_different_hashes_for_same_password(self):
        """bcrypt should produce different hashes due to random salt."""
        h1 = hash_password("TestPass123")
        h2 = hash_password("TestPass123")
        assert h1 != h2

    def test_verify_password_correct(self):
        hashed = hash_password("MySecret123")
        assert verify_password("MySecret123", hashed) is True

    def test_verify_password_incorrect(self):
        hashed = hash_password("MySecret123")
        assert verify_password("WrongPassword", hashed) is False

    def test_verify_password_empty(self):
        hashed = hash_password("MySecret123")
        assert verify_password("", hashed) is False

    def test_verify_password_invalid_hash(self):
        """Should return False for non-bcrypt hashes (e.g., old SHA-256)."""
        assert verify_password("test", "not_a_bcrypt_hash") is False

    def test_verify_password_sha256_hash_rejected(self):
        """Old SHA-256 hashes should be rejected (not compatible with bcrypt)."""
        import hashlib
        old_hash = hashlib.sha256("test".encode()).hexdigest()
        assert verify_password("test", old_hash) is False


class TestTokenGeneration:
    """Test token generation."""

    def test_generate_token_returns_string(self):
        token = generate_token()
        assert isinstance(token, str)

    def test_generate_token_length(self):
        token = generate_token()
        assert len(token) == 64  # 32 bytes hex = 64 chars

    def test_generate_token_uniqueness(self):
        tokens = {generate_token() for _ in range(100)}
        assert len(tokens) == 100  # All unique


class TestIssueDetection:
    """Test issue detection and urgency classification."""

    def test_critical_detection(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("My landlord changed the locks")
        assert issue == "illegal_eviction"
        assert urgency == "critical"

    def test_high_detection(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("I got a Section 21 notice")
        assert issue == "eviction"
        assert urgency == "high"

    def test_medium_rent(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("My rent going up by 50%")
        assert issue == "rent_increase"
        assert urgency == "medium"

    def test_medium_rent_increase(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("I got a rent increase letter")
        assert issue == "rent_increase"
        assert urgency == "medium"

    def test_medium_deposit(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("I want my deposit back")
        assert issue == "deposit"
        assert urgency == "medium"

    def test_low_pets(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("Can I have a pet?")
        assert issue == "pets"
        assert urgency == "low"

    def test_general_default(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("Hello how are you")
        assert issue == "general"
        assert urgency == "low"

    def test_empty_message(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency("")
        assert issue == "general"
        assert urgency == "low"

    def test_none_message(self):
        from utils.issue_detection import detect_issue_and_urgency
        issue, urgency = detect_issue_and_urgency(None)
        assert issue == "general"
        assert urgency == "low"

    def test_word_boundary_deposit(self):
        """'deposit' should not match in 'deposited' with word boundaries."""
        from utils.issue_detection import detect_issue_and_urgency
        # Single word 'deposit' uses word boundary
        issue1, _ = detect_issue_and_urgency("I need my deposit back")
        assert issue1 == "deposit"


class TestPasswordValidation:
    """Test password validation in models."""

    def test_strong_password_valid(self):
        from models.users import _validate_strong_password
        result = _validate_strong_password("MyPass123")
        assert result == "MyPass123"

    def test_password_too_short(self):
        from models.users import _validate_strong_password
        with pytest.raises(ValueError, match="at least 8 characters"):
            _validate_strong_password("Ab1")

    def test_password_no_uppercase(self):
        from models.users import _validate_strong_password
        with pytest.raises(ValueError, match="uppercase"):
            _validate_strong_password("mypass123")

    def test_password_no_lowercase(self):
        from models.users import _validate_strong_password
        with pytest.raises(ValueError, match="lowercase"):
            _validate_strong_password("MYPASS123")

    def test_password_no_digit(self):
        from models.users import _validate_strong_password
        with pytest.raises(ValueError, match="digit"):
            _validate_strong_password("MyPassword")


class TestWellbeingStreak:
    """Test wellbeing streak calculation."""

    def test_empty_entries(self):
        from routes.wellbeing import _calculate_streak
        assert _calculate_streak([]) == 0

    def test_single_entry(self):
        from routes.wellbeing import _calculate_streak
        entries = [{"created_at": "2026-02-10T10:00:00"}]
        assert _calculate_streak(entries) == 1

    def test_consecutive_days(self):
        from routes.wellbeing import _calculate_streak
        entries = [
            {"created_at": "2026-02-12T10:00:00"},
            {"created_at": "2026-02-11T10:00:00"},
            {"created_at": "2026-02-10T10:00:00"},
        ]
        assert _calculate_streak(entries) == 3

    def test_gap_breaks_streak(self):
        from routes.wellbeing import _calculate_streak
        entries = [
            {"created_at": "2026-02-12T10:00:00"},
            {"created_at": "2026-02-10T10:00:00"},  # gap on 11th
        ]
        assert _calculate_streak(entries) == 1

    def test_same_day_entries(self):
        from routes.wellbeing import _calculate_streak
        entries = [
            {"created_at": "2026-02-12T15:00:00"},
            {"created_at": "2026-02-12T10:00:00"},
            {"created_at": "2026-02-11T10:00:00"},
        ]
        assert _calculate_streak(entries) == 2
