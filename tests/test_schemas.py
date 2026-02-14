"""
Unit tests for Pydantic schema validation.

Tests input validation, default values, and constraint enforcement.
"""

import pytest
from pydantic import ValidationError
from models.schemas import (
    ChatRequest, ChatResponse, SourceCitation,
    NoticeRequest, TTSRequest,
    WellbeingEntryRequest, ComplianceUpdateRequest,
)


class TestChatRequest:
    """Tests for ChatRequest validation."""

    def test_valid_minimal(self):
        req = ChatRequest(message="Hello")
        assert req.message == "Hello"
        assert req.user_type == "tenant"
        assert req.language == "en"
        assert req.session_id is None

    def test_valid_full(self):
        req = ChatRequest(
            message="My landlord changed the locks",
            session_id="abc-123",
            user_type="landlord",
            language="pl",
        )
        assert req.user_type == "landlord"
        assert req.language == "pl"

    def test_empty_message_rejected(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="")

    def test_invalid_user_type_rejected(self):
        with pytest.raises(ValidationError):
            ChatRequest(message="test", user_type="hacker")

    def test_message_max_length(self):
        """Messages over 5000 chars should be rejected."""
        with pytest.raises(ValidationError):
            ChatRequest(message="x" * 5001)


class TestChatResponse:
    """Tests for ChatResponse schema."""

    def test_default_disclaimer(self):
        resp = ChatResponse(
            response="Test",
            session_id="s1",
            urgency="low",
            detected_issue="general",
        )
        assert "not a substitute" in resp.disclaimer.lower()
        assert resp.confidence == "medium"
        assert resp.sources == []

    def test_with_sources(self):
        resp = ChatResponse(
            response="Test",
            session_id="s1",
            urgency="high",
            detected_issue="eviction",
            sources=[SourceCitation(title="Act", url="https://example.com")],
            confidence="high",
        )
        assert len(resp.sources) == 1
        assert resp.sources[0].title == "Act"


class TestSourceCitation:
    """Tests for SourceCitation model."""

    def test_valid(self):
        src = SourceCitation(title="Housing Act", url="https://legislation.gov.uk")
        assert src.title == "Housing Act"

    def test_missing_title(self):
        with pytest.raises(ValidationError):
            SourceCitation(url="https://example.com")

    def test_missing_url(self):
        with pytest.raises(ValidationError):
            SourceCitation(title="Test")


class TestNoticeRequest:
    """Tests for NoticeRequest validation."""

    def test_valid(self):
        req = NoticeRequest(notice_text="You must vacate by March 1st")
        assert req.notice_text == "You must vacate by March 1st"

    def test_empty_rejected(self):
        with pytest.raises(ValidationError):
            NoticeRequest(notice_text="")

    def test_max_length(self):
        with pytest.raises(ValidationError):
            NoticeRequest(notice_text="x" * 10001)


class TestWellbeingEntry:
    """Tests for WellbeingEntryRequest validation."""

    def test_valid_minimal(self):
        req = WellbeingEntryRequest(mood=3)
        assert req.mood == 3

    def test_mood_range_low(self):
        with pytest.raises(ValidationError):
            WellbeingEntryRequest(mood=0)

    def test_mood_range_high(self):
        with pytest.raises(ValidationError):
            WellbeingEntryRequest(mood=6)

    def test_valid_full(self):
        req = WellbeingEntryRequest(
            mood=4,
            journal_text="Feeling better today",
            housing_situation="Repairs finally done",
            session_id="s1",
        )
        assert req.journal_text == "Feeling better today"


class TestComplianceUpdate:
    """Tests for ComplianceUpdateRequest validation."""

    def test_valid_statuses(self):
        for status in ["compliant", "due_soon", "overdue", "not_started"]:
            req = ComplianceUpdateRequest(status=status)
            assert req.status == status

    def test_invalid_status_rejected(self):
        with pytest.raises(ValidationError):
            ComplianceUpdateRequest(status="invalid")
