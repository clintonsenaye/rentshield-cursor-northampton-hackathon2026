"""
AI Scenario Simulator — "What would happen if..." structured outcomes.

Uses the AI service to simulate landlord-tenant scenarios with step-by-step
legal outcomes based on UK housing law.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from database.connection import get_database
from services.ai_service import AIService
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scenarios", tags=["scenario_simulator"])

ai_service = AIService()

# Pre-built scenario templates
SCENARIO_TEMPLATES = [
    {
        "id": "s1",
        "title": "Landlord wants to sell the property",
        "description": "Your landlord informs you they want to sell. What happens next?",
        "category": "eviction",
        "prompt_template": "My landlord wants to sell the property I'm renting. Walk me through what happens step by step under the Renters' Rights Act 2025.",
    },
    {
        "id": "s2",
        "title": "Rent increase above market rate",
        "description": "You receive a Section 13 notice with a large rent increase.",
        "category": "rent",
        "prompt_template": "I've received a Section 13 rent increase notice that seems above market rate. Walk me through the challenge process step by step.",
    },
    {
        "id": "s3",
        "title": "Landlord ignores repair request",
        "description": "You've reported a serious repair issue but the landlord is unresponsive.",
        "category": "repairs",
        "prompt_template": "I reported a serious repair issue (damp/mould) to my landlord 4 weeks ago with no response. Walk me through the escalation process step by step.",
    },
    {
        "id": "s4",
        "title": "Deposit not returned after moving out",
        "description": "You've left the property but your deposit hasn't been returned.",
        "category": "deposit",
        "prompt_template": "I moved out 3 weeks ago and my landlord hasn't returned my deposit or provided a breakdown. Walk me through the dispute process step by step.",
    },
    {
        "id": "s5",
        "title": "Landlord enters without permission",
        "description": "Your landlord has been entering your property without giving notice.",
        "category": "harassment",
        "prompt_template": "My landlord keeps entering my home without giving 24 hours notice. Walk me through my rights and the steps to stop this, under UK housing law.",
    },
    {
        "id": "s6",
        "title": "Requesting a pet",
        "description": "You want to request permission to keep a pet in your rental.",
        "category": "pets",
        "prompt_template": "I want to request permission to keep a cat in my rental property. Walk me through the process under the Renters' Rights Act 2025.",
    },
    {
        "id": "s7",
        "title": "Tenant falls behind on rent",
        "description": "You've missed rent payments due to financial difficulties.",
        "category": "rent_arrears",
        "prompt_template": "I've fallen 2 months behind on rent due to losing my job. Walk me through my options and what the landlord can legally do, step by step.",
    },
    {
        "id": "s8",
        "title": "Landlord retaliates after complaint",
        "description": "After complaining about repairs, your landlord serves an eviction notice.",
        "category": "retaliation",
        "prompt_template": "I reported repair issues to the council and now my landlord has served me a Section 8 notice. Walk me through the retaliatory eviction protections step by step.",
    },
]

SCENARIO_SYSTEM_PROMPT = """You are RentShield's Scenario Simulator. The user wants to understand
what would happen in a specific housing law scenario under UK law (Renters' Rights Act 2025).

Your response MUST follow this format:

1. **Scenario Overview** — Brief summary of the situation
2. **Step-by-Step Process** — Numbered steps showing exactly what happens, including:
   - Legal timeframes and deadlines
   - Required documents and forms
   - Who to contact at each stage
3. **Your Rights** — Key protections that apply
4. **Likely Outcomes** — Possible outcomes and their likelihood
5. **Key Contacts** — Relevant helplines and organisations
6. **Important Deadlines** — Summary of all time-sensitive actions

Be specific, cite legislation where relevant, and use clear language.
Keep the response practical and actionable. Always refer to the Renters' Rights Act 2025
where applicable."""


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SimulateRequest(BaseModel):
    """Request to simulate a scenario."""
    scenario_id: Optional[str] = Field(None, description="Pre-built scenario template ID")
    custom_scenario: Optional[str] = Field(
        None, max_length=2000,
        description="Custom scenario description (if not using template)",
    )


class ScenarioResponse(BaseModel):
    """Simulated scenario result."""
    scenario_id: str
    title: str
    category: str
    simulation: str
    created_at: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/templates")
def get_scenario_templates(authorization: str = Header("")) -> List[Dict[str, str]]:
    """Return all pre-built scenario templates."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return [
        {
            "id": t["id"],
            "title": t["title"],
            "description": t["description"],
            "category": t["category"],
        }
        for t in SCENARIO_TEMPLATES
    ]


@router.post("/simulate", response_model=ScenarioResponse)
async def simulate_scenario(
    request: SimulateRequest,
    authorization: str = Header(""),
) -> ScenarioResponse:
    """Simulate a scenario and get step-by-step outcomes."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Determine the prompt
    if request.scenario_id:
        template = None
        for t in SCENARIO_TEMPLATES:
            if t["id"] == request.scenario_id:
                template = t
                break
        if not template:
            raise HTTPException(status_code=404, detail="Scenario template not found")
        prompt = template["prompt_template"]
        title = template["title"]
        category = template["category"]
    elif request.custom_scenario:
        prompt = request.custom_scenario.strip()
        title = prompt[:80] + ("..." if len(prompt) > 80 else "")
        category = "custom"
    else:
        raise HTTPException(status_code=400, detail="Provide either scenario_id or custom_scenario")

    # Call AI service — pass scenario instructions via the context field
    try:
        result = await ai_service.chat_completion(
            user_message=prompt,
            context=SCENARIO_SYSTEM_PROMPT,
            user_type=user["role"],
        )
    except Exception as e:
        logger.error("Scenario simulation failed: %s", str(e))
        raise HTTPException(status_code=503, detail="AI service unavailable")

    now = datetime.now(timezone.utc).isoformat()
    scenario_id = str(uuid.uuid4())

    # Save the simulation
    db["scenario_simulations"].insert_one({
        "scenario_id": scenario_id,
        "user_id": user["user_id"],
        "title": title,
        "category": category,
        "prompt": prompt,
        "simulation": result,
        "created_at": now,
    })

    return ScenarioResponse(
        scenario_id=scenario_id,
        title=title,
        category=category,
        simulation=result,
        created_at=now,
    )


@router.get("/history")
def get_simulation_history(
    authorization: str = Header(""),
) -> List[Dict[str, Any]]:
    """Get the user's past scenario simulations."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    sims = list(
        db["scenario_simulations"]
        .find({"user_id": user["user_id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
    )

    return sims
