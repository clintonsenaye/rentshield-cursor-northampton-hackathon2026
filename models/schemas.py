"""
Pydantic schemas for API request/response validation.

These models define the structure and validation rules for all API endpoints.
"""

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """
    Request model for the chat endpoint.
    """
    message: str = Field(
        ...,
        min_length=1,
        max_length=5000,
        description="User's question or situation description"
    )
    session_id: Optional[str] = Field(
        None,
        max_length=100,
        description="Session identifier for conversation continuity"
    )
    user_type: Literal["tenant", "landlord"] = Field(
        default="tenant",
        description="Type of user: 'tenant' or 'landlord'"
    )
    language: Optional[str] = Field(
        default="en",
        max_length=5,
        description="Language code for AI responses (en, pl, ro, bn, ur, ar)"
    )


class SourceCitation(BaseModel):
    """A single source citation linking to legislation."""
    title: str = Field(..., description="Name of the legislation or source")
    url: str = Field(..., description="URL to legislation.gov.uk or official source")


class ChatResponse(BaseModel):
    """
    Response model for the chat endpoint.
    """
    response: str = Field(..., description="AI-generated legal guidance")
    session_id: str = Field(..., description="Session identifier")
    urgency: Literal["critical", "high", "medium", "low"] = Field(
        ...,
        description="Urgency level of the issue"
    )
    detected_issue: str = Field(..., description="Type of issue detected")
    audio_url: Optional[str] = Field(
        None,
        description="URL for text-to-speech audio (if generated)"
    )
    sources: List[SourceCitation] = Field(
        default_factory=list,
        description="Legislation sources used to generate this response"
    )
    confidence: Literal["high", "medium", "low"] = Field(
        default="medium",
        description="Confidence level based on knowledge base match quality"
    )
    disclaimer: str = Field(
        default="This is general legal information based on UK housing law. It is not a substitute for professional legal advice. Verify current provisions at legislation.gov.uk.",
        description="Legal disclaimer"
    )


class NoticeRequest(BaseModel):
    """
    Request model for the notice checker endpoint.
    """
    notice_text: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="Text content of the landlord's notice"
    )
    session_id: Optional[str] = Field(
        None,
        max_length=100,
        description="Session identifier"
    )
    language: Optional[str] = Field(
        default="en",
        max_length=5,
        description="Language code for AI responses"
    )


class TTSRequest(BaseModel):
    """
    Request model for the text-to-speech endpoint.
    """
    text: str = Field(
        ...,
        min_length=1,
        max_length=5000,
        description="Text to convert to speech"
    )


# === WELLBEING JOURNAL MODELS ===


class WellbeingEntryRequest(BaseModel):
    """
    Request model for creating a wellbeing journal entry.
    """
    session_id: Optional[str] = Field(None, max_length=100, description="User session identifier")
    mood: int = Field(..., ge=1, le=5, description="Mood rating: 1=very low, 5=great")
    journal_text: Optional[str] = Field(None, max_length=5000, description="Free-text journal entry")
    housing_situation: Optional[str] = Field(
        None,
        max_length=2000,
        description="Brief description of current housing situation"
    )


class WellbeingEntryResponse(BaseModel):
    """
    Response model for a wellbeing journal entry.
    """
    entry_id: str = Field(..., description="Unique entry identifier")
    session_id: str = Field(..., description="Session identifier")
    ai_prompt: str = Field(..., description="AI-generated journaling prompt")
    ai_reflection: str = Field(..., description="AI supportive reflection")
    mood: int = Field(..., description="Mood rating submitted")
    points_earned: int = Field(..., description="Points earned for this entry")


class WellbeingHistoryResponse(BaseModel):
    """Response model for wellbeing history."""
    entries: List[dict] = Field(default_factory=list, description="List of journal entries")
    average_mood: float = Field(default=0.0, description="Average mood across entries")
    total_entries: int = Field(default=0, description="Total number of entries")
    streak_days: int = Field(default=0, description="Current journaling streak in days")


# === REWARDS / INCENTIVE MODELS ===


class RewardsProfileResponse(BaseModel):
    """
    Response for the user's rewards profile.
    """
    session_id: str = Field(..., description="Session identifier")
    total_points: int = Field(default=0, description="Total accumulated points")
    level: str = Field(default="Newcomer", description="Current level name")
    badges: List[dict] = Field(default_factory=list, description="Earned badges")
    vouchers: List[dict] = Field(default_factory=list, description="Generated vouchers")
    actions_completed: int = Field(default=0, description="Count of completed actions")


class RewardActionRequest(BaseModel):
    """
    Request model for logging a reward-earning action.
    """
    session_id: Optional[str] = Field(None, max_length=100, description="Session identifier")
    action_type: Literal[
        "journal_entry", "rights_learned", "issue_reported", "notice_checked", "community_tip"
    ] = Field(
        ...,
        description="Type of action completed"
    )
    details: Optional[str] = Field(None, max_length=1000, description="Additional details")


# === COMPLIANCE MODELS ===


class ComplianceUpdateRequest(BaseModel):
    """Request model for updating a compliance item status."""
    status: Literal["compliant", "due_soon", "overdue", "not_started"] = Field(
        ..., description="Current compliance status"
    )
    completed_date: Optional[str] = Field(
        None, max_length=20, description="Date the requirement was last completed (YYYY-MM-DD)"
    )
    expiry_date: Optional[str] = Field(
        None, max_length=20, description="Date the certification expires (YYYY-MM-DD)"
    )
    notes: Optional[str] = Field(
        None, max_length=2000, description="Additional notes about compliance"
    )


# === KNOWLEDGE BASE MODELS ===


class KnowledgeHelpfulRequest(BaseModel):
    """Request model for marking a knowledge article as helpful."""
    session_id: Optional[str] = Field(None, max_length=100, description="Session identifier")


# === EVIDENCE GUIDE MODELS ===


class EvidenceGuideRequest(BaseModel):
    """Request model for getting AI evidence collection guidance."""
    issue_type: str = Field(
        ..., min_length=1, max_length=100,
        description="Type of issue (e.g., mould_damp, lock_change, disrepair)"
    )
