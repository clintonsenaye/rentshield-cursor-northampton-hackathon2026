"""
Community knowledge base routes.

Provides searchable FAQ articles curated from common housing questions.
Reduces AI API costs by giving instant answers for frequent queries.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from database.connection import get_knowledge_base_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])
limiter = Limiter(key_func=get_remote_address)


@router.get("")
def list_articles(
    q: Optional[str] = Query(None, max_length=200, description="Search query"),
    category: Optional[str] = Query(None, max_length=50, description="Filter by category"),
) -> Dict[str, Any]:
    """
    List or search knowledge base articles.

    Supports text search via 'q' parameter and category filtering.
    No authentication required — knowledge is public.
    """
    kb_col = get_knowledge_base_collection()
    if kb_col is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    try:
        query_filter = {}

        if q:
            query_filter["$text"] = {"$search": q}

        if category:
            query_filter["category"] = category

        projection = {
            "_id": 0,
            "article_id": 1,
            "question": 1,
            "answer": 1,
            "category": 1,
            "tags": 1,
            "helpful_count": 1,
        }

        if q:
            # Include text search score for relevance ranking
            projection["score"] = {"$meta": "textScore"}
            cursor = kb_col.find(query_filter, projection).sort(
                [("score", {"$meta": "textScore"})]
            ).limit(20)
        else:
            cursor = kb_col.find(query_filter, projection).sort("category", 1).limit(50)

        articles = list(cursor)
        for article in articles:
            article.setdefault("helpful_count", 0)
            article.pop("score", None)

        # Get unique categories for the filter dropdown
        categories = kb_col.distinct("category")

        return {
            "articles": articles,
            "categories": sorted(categories),
            "total": len(articles),
        }

    except Exception as exc:
        logger.error("Failed to list knowledge articles: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load knowledge base.")


@router.get("/{article_id}")
def get_article(article_id: str) -> Dict[str, Any]:
    """
    Get a single knowledge base article by ID.
    """
    kb_col = get_knowledge_base_collection()
    if kb_col is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    try:
        article = kb_col.find_one(
            {"article_id": article_id},
            {"_id": 0}
        )
        if not article:
            raise HTTPException(status_code=404, detail="Article not found.")

        article.setdefault("helpful_count", 0)
        return article

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to get article: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to load article.")


@router.post("/{article_id}/helpful")
@limiter.limit("10/minute")
def mark_helpful(request: Request, article_id: str) -> Dict[str, str]:
    """
    Increment the helpful count for an article.
    No authentication required — anyone can vote.
    """
    kb_col = get_knowledge_base_collection()
    if kb_col is None:
        raise HTTPException(status_code=503, detail="Database unavailable.")

    try:
        result = kb_col.update_one(
            {"article_id": article_id},
            {"$inc": {"helpful_count": 1}}
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Article not found.")

        return {"message": "Thanks for your feedback."}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to update helpful count: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to record feedback.")
