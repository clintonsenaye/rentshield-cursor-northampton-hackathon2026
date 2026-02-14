"""
Interactive Rights Quiz — gamified scenario-based learning.

Tenants answer multiple-choice questions about UK renting rights under the
Renters' Rights Act 2025. Correct answers earn reward points and track
progress toward quiz-related badges.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quiz", tags=["quiz"])

# ---------------------------------------------------------------------------
# Quiz question bank — scenario-based UK renting rights
# ---------------------------------------------------------------------------

QUIZ_QUESTIONS: List[Dict[str, Any]] = [
    {
        "id": "q1",
        "category": "eviction",
        "scenario": "Your landlord slides a note under your door saying you must leave in 2 weeks. No formal paperwork is attached.",
        "question": "Is this a valid eviction notice under the Renters' Rights Act 2025?",
        "options": [
            "Yes — any written notice counts",
            "No — a valid notice must follow prescribed legal form and minimum notice periods",
            "Only if the landlord also tells you verbally",
            "It depends on how long you've lived there"
        ],
        "correct": 1,
        "explanation": "Under the Renters' Rights Act 2025, landlords must serve a valid Section 8 notice using the prescribed form with specific grounds and proper notice periods. An informal note has no legal standing.",
        "source": "Renters' Rights Act 2025, Section 8 (grounds for possession)"
    },
    {
        "id": "q2",
        "category": "deposit",
        "scenario": "You paid a £1,200 deposit when you moved in 3 months ago. Your landlord mentions they haven't 'got around to' protecting it yet.",
        "question": "What are your rights regarding the unprotected deposit?",
        "options": [
            "You have no recourse — the landlord can protect it at any time",
            "The landlord must protect the deposit within 30 days and provide prescribed information, or face penalties of 1-3x the deposit amount",
            "Only deposits over £2,000 need to be protected",
            "Deposit protection is optional for private landlords"
        ],
        "correct": 1,
        "explanation": "Landlords must protect the deposit in a government-approved scheme within 30 days and give you prescribed information. Failure can result in a penalty of 1-3 times the deposit amount, and the landlord cannot use a Section 21 notice.",
        "source": "Housing Act 2004, Sections 213-215; Renters' Rights Act 2025"
    },
    {
        "id": "q3",
        "category": "repairs",
        "scenario": "There's been black mould growing in your bathroom for 6 weeks. You've reported it twice but your landlord hasn't responded.",
        "question": "What should you do next?",
        "options": [
            "Stop paying rent until the issue is fixed",
            "Report the issue to your local council's Environmental Health department and keep evidence of all reports made",
            "Move out immediately — the tenancy is automatically void",
            "Fix it yourself and send the landlord the bill"
        ],
        "correct": 1,
        "explanation": "You should report hazards to your local council's Environmental Health team who can inspect and enforce repairs. Under the Homes (Fitness for Human Habitation) Act 2018, landlords must ensure properties are fit for habitation. Always keep evidence (photos, dated correspondence).",
        "source": "Homes (Fitness for Human Habitation) Act 2018; Renters' Rights Act 2025"
    },
    {
        "id": "q4",
        "category": "rent_increase",
        "scenario": "Your landlord sends you a letter saying rent will increase by 25% starting next month.",
        "question": "What is the correct process for a valid rent increase?",
        "options": [
            "The landlord can increase rent by any amount with 1 month's notice",
            "The landlord must use a Section 13 notice with at least 2 months' notice, and you can challenge it at a First-tier Tribunal if it's above market rate",
            "Rent can only be increased once every 6 months",
            "The landlord needs your written consent for any increase"
        ],
        "correct": 1,
        "explanation": "Under the Renters' Rights Act 2025, rent increases must follow the Section 13 process with at least 2 months' notice. Tenants can challenge above-market-rate increases at the First-tier Tribunal. Rent can only be increased once per year.",
        "source": "Renters' Rights Act 2025, Section 13 (rent increases)"
    },
    {
        "id": "q5",
        "category": "discrimination",
        "scenario": "You find a perfect flat but the letting agent says 'No DSS' — meaning they won't accept tenants on housing benefits.",
        "question": "Is this lawful?",
        "options": [
            "Yes — landlords can choose who they rent to",
            "No — blanket 'No DSS' policies have been ruled as indirect discrimination and are unlawful",
            "Only if the landlord's mortgage lender requires it",
            "It's only illegal if you have children"
        ],
        "correct": 1,
        "explanation": "'No DSS' blanket bans have been found to be indirect discrimination against women and disabled people under the Equality Act 2010. Landlords must consider each application on its own merits.",
        "source": "Equality Act 2010; York County Court judgment (2020)"
    },
    {
        "id": "q6",
        "category": "illegal_eviction",
        "scenario": "You come home from work to find the locks have been changed and your belongings are inside.",
        "question": "What has happened and what should you do?",
        "options": [
            "The landlord has legally ended your tenancy — find a new place",
            "This is an illegal eviction — call the police, contact your council's tenancy relations officer, and seek emergency legal help",
            "You should wait 24 hours to see if it's a mistake",
            "Break back in — you have the right to force entry"
        ],
        "correct": 1,
        "explanation": "Changing locks to deny a tenant entry is an illegal eviction under the Protection from Eviction Act 1977. It is a criminal offence. Call the police (101 or 999 if you feel unsafe), contact your council's tenancy relations officer, and seek emergency legal advice from Shelter (0808 800 4444).",
        "source": "Protection from Eviction Act 1977, Section 1"
    },
    {
        "id": "q7",
        "category": "repairs",
        "scenario": "Your boiler has broken in December and there's no heating or hot water. Your landlord says they'll 'sort it after Christmas'.",
        "question": "How quickly must the landlord act?",
        "options": [
            "There's no specific timeframe — 'reasonable' is subjective",
            "Emergency repairs (no heating/hot water) should be addressed within 24 hours; landlords have a legal duty to maintain heating systems",
            "The landlord has 28 days for any repair",
            "Only if the temperature drops below freezing"
        ],
        "correct": 1,
        "explanation": "Loss of heating or hot water is classed as an emergency repair. Under Section 11 of the Landlord and Tenant Act 1985, landlords must keep heating and hot water installations in repair. Emergency repairs should be addressed within 24 hours. Contact your council if the landlord fails to act.",
        "source": "Landlord and Tenant Act 1985, Section 11"
    },
    {
        "id": "q8",
        "category": "eviction",
        "scenario": "Your landlord wants you to leave because they want to sell the property. They haven't given you any formal notice yet.",
        "question": "Under the Renters' Rights Act 2025, what must the landlord do?",
        "options": [
            "They can ask you to leave verbally with 1 month's notice",
            "They must serve a Section 8 notice with 'intention to sell' as a ground, giving at least 4 months' notice",
            "They can evict you immediately if they have a buyer",
            "Selling the property is not a valid reason to end a tenancy"
        ],
        "correct": 1,
        "explanation": "The Renters' Rights Act 2025 abolished Section 21 'no-fault' evictions. To regain possession for sale, landlords must use Section 8 with the 'intention to sell' ground, providing at least 4 months' notice. This ground cannot be used in the first 12 months of a tenancy.",
        "source": "Renters' Rights Act 2025, Section 8 (ground for sale of property)"
    },
    {
        "id": "q9",
        "category": "pets",
        "scenario": "Your tenancy agreement says 'no pets'. You want to get a cat.",
        "question": "What are your rights regarding pets under the new law?",
        "options": [
            "You must obey the agreement — no pets means no pets",
            "Under the Renters' Rights Act 2025, tenants have the right to request a pet and landlords cannot unreasonably refuse",
            "You can get any pet without permission",
            "Only guide dogs are protected"
        ],
        "correct": 1,
        "explanation": "The Renters' Rights Act 2025 gives tenants the right to request keeping a pet. Landlords cannot unreasonably refuse but may require pet damage insurance. If refused, tenants can challenge the decision.",
        "source": "Renters' Rights Act 2025 (pet provisions)"
    },
    {
        "id": "q10",
        "category": "deposit",
        "scenario": "At the end of your tenancy, the landlord wants to deduct £400 from your £1,000 deposit for 'general wear and tear'.",
        "question": "Is this deduction valid?",
        "options": [
            "Yes — the landlord can deduct for any reason",
            "No — landlords cannot deduct for fair wear and tear; deductions must be for actual damage beyond normal use",
            "Only if the tenancy was less than 1 year",
            "The landlord can keep the entire deposit if you didn't give 2 months' notice"
        ],
        "correct": 1,
        "explanation": "Landlords cannot make deductions for fair wear and tear. Deductions must be for actual damage beyond normal use, supported by evidence (check-in/check-out inventory, photos). Disputed deductions can be resolved through the deposit scheme's free dispute resolution service.",
        "source": "Housing Act 2004, Sections 213-215; Deposit protection scheme rules"
    },
    {
        "id": "q11",
        "category": "privacy",
        "scenario": "Your landlord turns up unannounced and lets themselves in with their spare key while you're at work.",
        "question": "What are your rights regarding landlord access?",
        "options": [
            "The landlord owns the property so can enter whenever they want",
            "The landlord must give at least 24 hours' written notice and visit at a reasonable time, except in genuine emergencies",
            "The landlord can enter once a month without notice",
            "You must give the landlord a spare key"
        ],
        "correct": 1,
        "explanation": "Tenants have the right to 'quiet enjoyment' of their home. Landlords must give at least 24 hours' notice in writing and arrange visits at reasonable times. Entering without permission (except in a genuine emergency like a gas leak) can constitute harassment under the Protection from Eviction Act 1977.",
        "source": "Protection from Eviction Act 1977; Landlord and Tenant Act 1985"
    },
    {
        "id": "q12",
        "category": "repairs",
        "scenario": "There are exposed electrical wires in your kitchen. You've told the landlord but they say it's 'cosmetic'.",
        "question": "What category of hazard is this and what can you do?",
        "options": [
            "It's a minor issue — give the landlord a month",
            "Exposed wires are a Category 1 (serious) hazard under HHSRS; report to your council who must take enforcement action",
            "Only a qualified electrician can determine if it's dangerous",
            "You should fix it yourself for safety"
        ],
        "correct": 1,
        "explanation": "Exposed electrical wires are a Category 1 hazard under the Housing Health and Safety Rating System (HHSRS). Your council's Environmental Health team has a duty to take enforcement action for Category 1 hazards. They can issue an improvement notice or emergency remedial action.",
        "source": "Housing Act 2004, Part 1 (HHSRS); Electrical Safety Standards Regulations 2020"
    },
]


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class QuizAnswerRequest(BaseModel):
    """Submit an answer to a quiz question."""
    question_id: str = Field(..., min_length=1, max_length=20, description="The question ID")
    selected_option: int = Field(..., ge=0, le=3, description="Index of selected answer (0-3)")


class QuizAnswerResponse(BaseModel):
    """Result after answering a quiz question."""
    correct: bool
    correct_option: int
    explanation: str
    source: str
    points_earned: int


class QuizProgressResponse(BaseModel):
    """User's overall quiz progress."""
    total_answered: int
    total_correct: int
    accuracy_pct: float
    categories_completed: Dict[str, Dict[str, int]]
    points_earned: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/questions")
def get_quiz_questions(authorization: str = Header("")) -> List[Dict[str, Any]]:
    """Return all quiz questions (without correct answers)."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    # Strip correct answer & explanation from response
    safe_questions = []
    for q in QUIZ_QUESTIONS:
        safe_questions.append({
            "id": q["id"],
            "category": q["category"],
            "scenario": q["scenario"],
            "question": q["question"],
            "options": q["options"],
        })
    return safe_questions


@router.post("/answer", response_model=QuizAnswerResponse)
def submit_quiz_answer(
    request: QuizAnswerRequest,
    authorization: str = Header(""),
) -> QuizAnswerResponse:
    """Submit an answer and receive feedback + points."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Find the question
    question = None
    for q in QUIZ_QUESTIONS:
        if q["id"] == request.question_id:
            question = q
            break

    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")

    is_correct = request.selected_option == question["correct"]
    points = 10 if is_correct else 0

    # Record the attempt
    now = datetime.now(timezone.utc).isoformat()
    db["quiz_attempts"].insert_one({
        "attempt_id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "question_id": request.question_id,
        "category": question["category"],
        "selected_option": request.selected_option,
        "correct": is_correct,
        "points_earned": points,
        "created_at": now,
    })

    # Award points
    if points > 0:
        db["users"].update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"points": points}},
        )

    return QuizAnswerResponse(
        correct=is_correct,
        correct_option=question["correct"],
        explanation=question["explanation"],
        source=question["source"],
        points_earned=points,
    )


@router.get("/progress", response_model=QuizProgressResponse)
def get_quiz_progress(authorization: str = Header("")) -> QuizProgressResponse:
    """Get the user's quiz progress and stats."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    attempts = list(
        db["quiz_attempts"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(500)
    )

    total = len(attempts)
    correct = sum(1 for a in attempts if a.get("correct"))
    points = sum(a.get("points_earned", 0) for a in attempts)

    # Group by category
    categories: Dict[str, Dict[str, int]] = {}
    for a in attempts:
        cat = a.get("category", "unknown")
        if cat not in categories:
            categories[cat] = {"answered": 0, "correct": 0}
        categories[cat]["answered"] += 1
        if a.get("correct"):
            categories[cat]["correct"] += 1

    return QuizProgressResponse(
        total_answered=total,
        total_correct=correct,
        accuracy_pct=round((correct / total * 100) if total > 0 else 0, 1),
        categories_completed=categories,
        points_earned=points,
    )
