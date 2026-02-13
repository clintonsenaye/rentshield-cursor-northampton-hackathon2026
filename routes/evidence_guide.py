"""
Smart evidence capture routes.

Provides AI-powered guidance on what evidence to collect
for specific housing issues (mould, lock changes, disrepair, etc.).
"""

import logging
from typing import Any, Dict

from fastapi import APIRouter, Header, HTTPException

from models.schemas import EvidenceGuideRequest
from services.ai_service import get_ai_service
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/evidence", tags=["evidence-guide"])

# Pre-built guidance for common issue types (avoids AI call for known patterns)
EVIDENCE_GUIDES = {
    "mould_damp": {
        "title": "Mould & Damp Evidence",
        "guidance": [
            {"item": "Wide-angle photo showing the full extent of mould on each affected wall", "priority": "essential"},
            {"item": "Close-up photo of the worst areas of mould growth", "priority": "essential"},
            {"item": "Photo showing any visible water damage, staining, or peeling paint", "priority": "essential"},
            {"item": "Photo of any condensation on windows or walls", "priority": "recommended"},
            {"item": "Photo of ventilation (or lack thereof) — blocked vents, sealed windows", "priority": "recommended"},
            {"item": "Screenshot or photo of any written reports to your landlord about the issue", "priority": "essential"},
            {"item": "Photo of any health effects (skin rashes, respiratory aids) — if comfortable sharing", "priority": "optional"},
            {"item": "GP letter or medical report linking symptoms to living conditions", "priority": "recommended"},
        ],
        "tips": [
            "Include a ruler or coin in close-up photos for scale.",
            "Take photos in natural light where possible.",
            "Photograph the same areas over time to show deterioration.",
            "Note the date and room on each photo.",
            "Keep all written communications with your landlord about this issue.",
        ],
    },
    "lock_change": {
        "title": "Illegal Lock Change Evidence",
        "guidance": [
            {"item": "Photo of the new lock(s) on the door", "priority": "essential"},
            {"item": "Photo of your old key that no longer works", "priority": "essential"},
            {"item": "Screenshot of any messages from landlord about the lock change", "priority": "essential"},
            {"item": "Photo or video of you attempting to use your key (shows it doesn't work)", "priority": "recommended"},
            {"item": "Photo of any belongings visible through windows still inside the property", "priority": "recommended"},
            {"item": "Written statement from any witnesses (neighbours, friends)", "priority": "recommended"},
            {"item": "Photo of the property exterior showing the address clearly", "priority": "essential"},
        ],
        "tips": [
            "Call 101 (police non-emergency) immediately — this is a criminal offence.",
            "Do NOT force entry yourself.",
            "Contact your local council housing team urgently.",
            "Record the exact date and time you discovered the lock change.",
            "Get witness statements from anyone who saw the lock being changed.",
        ],
    },
    "property_damage": {
        "title": "Property Damage / Disrepair Evidence",
        "guidance": [
            {"item": "Wide-angle photos of each damaged area showing context", "priority": "essential"},
            {"item": "Close-up photos of specific damage (cracks, holes, broken fixtures)", "priority": "essential"},
            {"item": "Photos showing any safety hazards caused by the damage", "priority": "essential"},
            {"item": "Photo of any temporary repairs you've had to make", "priority": "recommended"},
            {"item": "Copies of all repair requests sent to your landlord", "priority": "essential"},
            {"item": "Receipts for any costs you've incurred due to the damage", "priority": "recommended"},
            {"item": "Video walkthrough showing the full extent of disrepair", "priority": "recommended"},
        ],
        "tips": [
            "Report all damage in writing (email or letter) to create a paper trail.",
            "Note when the damage first appeared and how it has worsened.",
            "Keep receipts for any expenses caused by the disrepair.",
            "If the damage is a hazard, contact Environmental Health at your council.",
        ],
    },
    "harassment": {
        "title": "Landlord Harassment Evidence",
        "guidance": [
            {"item": "Screenshots of threatening or harassing messages (texts, emails, WhatsApp)", "priority": "essential"},
            {"item": "Recording dates, times, and details of verbal harassment in a log", "priority": "essential"},
            {"item": "Written statements from witnesses to any incidents", "priority": "recommended"},
            {"item": "Photos of any damage caused during confrontations", "priority": "recommended"},
            {"item": "Screenshots showing repeated unannounced visits or entry attempts", "priority": "recommended"},
            {"item": "Audio/video recordings of threatening behaviour (where legal)", "priority": "optional"},
        ],
        "tips": [
            "Keep a detailed diary of every incident with date, time, and what happened.",
            "Save ALL communications — do not delete messages even if upsetting.",
            "In England, you can record conversations you are part of.",
            "Report serious harassment to the police (101 or 999 if in danger).",
            "Contact Shelter for specialist advice on landlord harassment.",
        ],
    },
    "rent_dispute": {
        "title": "Rent Dispute Evidence",
        "guidance": [
            {"item": "Copy of your tenancy agreement showing agreed rent amount", "priority": "essential"},
            {"item": "Bank statements showing all rent payments made", "priority": "essential"},
            {"item": "Screenshots of any Section 13 rent increase notice received", "priority": "essential"},
            {"item": "Evidence of comparable local rents (Rightmove, Zoopla listings)", "priority": "recommended"},
            {"item": "Copies of all communications about rent changes", "priority": "essential"},
            {"item": "Receipt or proof of deposit payment and protection", "priority": "recommended"},
        ],
        "tips": [
            "Always pay rent via traceable methods (bank transfer, not cash).",
            "A landlord can only increase rent once per year via Section 13.",
            "You can challenge above-market rent increases at the First-tier Tribunal.",
            "Keep copies of all rent receipts and payment confirmations.",
        ],
    },
}


@router.post("/guide")
async def get_evidence_guidance(
    request: EvidenceGuideRequest,
    authorization: str = Header(""),
) -> Dict[str, Any]:
    """
    Get AI-powered evidence collection guidance for a specific issue type.

    Returns a checklist of evidence items to collect and practical tips.
    Uses pre-built guides for common issues, falls back to AI for others.
    Requires tenant role.
    """
    user, error = require_role(authorization, ["tenant"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    issue_type = request.issue_type.lower().strip()

    # Check pre-built guides first (instant, no API cost)
    if issue_type in EVIDENCE_GUIDES:
        guide = EVIDENCE_GUIDES[issue_type]
        logger.info("AUDIT: Evidence guide served — user=%s, type=%s (pre-built)",
                     user["user_id"], issue_type)
        return {
            "title": guide["title"],
            "issue_type": issue_type,
            "guidance": guide["guidance"],
            "tips": guide["tips"],
            "source": "pre-built",
        }

    # For unknown issue types, generate guidance via AI
    try:
        ai_service = get_ai_service()
        if ai_service is None:
            raise HTTPException(status_code=503, detail="AI service unavailable.")

        prompt = (
            "You are helping a UK tenant collect evidence for a housing issue. "
            "The issue type is: " + issue_type.replace("_", " ") + ". "
            "Provide a JSON response with two arrays: "
            "'guidance' (array of objects with 'item' string describing what to photograph/collect "
            "and 'priority' as 'essential', 'recommended', or 'optional') "
            "and 'tips' (array of practical tip strings). "
            "Include 5-8 guidance items and 3-5 tips. Be specific to UK housing law."
        )

        response_text = await ai_service.chat_completion(prompt, "", "", "tenant")

        # Try to parse AI response as JSON
        import json
        try:
            # Find JSON in the response
            start = response_text.find("{")
            end = response_text.rfind("}") + 1
            if start >= 0 and end > start:
                ai_data = json.loads(response_text[start:end])
                guidance = ai_data.get("guidance", [])
                tips = ai_data.get("tips", [])
            else:
                guidance = [{"item": response_text, "priority": "essential"}]
                tips = []
        except json.JSONDecodeError:
            guidance = [{"item": response_text, "priority": "essential"}]
            tips = []

        logger.info("AUDIT: Evidence guide served — user=%s, type=%s (AI-generated)",
                     user["user_id"], issue_type)

        return {
            "title": issue_type.replace("_", " ").title() + " Evidence",
            "issue_type": issue_type,
            "guidance": guidance,
            "tips": tips,
            "source": "ai",
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to generate evidence guidance: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate evidence guidance.")
