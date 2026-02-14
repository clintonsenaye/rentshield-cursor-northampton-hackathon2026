"""
Unit tests for maintenance deadline calculations.

Tests Awaab's Law timeframe enforcement.
"""

from datetime import datetime, timezone, timedelta
from routes.maintenance import _calculate_deadline, MAINTENANCE_CATEGORIES


class TestDeadlineCalculation:
    """Tests for Awaab's Law deadline calculations."""

    def test_emergency_24_hours(self):
        now = "2026-02-13T10:00:00+00:00"
        deadline = _calculate_deadline("emergency", now)
        expected = datetime.fromisoformat(now) + timedelta(hours=24)
        assert datetime.fromisoformat(deadline) == expected

    def test_damp_mould_14_days(self):
        now = "2026-02-13T10:00:00+00:00"
        deadline = _calculate_deadline("damp_mould", now)
        expected = datetime.fromisoformat(now) + timedelta(days=14)
        assert datetime.fromisoformat(deadline) == expected

    def test_structural_28_days(self):
        now = "2026-02-13T10:00:00+00:00"
        deadline = _calculate_deadline("structural", now)
        expected = datetime.fromisoformat(now) + timedelta(days=28)
        assert datetime.fromisoformat(deadline) == expected

    def test_unknown_category_defaults_to_other(self):
        now = "2026-02-13T10:00:00+00:00"
        deadline = _calculate_deadline("nonexistent_category", now)
        expected = datetime.fromisoformat(now) + timedelta(days=28)
        assert datetime.fromisoformat(deadline) == expected

    def test_all_categories_have_deadlines(self):
        """Every maintenance category must have a deadline defined."""
        now = "2026-02-13T10:00:00+00:00"
        for cat_key in MAINTENANCE_CATEGORIES:
            deadline = _calculate_deadline(cat_key, now)
            deadline_dt = datetime.fromisoformat(deadline)
            assert deadline_dt > datetime.fromisoformat(now)

    def test_plumbing_14_days(self):
        now = "2026-03-01T09:00:00+00:00"
        deadline = _calculate_deadline("plumbing", now)
        expected = datetime.fromisoformat(now) + timedelta(days=14)
        assert datetime.fromisoformat(deadline) == expected

    def test_categories_have_required_fields(self):
        """Each category must have name, description, and urgency."""
        for key, cat in MAINTENANCE_CATEGORIES.items():
            assert "name" in cat, f"{key} missing 'name'"
            assert "description" in cat, f"{key} missing 'description'"
            assert "urgency" in cat, f"{key} missing 'urgency'"
            assert "deadline_hours" in cat or "deadline_days" in cat, \
                f"{key} missing deadline"
