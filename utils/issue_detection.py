"""
Issue detection and urgency classification.

Analyzes user messages to categorize the type of housing issue and determine urgency level.
Uses word-boundary-aware matching to prevent false positives.
"""

import re
from typing import List, Tuple


# Constants for issue types
ISSUE_ILLEGAL_EVICTION = "illegal_eviction"
ISSUE_EVICTION = "eviction"
ISSUE_RENT_INCREASE = "rent_increase"
ISSUE_DEPOSIT = "deposit"
ISSUE_REPAIRS = "repairs"
ISSUE_DISCRIMINATION = "discrimination"
ISSUE_PETS = "pets"
ISSUE_TENANCY_RIGHTS = "tenancy_rights"
ISSUE_GENERAL = "general"

# Constants for urgency levels
URGENCY_CRITICAL = "critical"
URGENCY_HIGH = "high"
URGENCY_MEDIUM = "medium"
URGENCY_LOW = "low"

# Keyword groups for issue detection
# CRITICAL: illegal eviction scenarios (criminal offences)
# Only include phrases that unambiguously indicate illegal eviction or harassment.
# Generic terms like "threatening" or "no heating" are too broad and cause false positives.
CRITICAL_KEYWORDS = [
    "locked out",
    "changed locks",
    "changed the locks",
    "changed my locks",
    "locks changed",
    "lock changed",
    "kicked out",
    "kicked me out",
    "thrown out",
    "threw me out",
    "belongings removed",
    "belongings outside",
    "stuff outside",
    "cut off electricity",
    "cut off the gas",
    "cut off the water",
    "landlord cut off",
    "forced out",
    "illegal eviction",
    "broke into",
    "entered without permission",
    "landlord threatening",
    "landlord harassing",
    "landlord intimidating",
]

# HIGH: eviction-related issues
HIGH_KEYWORDS = [
    "eviction",
    "evict",
    "notice to quit",
    "section 21",
    "section 8",
    "court",
    "bailiff",
    "possession order",
    "two weeks",
    "must leave",
    "have to go",
]

# MEDIUM: rent increase issues
RENT_KEYWORDS = [
    "rent increase",
    "rent increased",
    "rent being increased",
    "rent going up",
    "rent went up",
    "higher rent",
    "raising rent",
    "raise the rent",
    "can't afford rent",
    "cant afford rent",
    "can't afford",
    "cant afford",
    "section 13",
]

# MEDIUM: deposit issues (use word boundary to prevent "deposited" matching)
DEPOSIT_KEYWORDS = [
    "deposit",
    "money back",
    "deductions",
    "not returning",
]

# MEDIUM: repair issues
REPAIRS_KEYWORDS = [
    "repair",
    "repairs",
    "mould",
    "mold",
    "damp",
    "broken boiler",
    "broken heating",
    "no heating",
    "boiler broken",
    "boiler not working",
    "leak",
    "leaking",
    "disrepair",
]

# MEDIUM: discrimination issues
# Use specific phrases to avoid false positives — "benefits" and "children" alone are too broad.
DISCRIMINATION_KEYWORDS = [
    "discrimination",
    "no dss",
    "no benefits",
    "universal credit refused",
    "housing benefit refused",
    "won't rent to me because",
    "refused because",
    "rejected because",
    "no children allowed",
    "no kids allowed",
]

# LOW: pet-related issues
PETS_KEYWORDS = [
    "pet",
    "pets",
    "dog",
    "cat",
    "animal",
]

# LOW: general tenancy rights
TENANCY_KEYWORDS = [
    "tenancy",
    "contract",
    "notice period",
    "move out",
    "moving out",
]


def _build_pattern(keywords: List[str]) -> re.Pattern:
    """
    Build a compiled regex pattern that matches any keyword with word boundaries.
    This prevents partial word matches (e.g. 'deposit' won't match 'deposited').
    Multi-word phrases are matched as-is; single words use word boundaries.
    """
    escaped = []
    for kw in keywords:
        # Multi-word phrases: match as-is within text (already specific enough)
        if " " in kw:
            escaped.append(re.escape(kw))
        else:
            # Single words: use word boundaries to avoid partial matches
            escaped.append(r"\b" + re.escape(kw) + r"\b")
    pattern = "|".join(escaped)
    return re.compile(pattern, re.IGNORECASE)


# Pre-compiled patterns for performance
_CRITICAL_PATTERN = _build_pattern(CRITICAL_KEYWORDS)
_HIGH_PATTERN = _build_pattern(HIGH_KEYWORDS)
_RENT_PATTERN = _build_pattern(RENT_KEYWORDS)
_DEPOSIT_PATTERN = _build_pattern(DEPOSIT_KEYWORDS)
_REPAIRS_PATTERN = _build_pattern(REPAIRS_KEYWORDS)
_DISCRIMINATION_PATTERN = _build_pattern(DISCRIMINATION_KEYWORDS)
_PETS_PATTERN = _build_pattern(PETS_KEYWORDS)
_TENANCY_PATTERN = _build_pattern(TENANCY_KEYWORDS)


def detect_issue_and_urgency(message: str) -> Tuple[str, str]:
    """
    Analyze a user message to detect the issue type and urgency level.

    Uses compiled regex patterns with word boundaries for accurate matching.
    Checks keywords in order of priority (critical -> high -> medium -> low).

    Args:
        message: User's message text

    Returns:
        Tuple[str, str]: (detected_issue, urgency_level)

    Example:
        >>> detect_issue_and_urgency("My landlord changed the locks")
        ('illegal_eviction', 'critical')

        >>> detect_issue_and_urgency("I received a Section 21 notice")
        ('eviction', 'high')
    """
    if not message or not isinstance(message, str):
        return ISSUE_GENERAL, URGENCY_LOW

    text = message.strip()
    if not text:
        return ISSUE_GENERAL, URGENCY_LOW

    # Check CRITICAL urgency first
    if _CRITICAL_PATTERN.search(text):
        return ISSUE_ILLEGAL_EVICTION, URGENCY_CRITICAL

    # Check HIGH urgency (eviction-related)
    if _HIGH_PATTERN.search(text):
        return ISSUE_EVICTION, URGENCY_HIGH

    # Check MEDIUM urgency by category
    if _RENT_PATTERN.search(text):
        return ISSUE_RENT_INCREASE, URGENCY_MEDIUM

    if _DEPOSIT_PATTERN.search(text):
        return ISSUE_DEPOSIT, URGENCY_MEDIUM

    if _REPAIRS_PATTERN.search(text):
        return ISSUE_REPAIRS, URGENCY_MEDIUM

    if _DISCRIMINATION_PATTERN.search(text):
        return ISSUE_DISCRIMINATION, URGENCY_MEDIUM

    # Check LOW urgency
    if _PETS_PATTERN.search(text):
        return ISSUE_PETS, URGENCY_LOW

    if _TENANCY_PATTERN.search(text):
        return ISSUE_TENANCY_RIGHTS, URGENCY_LOW

    # Default: general issue with low urgency
    return ISSUE_GENERAL, URGENCY_LOW
