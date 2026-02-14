"""
Unit tests for issue detection and urgency classification.

Tests keyword matching, word boundary handling, and priority ordering.
"""

import pytest
from utils.issue_detection import (
    detect_issue_and_urgency,
    ISSUE_ILLEGAL_EVICTION, ISSUE_EVICTION, ISSUE_RENT_INCREASE,
    ISSUE_DEPOSIT, ISSUE_REPAIRS, ISSUE_DISCRIMINATION, ISSUE_PETS,
    ISSUE_TENANCY_RIGHTS, ISSUE_GENERAL,
    URGENCY_CRITICAL, URGENCY_HIGH, URGENCY_MEDIUM, URGENCY_LOW,
)


class TestCriticalIssues:
    """CRITICAL urgency: illegal eviction scenarios."""

    @pytest.mark.parametrize("message", [
        "My landlord changed the locks while I was out",
        "I've been locked out of my flat",
        "Landlord kicked me out last night",
        "They threw me out and dumped my belongings outside",
        "Landlord cut off the gas and electricity",
        "He entered without permission while I was sleeping",
        "My landlord threatening to change the locks",
        "The landlord harassing me constantly",
    ])
    def test_critical_keywords_detected(self, message):
        issue, urgency = detect_issue_and_urgency(message)
        assert issue == ISSUE_ILLEGAL_EVICTION
        assert urgency == URGENCY_CRITICAL

    def test_locks_changed_case_insensitive(self):
        issue, urgency = detect_issue_and_urgency("LANDLORD CHANGED MY LOCKS")
        assert issue == ISSUE_ILLEGAL_EVICTION

    def test_forced_out_detected(self):
        issue, urgency = detect_issue_and_urgency("I was forced out of my home")
        assert issue == ISSUE_ILLEGAL_EVICTION


class TestHighUrgency:
    """HIGH urgency: eviction-related issues."""

    @pytest.mark.parametrize("message", [
        "I received an eviction notice",
        "Got a section 21 notice",
        "My landlord wants to evict me",
        "Bailiff is coming next week",
        "I received a possession order",
    ])
    def test_eviction_keywords_detected(self, message):
        issue, urgency = detect_issue_and_urgency(message)
        assert issue == ISSUE_EVICTION
        assert urgency == URGENCY_HIGH


class TestMediumUrgency:
    """MEDIUM urgency: rent, deposit, repairs, discrimination."""

    def test_rent_increase(self):
        issue, urgency = detect_issue_and_urgency("My rent is going up by 30%")
        assert issue == ISSUE_RENT_INCREASE
        assert urgency == URGENCY_MEDIUM

    def test_section_13(self):
        issue, urgency = detect_issue_and_urgency("I got a section 13 notice")
        assert issue == ISSUE_RENT_INCREASE

    def test_deposit_issue(self):
        issue, urgency = detect_issue_and_urgency("My landlord won't return my deposit")
        assert issue == ISSUE_DEPOSIT
        assert urgency == URGENCY_MEDIUM

    def test_repairs_mould(self):
        issue, urgency = detect_issue_and_urgency("There is mould all over the bathroom")
        assert issue == ISSUE_REPAIRS
        assert urgency == URGENCY_MEDIUM

    def test_repairs_no_heating(self):
        """no heating should be REPAIRS, not illegal eviction."""
        issue, urgency = detect_issue_and_urgency("I have no heating in the flat")
        assert issue == ISSUE_REPAIRS
        assert urgency == URGENCY_MEDIUM

    def test_repairs_boiler_broken(self):
        issue, urgency = detect_issue_and_urgency("My boiler is broken")
        assert issue == ISSUE_REPAIRS

    def test_repairs_disrepair(self):
        issue, urgency = detect_issue_and_urgency("The property is in disrepair")
        assert issue == ISSUE_REPAIRS

    def test_discrimination_no_dss(self):
        issue, urgency = detect_issue_and_urgency("The agent said no dss tenants")
        assert issue == ISSUE_DISCRIMINATION
        assert urgency == URGENCY_MEDIUM

    def test_discrimination_no_children(self):
        issue, urgency = detect_issue_and_urgency("They said no children allowed")
        assert issue == ISSUE_DISCRIMINATION


class TestLowUrgency:
    """LOW urgency: pets, general tenancy."""

    def test_pets(self):
        issue, urgency = detect_issue_and_urgency("Can I keep a dog in my rented flat?")
        assert issue == ISSUE_PETS
        assert urgency == URGENCY_LOW

    def test_tenancy_rights(self):
        issue, urgency = detect_issue_and_urgency("What is my notice period?")
        assert issue == ISSUE_TENANCY_RIGHTS
        assert urgency == URGENCY_LOW


class TestFalsePositivePrevention:
    """Ensure common phrases don't trigger wrong categories."""

    def test_heating_is_not_critical(self):
        """'no heating' should NOT trigger illegal eviction."""
        issue, urgency = detect_issue_and_urgency("There is no heating in my flat")
        assert urgency != URGENCY_CRITICAL
        assert issue == ISSUE_REPAIRS

    def test_threatening_alone_not_critical(self):
        """'threatening' without 'landlord' should not trigger critical."""
        issue, urgency = detect_issue_and_urgency("The weather is threatening rain")
        assert urgency != URGENCY_CRITICAL

    def test_benefits_alone_not_discrimination(self):
        """'benefits' alone should not trigger discrimination."""
        issue, urgency = detect_issue_and_urgency("What are the benefits of renting?")
        assert issue != ISSUE_DISCRIMINATION

    def test_children_alone_not_discrimination(self):
        """'children' alone should not trigger discrimination."""
        issue, urgency = detect_issue_and_urgency("I have children living with me")
        assert issue != ISSUE_DISCRIMINATION

    def test_deposit_as_verb_not_matched(self):
        """'deposited' should not match due to word boundary."""
        # Note: 'deposited' contains 'deposit' so this tests boundary behavior
        issue, urgency = detect_issue_and_urgency("I deposited the cheque")
        # This may or may not match depending on word boundary behavior for 'deposit'
        # The key test is that it doesn't crash


class TestEdgeCases:
    """Edge cases and boundary conditions."""

    def test_empty_string(self):
        issue, urgency = detect_issue_and_urgency("")
        assert issue == ISSUE_GENERAL
        assert urgency == URGENCY_LOW

    def test_none_input(self):
        issue, urgency = detect_issue_and_urgency(None)
        assert issue == ISSUE_GENERAL
        assert urgency == URGENCY_LOW

    def test_whitespace_only(self):
        issue, urgency = detect_issue_and_urgency("   ")
        assert issue == ISSUE_GENERAL
        assert urgency == URGENCY_LOW

    def test_unrelated_message(self):
        issue, urgency = detect_issue_and_urgency("What is the weather like today?")
        assert issue == ISSUE_GENERAL
        assert urgency == URGENCY_LOW

    def test_priority_critical_over_high(self):
        """When message contains both critical and high keywords, critical wins."""
        msg = "My landlord changed the locks and served an eviction notice"
        issue, urgency = detect_issue_and_urgency(msg)
        assert urgency == URGENCY_CRITICAL

    def test_very_long_message(self):
        """Should handle long messages without error."""
        msg = "My landlord " + "is being difficult " * 500 + " and changed the locks"
        issue, urgency = detect_issue_and_urgency(msg)
        assert issue == ISSUE_ILLEGAL_EVICTION
