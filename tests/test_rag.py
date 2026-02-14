"""
Unit tests for RAG (Retrieval Augmented Generation) utilities.

Tests context building, source extraction, and confidence scoring.
"""

import pytest
from unittest.mock import patch, MagicMock
from utils.rag import get_legal_context, get_legal_context_with_sources


class TestGetLegalContext:
    """Tests for the basic get_legal_context function."""

    def test_returns_fallback_when_collection_none(self):
        with patch("utils.rag.get_legal_knowledge_collection", return_value=None):
            result = get_legal_context("test query")
            assert "database is unavailable" in result.lower()

    def test_returns_fallback_when_no_docs_found(self):
        mock_col = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = []
        mock_col.find.return_value = mock_cursor

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            result = get_legal_context("obscure query xyz")
            assert "no specific legal provisions found" in result.lower()

    def test_formats_document_correctly(self):
        mock_col = MagicMock()
        mock_cursor = MagicMock()
        docs = [{
            "title": "Test Doc",
            "content": "Test content about housing law.",
            "urgency": "high",
            "actions_tenant": ["Call Shelter", "File complaint"],
            "sources": [{"title": "Housing Act", "url": "https://example.com"}],
            "confidence": "high",
            "last_verified": "2026-01-15",
        }]
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = docs
        mock_col.find.return_value = mock_cursor

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            result = get_legal_context("test query", "tenant", limit=4)
            assert "Test Doc" in result
            assert "Test content" in result
            assert "Call Shelter" in result
            assert "Housing Act" in result

    def test_landlord_actions_used_for_landlord(self):
        mock_col = MagicMock()
        mock_cursor = MagicMock()
        docs = [{
            "title": "Test",
            "content": "Content",
            "urgency": "medium",
            "actions_tenant": ["Tenant action"],
            "actions_landlord": ["Landlord action"],
            "sources": [],
            "confidence": "medium",
            "last_verified": "2026-01-01",
        }]
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = docs
        mock_col.find.return_value = mock_cursor

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            result = get_legal_context("test", "landlord", limit=4)
            assert "Landlord action" in result

    def test_handles_db_error_gracefully(self):
        mock_col = MagicMock()
        mock_col.find.side_effect = Exception("DB connection lost")

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            result = get_legal_context("test")
            assert "database error" in result.lower()


class TestGetLegalContextWithSources:
    """Tests for the enhanced RAG function with sources and confidence."""

    def test_returns_low_confidence_when_collection_none(self):
        with patch("utils.rag.get_legal_knowledge_collection", return_value=None):
            context, sources, confidence = get_legal_context_with_sources("test")
            assert confidence == "low"
            assert sources == []

    def test_returns_low_confidence_when_no_docs(self):
        mock_col = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = []
        mock_col.find.return_value = mock_cursor

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            context, sources, confidence = get_legal_context_with_sources("xyz")
            assert confidence == "low"
            assert sources == []

    def test_extracts_unique_sources(self):
        mock_col = MagicMock()
        mock_cursor = MagicMock()
        docs = [
            {
                "title": "Doc A", "content": "Content A", "urgency": "high",
                "actions_tenant": [],
                "sources": [
                    {"title": "Act 1", "url": "https://example.com/act1"},
                    {"title": "Act 2", "url": "https://example.com/act2"},
                ],
                "confidence": "high", "last_verified": "2026-01-15",
            },
            {
                "title": "Doc B", "content": "Content B", "urgency": "medium",
                "actions_tenant": [],
                "sources": [
                    {"title": "Act 1", "url": "https://example.com/act1"},
                ],
                "confidence": "medium", "last_verified": "2026-01-10",
            },
        ]
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = docs
        mock_col.find.return_value = mock_cursor

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            context, sources, confidence = get_legal_context_with_sources("test", limit=4)
            assert len(sources) == 2
            urls = {s["url"] for s in sources}
            assert "https://example.com/act1" in urls
            assert "https://example.com/act2" in urls

    def test_confidence_uses_highest_level(self):
        mock_col = MagicMock()
        mock_cursor = MagicMock()
        docs = [
            {"title": "A", "content": "", "urgency": "low", "actions_tenant": [],
             "sources": [], "confidence": "low", "last_verified": "2026-01-01"},
            {"title": "B", "content": "", "urgency": "medium", "actions_tenant": [],
             "sources": [], "confidence": "high", "last_verified": "2026-01-01"},
        ]
        mock_cursor.sort.return_value = mock_cursor
        mock_cursor.limit.return_value = docs
        mock_col.find.return_value = mock_cursor

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            _, _, confidence = get_legal_context_with_sources("test", limit=4)
            assert confidence == "high"

    def test_handles_db_error_gracefully(self):
        mock_col = MagicMock()
        mock_col.find.side_effect = Exception("Connection timeout")

        with patch("utils.rag.get_legal_knowledge_collection", return_value=mock_col):
            context, sources, confidence = get_legal_context_with_sources("test")
            assert confidence == "low"
            assert sources == []
            assert "database error" in context.lower()
