"""
Wellbeing Journal endpoint routes.

Provides AI-guided mood tracking and journaling for tenants,
helping them document the emotional impact of housing issues.
"""

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from models.schemas import WellbeingEntryRequest, WellbeingEntryResponse, WellbeingHistoryResponse
from services.ai_service import get_ai_service
from database.connection import get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wellbeing", tags=["wellbeing"])
limiter = Limiter(key_func=get_remote_address)

# Points awarded for journaling
JOURNAL_ENTRY_POINTS = 15

# AI prompt for generating guided journaling prompts
WELLBEING_PROMPT_TEMPLATE = """
You are RentShield's Wellbeing Companion, a supportive and empathetic guide
for UK tenants dealing with housing stress.

The tenant has logged their mood as {mood}/5 ({mood_label}).
{situation_context}
{journal_context}

Generate TWO things:

1. GUIDED PROMPT: A thoughtful, specific journaling prompt (2-3 sentences) that
   helps them reflect on their housing situation and emotional wellbeing.
   - If mood is low (1-2): Be gentle, validating, and focus on small coping steps
   - If mood is medium (3): Encourage reflection on what's working and what needs attention
   - If mood is high (4-5): Celebrate progress and encourage documenting positive changes
   
   Make it specific to housing/tenancy situations, not generic self-help.

2. SUPPORTIVE REFLECTION: A brief (2-3 sentences) supportive response that:
   - Acknowledges their feelings without dismissing them
   - Connects their emotional state to their housing rights journey
   - Reminds them that documenting their experience is valuable (for wellbeing AND as evidence)
   - If mood is low, mention Shelter helpline: 0808 800 4444

Format your response EXACTLY like this:
PROMPT: [your guided journaling prompt here]
REFLECTION: [your supportive reflection here]
"""

MOOD_LABELS = {
    1: "very low",
    2: "low",
    3: "okay",
    4: "good",
    5: "great",
}


@router.post("", response_model=WellbeingEntryResponse)
@limiter.limit("5/minute")
async def create_wellbeing_entry(http_request: Request, request: WellbeingEntryRequest) -> WellbeingEntryResponse:
    """
    Create a new wellbeing journal entry with AI-guided prompts.
    
    Logs the tenant's mood, generates a personalised journaling prompt,
    and provides a supportive AI reflection. Awards reward points.
    """
    session_id = request.session_id or str(uuid.uuid4())
    entry_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    # Build context for AI prompt
    mood_label = MOOD_LABELS.get(request.mood, "unknown")
    
    situation_context = ""
    if request.housing_situation:
        situation_context = f"Their current housing situation: {request.housing_situation}"
    
    journal_context = ""
    if request.journal_text:
        journal_context = f"They wrote: \"{request.journal_text}\""
    
    # Generate AI-guided prompt and reflection
    ai_service = get_ai_service()
    
    prompt_text = WELLBEING_PROMPT_TEMPLATE.format(
        mood=request.mood,
        mood_label=mood_label,
        situation_context=situation_context,
        journal_context=journal_context,
    )
    
    try:
        ai_response = await ai_service.chat_completion(
            user_message=prompt_text,
            context="",
            history="",
            user_type="tenant",
        )
        
        # Parse the AI response into prompt and reflection
        ai_prompt, ai_reflection = _parse_wellbeing_response(ai_response)
        
    except Exception as exc:
        logger.error(f"Error generating wellbeing AI response: {exc}")
        ai_prompt = _get_fallback_prompt(request.mood)
        ai_reflection = "Thank you for checking in. Taking time to reflect on your wellbeing is a positive step."
    
    # Save entry to MongoDB
    db = get_database()
    if db is not None:
        try:
            wellbeing_col = db["wellbeing_journal"]
            wellbeing_col.insert_one({
                "entry_id": entry_id,
                "session_id": session_id,
                "mood": request.mood,
                "mood_label": mood_label,
                "journal_text": request.journal_text or "",
                "housing_situation": request.housing_situation or "",
                "ai_prompt": ai_prompt,
                "ai_reflection": ai_reflection,
                "points_earned": JOURNAL_ENTRY_POINTS,
                "created_at": now,
            })
            
            # Award points in rewards collection
            rewards_col = db["rewards"]
            rewards_col.update_one(
                {"session_id": session_id},
                {
                    "$inc": {
                        "total_points": JOURNAL_ENTRY_POINTS,
                        "actions_completed": 1,
                    },
                    "$push": {
                        "actions": {
                            "type": "journal_entry",
                            "points": JOURNAL_ENTRY_POINTS,
                            "timestamp": now,
                        }
                    },
                    "$setOnInsert": {"created_at": now, "session_id": session_id},
                },
                upsert=True,
            )
        except Exception as exc:
            logger.warning(f"Failed to save wellbeing entry: {exc}")
    
    return WellbeingEntryResponse(
        entry_id=entry_id,
        session_id=session_id,
        ai_prompt=ai_prompt,
        ai_reflection=ai_reflection,
        mood=request.mood,
        points_earned=JOURNAL_ENTRY_POINTS,
    )


@router.get("/history/{session_id}", response_model=WellbeingHistoryResponse)
def get_wellbeing_history(session_id: str) -> WellbeingHistoryResponse:
    """
    Get wellbeing journal history for a session.
    
    Returns mood entries, average mood, and journaling streak.
    """
    db = get_database()
    if db is None:
        return WellbeingHistoryResponse()
    
    try:
        wellbeing_col = db["wellbeing_journal"]
        entries = list(
            wellbeing_col.find(
                {"session_id": session_id},
                {"_id": 0},
            ).sort("created_at", -1).limit(30)
        )
        
        total_entries = len(entries)
        average_mood = 0.0
        if total_entries > 0:
            mood_sum = sum(e.get("mood", 3) for e in entries)
            average_mood = round(mood_sum / total_entries, 1)
        
        # Convert datetime objects to strings for JSON serialization
        for entry in entries:
            if "created_at" in entry:
                entry["created_at"] = entry["created_at"].isoformat()
        
        return WellbeingHistoryResponse(
            entries=entries,
            average_mood=average_mood,
            total_entries=total_entries,
            streak_days=_calculate_streak(entries),
        )
    except Exception as exc:
        logger.error(f"Error fetching wellbeing history: {exc}")
        return WellbeingHistoryResponse()


def _parse_wellbeing_response(ai_response: str) -> tuple:
    """Parse AI response into prompt and reflection sections."""
    ai_prompt = ""
    ai_reflection = ""
    
    if "PROMPT:" in ai_response and "REFLECTION:" in ai_response:
        parts = ai_response.split("REFLECTION:")
        ai_prompt = parts[0].replace("PROMPT:", "").strip()
        ai_reflection = parts[1].strip()
    else:
        # If format doesn't match, use the whole response as reflection
        ai_prompt = "How is your housing situation affecting your daily life today?"
        ai_reflection = ai_response.strip()
    
    return ai_prompt, ai_reflection


def _get_fallback_prompt(mood: int) -> str:
    """Get a fallback journaling prompt based on mood level."""
    fallback_prompts = {
        1: "It sounds like things are tough right now. What is the one thing about your housing situation that weighs on you most today?",
        2: "Housing stress can feel overwhelming. What is one small thing you could do today to feel a bit more in control?",
        3: "Take a moment to reflect: what is one thing about your home that you appreciate, and one thing you wish were different?",
        4: "Things seem to be going reasonably well. What positive steps have you taken recently regarding your housing rights?",
        5: "Great to hear you are feeling positive! What has improved in your housing situation, and how can you keep that momentum going?",
    }
    return fallback_prompts.get(mood, fallback_prompts[3])


def _calculate_streak(entries: list) -> int:
    """
    Calculate consecutive days of journaling.
    
    Entries are sorted newest-first. A streak counts consecutive calendar days
    that have at least one entry, starting from the most recent entry.
    """
    if not entries:
        return 0

    # Extract unique dates from entries (newest first)
    seen_dates: list[date] = []
    for entry in entries:
        created = entry.get("created_at", "")
        try:
            if isinstance(created, str):
                entry_date = date.fromisoformat(created[:10])
            elif hasattr(created, "date"):
                entry_date = created.date()
            else:
                continue

            if entry_date not in seen_dates:
                seen_dates.append(entry_date)
        except (ValueError, TypeError):
            continue

    if not seen_dates:
        return 0

    # Sort descending (most recent first)
    seen_dates.sort(reverse=True)

    # Count consecutive days starting from the most recent
    streak = 1
    for i in range(len(seen_dates) - 1):
        diff = (seen_dates[i] - seen_dates[i + 1]).days
        if diff == 1:
            streak += 1
        elif diff == 0:
            continue  # Same day, skip
        else:
            break  # Gap found, stop counting

    return streak
