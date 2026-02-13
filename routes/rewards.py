"""
Rewards and Incentive endpoint routes.

Tracks positive tenant behaviours (learning rights, journaling, reporting issues)
and generates AI-powered vouchers and badges to encourage engagement.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from models.schemas import RewardActionRequest, RewardsProfileResponse
from services.ai_service import get_ai_service
from database.connection import get_database

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rewards", tags=["rewards"])

# Points awarded for each action type
ACTION_POINTS = {
    "journal_entry": 15,
    "rights_learned": 20,
    "issue_reported": 25,
    "notice_checked": 30,
    "community_tip": 10,
}

# Level thresholds and names
LEVELS = [
    (0, "Newcomer"),
    (50, "Informed Tenant"),
    (150, "Rights Advocate"),
    (300, "Community Champion"),
    (500, "Housing Hero"),
]

# Badge definitions
BADGE_DEFINITIONS = {
    "first_question": {
        "name": "First Step",
        "description": "Asked your first legal question",
        "icon": "🏠",
        "points_required": 0,
        "action_type": "rights_learned",
        "action_count": 1,
    },
    "journal_starter": {
        "name": "Journal Starter",
        "description": "Made your first wellbeing journal entry",
        "icon": "📝",
        "points_required": 0,
        "action_type": "journal_entry",
        "action_count": 1,
    },
    "knowledge_seeker": {
        "name": "Knowledge Seeker",
        "description": "Learned about 5 different housing rights",
        "icon": "📚",
        "points_required": 0,
        "action_type": "rights_learned",
        "action_count": 5,
    },
    "wellbeing_warrior": {
        "name": "Wellbeing Warrior",
        "description": "Completed 7 journal entries",
        "icon": "💪",
        "points_required": 0,
        "action_type": "journal_entry",
        "action_count": 7,
    },
    "community_helper": {
        "name": "Community Helper",
        "description": "Shared 3 tips with the community",
        "icon": "🤝",
        "points_required": 0,
        "action_type": "community_tip",
        "action_count": 3,
    },
    "notice_expert": {
        "name": "Notice Expert",
        "description": "Had 3 notices analysed",
        "icon": "🔍",
        "points_required": 0,
        "action_type": "notice_checked",
        "action_count": 3,
    },
    "century_club": {
        "name": "Century Club",
        "description": "Earned 100 points",
        "icon": "💯",
        "points_required": 100,
        "action_type": None,
        "action_count": 0,
    },
    "housing_hero": {
        "name": "Housing Hero",
        "description": "Earned 500 points — you really know your rights!",
        "icon": "🦸",
        "points_required": 500,
        "action_type": None,
        "action_count": 0,
    },
}


@router.get("/profile/{session_id}", response_model=RewardsProfileResponse)
async def get_rewards_profile(session_id: str) -> RewardsProfileResponse:
    """
    Get the rewards profile for a session.
    
    Returns points, level, earned badges, and generated vouchers.
    """
    db = get_database()
    if db is None:
        return RewardsProfileResponse(session_id=session_id)
    
    try:
        rewards_col = db["rewards"]
        profile = rewards_col.find_one({"session_id": session_id})
        
        if not profile:
            return RewardsProfileResponse(session_id=session_id)
        
        total_points = profile.get("total_points", 0)
        actions = profile.get("actions", [])
        actions_completed = profile.get("actions_completed", 0)
        
        # Determine level
        level = _get_level(total_points)
        
        # Check for earned badges
        badges = _check_badges(total_points, actions)
        
        # Get vouchers
        vouchers = profile.get("vouchers", [])
        
        return RewardsProfileResponse(
            session_id=session_id,
            total_points=total_points,
            level=level,
            badges=badges,
            vouchers=vouchers,
            actions_completed=actions_completed,
        )
    except Exception as exc:
        logger.error(f"Error fetching rewards profile: {exc}")
        return RewardsProfileResponse(session_id=session_id)


@router.post("/action")
async def log_reward_action(request: RewardActionRequest) -> Dict[str, Any]:
    """
    Log a reward-earning action.
    
    Awards points for positive behaviours like learning about rights,
    journaling, reporting issues, etc.
    """
    session_id = request.session_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    # Look up points for this action type
    points = ACTION_POINTS.get(request.action_type, 10)
    
    db = get_database()
    if db is None:
        return {
            "session_id": session_id,
            "points_earned": points,
            "total_points": points,
            "message": "Points tracked locally (database unavailable)",
        }
    
    try:
        rewards_col = db["rewards"]
        
        # Update rewards profile
        result = rewards_col.find_one_and_update(
            {"session_id": session_id},
            {
                "$inc": {
                    "total_points": points,
                    "actions_completed": 1,
                },
                "$push": {
                    "actions": {
                        "type": request.action_type,
                        "points": points,
                        "details": request.details or "",
                        "timestamp": now,
                    }
                },
                "$setOnInsert": {"created_at": now, "session_id": session_id},
            },
            upsert=True,
            return_document=True,
        )
        
        new_total = result.get("total_points", points) if result else points
        
        # Check if user crossed a level threshold
        new_level = _get_level(new_total)
        old_level = _get_level(new_total - points)
        level_up = new_level != old_level
        
        # Check for new voucher eligibility (every 100 points)
        voucher = None
        if (new_total // 100) > ((new_total - points) // 100):
            voucher = await _generate_voucher(session_id, new_total, db)
        
        response = {
            "session_id": session_id,
            "points_earned": points,
            "total_points": new_total,
            "level": new_level,
            "level_up": level_up,
            "message": f"Earned {points} points for {request.action_type.replace('_', ' ')}!",
        }
        
        if voucher:
            response["voucher"] = voucher
        
        return response
        
    except Exception as exc:
        logger.error(f"Error logging reward action: {exc}")
        return {
            "session_id": session_id,
            "points_earned": points,
            "total_points": points,
            "message": "Action logged",
        }


async def _generate_voucher(session_id: str, total_points: int, db) -> Dict[str, Any]:
    """
    Generate an AI-powered reward voucher when a points milestone is reached.
    
    Vouchers are encouraging messages with practical housing-related rewards
    (e.g., reminders, checklists, resource links).
    """
    ai_service = get_ai_service()
    
    voucher_prompt = f"""
You are RentShield's Rewards system. A tenant has just reached {total_points} points
by actively learning about their housing rights and tracking their wellbeing.

Generate a short congratulatory VOUCHER (3-4 sentences) that:
1. Celebrates their achievement
2. Includes a specific practical housing tip they might not know
3. Encourages them to keep engaging

Keep it warm, specific, and useful. No generic platitudes.
Format: Just the voucher text, nothing else.
"""
    
    try:
        voucher_text = await ai_service.chat_completion(
            user_message=voucher_prompt,
            context="",
            history="",
            user_type="tenant",
        )
    except Exception:
        voucher_text = f"Congratulations on reaching {total_points} points! You are becoming a true housing rights expert."
    
    voucher = {
        "voucher_id": str(uuid.uuid4()),
        "title": f"🎉 {total_points} Points Milestone!",
        "description": voucher_text.strip(),
        "points_milestone": total_points,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    
    # Save voucher to profile
    try:
        rewards_col = db["rewards"]
        rewards_col.update_one(
            {"session_id": session_id},
            {"$push": {"vouchers": voucher}},
        )
    except Exception as exc:
        logger.warning(f"Failed to save voucher: {exc}")
    
    return voucher


def _get_level(points: int) -> str:
    """Determine level name based on total points."""
    level_name = "Newcomer"
    for threshold, name in LEVELS:
        if points >= threshold:
            level_name = name
    return level_name


def _check_badges(total_points: int, actions: list) -> List[Dict[str, Any]]:
    """Check which badges the user has earned."""
    earned_badges = []
    
    # Count actions by type
    action_counts: Dict[str, int] = {}
    for action in actions:
        action_type = action.get("type", "")
        action_counts[action_type] = action_counts.get(action_type, 0) + 1
    
    # Check each badge definition
    for badge_id, badge_def in BADGE_DEFINITIONS.items():
        earned = False
        
        # Check points-based badges
        if badge_def["points_required"] > 0:
            if total_points >= badge_def["points_required"]:
                earned = True
        
        # Check action-based badges
        if badge_def["action_type"] and badge_def["action_count"] > 0:
            count = action_counts.get(badge_def["action_type"], 0)
            if count >= badge_def["action_count"]:
                earned = True
        
        if earned:
            earned_badges.append({
                "id": badge_id,
                "name": badge_def["name"],
                "description": badge_def["description"],
                "icon": badge_def["icon"],
            })
    
    return earned_badges
