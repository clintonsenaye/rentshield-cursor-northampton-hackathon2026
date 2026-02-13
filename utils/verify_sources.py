"""
Legislation source verification utility.

Checks that source URLs in data files are reachable and flags stale content
that hasn't been verified within the configured review cycle.

Usage:
    python -m utils.verify_sources
"""

import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# Data files to verify
BASE_DIR = Path(__file__).parent.parent
DATA_FILES = {
    "legal_knowledge": BASE_DIR / "data" / "legal_knowledge.json",
    "community_knowledge": BASE_DIR / "data" / "community_knowledge.json",
    "compliance_requirements": BASE_DIR / "data" / "compliance_requirements.json",
}


def _load_json(path: Path) -> Dict[str, Any]:
    """Load and parse a JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _extract_items(data: Any, keys: List[str]) -> List[Dict[str, Any]]:
    """Extract items from data structure, trying multiple keys."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in keys:
            if key in data:
                return data[key]
    return []


def check_staleness(data: Dict[str, Any], file_name: str) -> List[str]:
    """
    Check for stale content that hasn't been verified within the review cycle.

    Returns a list of warning messages for stale items.
    """
    warnings: List[str] = []
    meta = data.get("_meta", {})
    review_cycle_days = meta.get("review_cycle_days", 90)
    cutoff = datetime.now() - timedelta(days=review_cycle_days)

    # Check items across all possible keys
    items = _extract_items(data, ["documents", "articles", "requirements"])

    for item in items:
        item_id = (
            item.get("article_id")
            or item.get("requirement_id")
            or item.get("title", "unknown")
        )
        last_verified = item.get("last_verified")

        if not last_verified:
            warnings.append(
                f"[{file_name}] {item_id}: No last_verified date"
            )
            continue

        try:
            verified_date = datetime.strptime(last_verified, "%Y-%m-%d")
            if verified_date < cutoff:
                days_old = (datetime.now() - verified_date).days
                warnings.append(
                    f"[{file_name}] {item_id}: Last verified {days_old} days ago "
                    f"(review cycle is {review_cycle_days} days)"
                )
        except ValueError:
            warnings.append(
                f"[{file_name}] {item_id}: Invalid date format '{last_verified}'"
            )

    return warnings


def check_source_urls(data: Any, file_name: str) -> Dict[str, Any]:
    """
    Check that all source URLs in a data file are reachable.

    Returns a dict with 'ok', 'failed', and 'missing' lists.
    """
    results = {"ok": [], "failed": [], "missing": []}

    items = _extract_items(data, ["documents", "articles", "requirements"])

    # Collect all unique URLs to check
    urls_to_check: Dict[str, str] = {}  # url -> item_id

    for item in items:
        item_id = (
            item.get("article_id")
            or item.get("requirement_id")
            or item.get("title", "unknown")
        )

        # Check sources array
        sources = item.get("sources", [])
        if not sources:
            # Check single source_url field
            source_url = item.get("source_url")
            if source_url:
                urls_to_check[source_url] = item_id
            else:
                results["missing"].append(item_id)
        else:
            for src in sources:
                url = src.get("url", "")
                if url:
                    urls_to_check[url] = item_id
                else:
                    results["missing"].append(f"{item_id} (empty URL)")

    # Check URLs with HEAD requests
    with httpx.Client(timeout=10, follow_redirects=True) as client:
        for url, item_id in urls_to_check.items():
            try:
                response = client.head(url)
                if response.status_code < 400:
                    results["ok"].append({"url": url, "item": item_id, "status": response.status_code})
                else:
                    results["failed"].append({"url": url, "item": item_id, "status": response.status_code})
            except httpx.HTTPError as exc:
                results["failed"].append({"url": url, "item": item_id, "error": str(exc)})

    return results


def verify_all() -> None:
    """Run all verification checks on all data files."""
    logger.info("Starting source verification...")
    all_stale: List[str] = []
    total_ok = 0
    total_failed = 0
    total_missing = 0

    for name, path in DATA_FILES.items():
        if not path.exists():
            logger.warning("File not found: %s", path)
            continue

        logger.info("Checking %s...", name)
        data = _load_json(path)

        # Check staleness
        stale_warnings = check_staleness(data, name)
        all_stale.extend(stale_warnings)

        # Check source URLs
        url_results = check_source_urls(data, name)
        total_ok += len(url_results["ok"])
        total_failed += len(url_results["failed"])
        total_missing += len(url_results["missing"])

        for item in url_results["failed"]:
            error = item.get("error", f"HTTP {item.get('status')}")
            logger.error("BROKEN URL: [%s] %s — %s", item["item"], item["url"], error)

        for item_id in url_results["missing"]:
            logger.warning("NO SOURCE: [%s] %s", name, item_id)

    # Print summary
    logger.info("=== VERIFICATION SUMMARY ===")
    logger.info("Source URLs: %d OK, %d FAILED, %d MISSING", total_ok, total_failed, total_missing)

    if all_stale:
        logger.info("Stale content (%d items):", len(all_stale))
        for warning in all_stale:
            logger.warning("  %s", warning)
    else:
        logger.info("No stale content found.")

    if total_failed > 0 or total_missing > 0:
        logger.warning("ACTION REQUIRED: Fix broken URLs and add missing sources.")
    else:
        logger.info("All sources verified successfully.")


if __name__ == "__main__":
    verify_all()
