"""
Emergency Panic Button — one-tap crisis response with evidence capture.

Provides a quick-access emergency button that:
1. Captures a timestamped record of the emergency
2. Provides immediate legal guidance
3. Lists emergency contacts
4. Creates an evidence trail entry
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/emergency", tags=["emergency"])


# ---------------------------------------------------------------------------
# Emergency types and guidance
# ---------------------------------------------------------------------------

EMERGENCY_TYPES = {
    "illegal_eviction": {
        "label": "Illegal Eviction / Lockout",
        "urgency": "critical",
        "immediate_steps": [
            "Do NOT leave the property if you are still inside",
            "Call the police on 999 if you feel physically threatened, or 101 for non-emergency",
            "Call Shelter's emergency helpline: 0808 800 4444",
            "Contact your local council's tenancy relations officer (available 24/7 in many areas)",
            "Take photos/video of locks, any notices, or damage",
            "Note the exact time and any witnesses",
        ],
        "legal_position": (
            "Changing locks or forcing a tenant out without a court order is a criminal offence "
            "under the Protection from Eviction Act 1977, Section 1. Your landlord can face "
            "prosecution and you may be entitled to compensation. You have the right to remain "
            "in your home until a court grants a possession order."
        ),
        "contacts": [
            {"name": "Police", "number": "999 (emergency) / 101 (non-emergency)", "note": "Report the criminal offence"},
            {"name": "Shelter Emergency Line", "number": "0808 800 4444", "note": "Free legal advice"},
            {"name": "Local Council", "number": "Find at gov.uk/find-local-council", "note": "Tenancy relations officer"},
            {"name": "Citizens Advice", "number": "0800 144 8848", "note": "Free general advice"},
        ],
    },
    "threats_harassment": {
        "label": "Threats or Harassment",
        "urgency": "critical",
        "immediate_steps": [
            "If in immediate danger, call 999",
            "Move to a safe location if needed",
            "Record evidence: save messages, take screenshots, note dates and times",
            "Do not engage or retaliate",
            "Report to police on 101 for non-emergency harassment",
            "Contact Shelter: 0808 800 4444",
        ],
        "legal_position": (
            "Harassment by a landlord is a criminal offence under the Protection from Eviction Act 1977, "
            "Section 1(3A). This includes threats, intimidation, cutting off utilities, or any acts "
            "designed to force you to leave. You can report this to the police and your local council."
        ),
        "contacts": [
            {"name": "Police", "number": "999 (emergency) / 101 (non-emergency)", "note": "Report harassment"},
            {"name": "Shelter Emergency Line", "number": "0808 800 4444", "note": "Free legal advice"},
            {"name": "National Domestic Abuse Helpline", "number": "0808 2000 247", "note": "24/7 support"},
        ],
    },
    "utilities_cut": {
        "label": "Utilities Cut Off",
        "urgency": "critical",
        "immediate_steps": [
            "Check if it's a general power cut (check neighbours)",
            "If landlord deliberately cut utilities, this is illegal — document it",
            "Take photos/video showing the issue",
            "Contact your local council's Environmental Health team",
            "Report to Shelter: 0808 800 4444",
            "If you have vulnerable household members, contact your energy supplier's priority services",
        ],
        "legal_position": (
            "Deliberately cutting off gas, electricity, or water to force a tenant out is an offence "
            "under the Protection from Eviction Act 1977. The landlord can be prosecuted. Contact your "
            "local council who can take emergency action and potentially restore services."
        ),
        "contacts": [
            {"name": "Local Council Environmental Health", "number": "Find at gov.uk/find-local-council", "note": "Emergency enforcement"},
            {"name": "Shelter Emergency Line", "number": "0808 800 4444", "note": "Free legal advice"},
            {"name": "National Gas Emergency", "number": "0800 111 999", "note": "If gas supply issue"},
        ],
    },
    "unsafe_conditions": {
        "label": "Unsafe Living Conditions",
        "urgency": "high",
        "immediate_steps": [
            "If in immediate danger (e.g., structural collapse, gas leak), evacuate and call 999",
            "For gas leaks: call National Gas Emergency on 0800 111 999",
            "Document the hazard with photos and written descriptions",
            "Report to your local council's Environmental Health team",
            "Send written notice to your landlord (email or letter) describing the issue",
            "Keep copies of all correspondence",
        ],
        "legal_position": (
            "Under the Homes (Fitness for Human Habitation) Act 2018, landlords must ensure properties "
            "are fit for habitation. Category 1 hazards under the Housing Health and Safety Rating System "
            "(HHSRS) require the council to take enforcement action. You may also be able to claim "
            "compensation through the courts."
        ),
        "contacts": [
            {"name": "Local Council Environmental Health", "number": "Find at gov.uk/find-local-council", "note": "HHSRS inspection"},
            {"name": "Shelter", "number": "0808 800 4444", "note": "Free legal advice"},
            {"name": "National Gas Emergency", "number": "0800 111 999", "note": "Gas emergencies only"},
        ],
    },
    "discrimination": {
        "label": "Discrimination",
        "urgency": "high",
        "immediate_steps": [
            "Document everything: save messages, emails, and notes of verbal conversations",
            "Note the exact words used and the context",
            "Contact the Equality Advisory Support Service (EASS)",
            "Consider reporting to Shelter for legal advice",
            "Keep a timeline of events",
        ],
        "legal_position": (
            "Discrimination in housing is unlawful under the Equality Act 2010. Protected characteristics "
            "include race, disability, sex, gender reassignment, pregnancy, religion, sexual orientation, "
            "and age. This covers letting, management, and eviction. You can take legal action through "
            "the county court within 6 months."
        ),
        "contacts": [
            {"name": "EASS", "number": "0808 800 0082", "note": "Equality Advisory Support"},
            {"name": "Shelter", "number": "0808 800 4444", "note": "Housing discrimination advice"},
            {"name": "Citizens Advice", "number": "0800 144 8848", "note": "Free legal guidance"},
        ],
    },
}


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class PanicRequest(BaseModel):
    """Trigger the panic button."""
    emergency_type: str = Field(..., min_length=1, max_length=50, description="Type of emergency")
    description: Optional[str] = Field(None, max_length=5000, description="Brief description of what's happening")
    location: Optional[str] = Field(None, max_length=300, description="Current location or property address")


class EmergencyContact(BaseModel):
    name: str
    number: str
    note: str


class PanicResponse(BaseModel):
    """Emergency response with guidance and evidence record."""
    emergency_id: str
    emergency_type: str
    label: str
    urgency: str
    immediate_steps: List[str]
    legal_position: str
    contacts: List[EmergencyContact]
    evidence_id: str
    timestamp: str
    message: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/types")
def get_emergency_types(authorization: str = Header("")) -> List[Dict[str, str]]:
    """Return available emergency types."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return [
        {"key": k, "label": v["label"], "urgency": v["urgency"]}
        for k, v in EMERGENCY_TYPES.items()
    ]


@router.post("/activate", response_model=PanicResponse)
def activate_panic_button(
    request: PanicRequest,
    authorization: str = Header(""),
) -> PanicResponse:
    """Activate the emergency panic button."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    emergency_info = EMERGENCY_TYPES.get(request.emergency_type)
    if not emergency_info:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown emergency type. Available: {', '.join(EMERGENCY_TYPES.keys())}",
        )

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    emergency_id = str(uuid.uuid4())
    evidence_id = str(uuid.uuid4())

    # Create an evidence trail entry automatically
    evidence_doc = {
        "evidence_id": evidence_id,
        "user_id": user["user_id"],
        "evidence_type": "emergency_report",
        "title": f"Emergency: {emergency_info['label']}",
        "description": request.description or f"Emergency panic button activated: {emergency_info['label']}",
        "location": request.location,
        "created_at": now_iso,
        "metadata": {
            "emergency_type": request.emergency_type,
            "emergency_id": emergency_id,
            "auto_generated": True,
        },
    }
    db["evidence"].insert_one(evidence_doc)

    # Create a timeline entry
    db["timeline"].insert_one({
        "event_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "event_type": "emergency",
        "title": f"Emergency reported: {emergency_info['label']}",
        "description": request.description or "Panic button activated",
        "date": now_iso,
        "urgency": emergency_info["urgency"],
        "created_at": now_iso,
    })

    # Create a notification for the landlord (if applicable)
    landlord_id = user.get("landlord_id")
    if landlord_id:
        db["notifications"].insert_one({
            "notification_id": str(uuid.uuid4()),
            "recipient_id": landlord_id,
            "message": f"URGENT: Tenant {user.get('name', 'Unknown')} has reported an emergency — {emergency_info['label']}",
            "type": "emergency",
            "read": False,
            "created_at": now_iso,
        })

    # Save the emergency record
    db["emergencies"].insert_one({
        "emergency_id": emergency_id,
        "user_id": user["user_id"],
        "emergency_type": request.emergency_type,
        "description": request.description,
        "location": request.location,
        "evidence_id": evidence_id,
        "created_at": now_iso,
    })

    return PanicResponse(
        emergency_id=emergency_id,
        emergency_type=request.emergency_type,
        label=emergency_info["label"],
        urgency=emergency_info["urgency"],
        immediate_steps=emergency_info["immediate_steps"],
        legal_position=emergency_info["legal_position"],
        contacts=[EmergencyContact(**c) for c in emergency_info["contacts"]],
        evidence_id=evidence_id,
        timestamp=now_iso,
        message="Emergency recorded. An evidence trail entry has been created automatically. Follow the steps above.",
    )


@router.get("/history")
def get_emergency_history(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """Get past emergency reports."""
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    emergencies = list(
        db["emergencies"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )

    return emergencies
