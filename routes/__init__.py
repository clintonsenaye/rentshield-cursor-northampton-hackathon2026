"""
API routes for RentShield.

Contains all FastAPI route handlers organized by functionality.
"""

from . import (
    agreement, analytics, chat, deposit, evidence, letters, maintenance,
    notice, perks, rewards, tasks, timeline, tts, users, wellbeing,
)

__all__ = [
    "chat", "notice", "tts", "analytics", "wellbeing", "rewards",
    "users", "tasks", "perks", "evidence", "timeline", "letters",
    "agreement", "deposit", "maintenance",
]
