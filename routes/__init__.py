"""
API routes for RentShield.

Contains all FastAPI route handlers organized by functionality.
"""

from . import (
    admin_analytics, agreement, analytics, case_export, chat, compliance,
    dashboard, deadline_tracker, deposit, dispute_assessor, document_vault,
    evidence, evidence_guide, gdpr, knowledge, letters, local_authority,
    maintenance, messaging, notice, notice_calculator, notifications,
    panic_button, perks, quiz, reminders, rent_comparator, reputation,
    rewards, scenario_simulator, tasks, timeline, tts, users, wellbeing,
)

__all__ = [
    "admin_analytics", "agreement", "analytics", "case_export", "chat",
    "compliance", "dashboard", "deadline_tracker", "deposit",
    "dispute_assessor", "document_vault", "evidence", "evidence_guide",
    "gdpr", "knowledge", "letters", "local_authority", "maintenance",
    "messaging", "notice", "notice_calculator", "notifications",
    "panic_button", "perks", "quiz", "reminders", "rent_comparator",
    "reputation", "rewards", "scenario_simulator", "tasks", "timeline",
    "tts", "users", "wellbeing",
]
