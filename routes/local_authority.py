"""
Local Authority Lookup routes.

Provides postcode-based lookup of local councils, housing support services,
and emergency helplines relevant to the user's area.

Uses the first part of a UK postcode (outcode) to map to local authorities.
"""

import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/local-authority", tags=["local-authority"])

# National helplines (always returned)
NATIONAL_HELPLINES = [
    {
        "name": "Shelter England",
        "phone": "0808 800 4444",
        "description": "Free housing advice helpline (England)",
        "hours": "8am-8pm weekdays, 9am-5pm weekends",
        "url": "https://www.shelter.org.uk",
    },
    {
        "name": "Citizens Advice",
        "phone": "0800 144 8848",
        "description": "Free legal and housing advice",
        "hours": "9am-5pm weekdays",
        "url": "https://www.citizensadvice.org.uk",
    },
    {
        "name": "Shelter Scotland",
        "phone": "0808 800 4444",
        "description": "Free housing advice helpline (Scotland)",
        "hours": "9am-5pm weekdays",
        "url": "https://scotland.shelter.org.uk",
    },
    {
        "name": "Police (non-emergency)",
        "phone": "101",
        "description": "Report illegal eviction or landlord harassment",
        "hours": "24/7",
        "url": "",
    },
    {
        "name": "Police (emergency)",
        "phone": "999",
        "description": "If you are in immediate danger or being physically forced out",
        "hours": "24/7",
        "url": "",
    },
    {
        "name": "Environmental Health",
        "phone": "Contact your local council",
        "description": "Report unsafe housing conditions, damp, mould, or hazards",
        "hours": "Varies by council",
        "url": "",
    },
]

# London boroughs mapped by postcode prefix
# Major UK cities and regions mapped by outcode prefix
POSTCODE_TO_COUNCIL = {
    # London
    "E": "London Borough (East London)",
    "EC": "City of London",
    "N": "London Borough (North London)",
    "NW": "London Borough (North West London)",
    "SE": "London Borough (South East London)",
    "SW": "London Borough (South West London)",
    "W": "London Borough (West London)",
    "WC": "City of Westminster / Camden",
    # Major cities
    "B": "Birmingham City Council",
    "BS": "Bristol City Council",
    "CB": "Cambridge City Council",
    "CF": "Cardiff Council",
    "CV": "Coventry City Council",
    "EH": "City of Edinburgh Council",
    "G": "Glasgow City Council",
    "L": "Liverpool City Council",
    "LE": "Leicester City Council",
    "LS": "Leeds City Council",
    "M": "Manchester City Council",
    "NE": "Newcastle City Council",
    "NG": "Nottingham City Council",
    "OX": "Oxford City Council",
    "PL": "Plymouth City Council",
    "S": "Sheffield City Council",
    "SO": "Southampton City Council",
    "BA": "Bath and North East Somerset Council",
    "BN": "Brighton and Hove City Council",
    "CT": "Canterbury City Council",
    "DE": "Derby City Council",
    "EX": "Exeter City Council",
    "GL": "Gloucester City Council",
    "GU": "Guildford Borough Council",
    "HG": "Harrogate Borough Council",
    "HP": "Buckinghamshire Council",
    "IP": "Ipswich Borough Council",
    "KT": "Kingston upon Thames / Surrey",
    "LN": "Lincoln City Council",
    "LU": "Luton Borough Council",
    "ME": "Medway Council",
    "MK": "Milton Keynes City Council",
    "NN": "North Northamptonshire Council",
    "PE": "Peterborough City Council",
    "PO": "Portsmouth City Council",
    "RG": "Reading Borough Council",
    "RH": "Reigate and Banstead / Mid Sussex",
    "SL": "Slough Borough Council",
    "SN": "Swindon Borough Council",
    "SP": "Wiltshire Council",
    "ST": "Stoke-on-Trent City Council",
    "TN": "Tunbridge Wells Borough Council",
    "WA": "Warrington Borough Council",
    "WF": "Wakefield Council",
    "WN": "Wigan Council",
    "WR": "Worcester City Council",
    "WS": "Walsall Council",
    "WV": "Wolverhampton City Council",
    "YO": "City of York Council",
}

# UK postcode pattern: allows full postcode or just outcode
UK_POSTCODE_RE = re.compile(
    r"^([A-Z]{1,2})\d{1,2}[A-Z]?\s*\d?[A-Z]{0,2}$",
    re.IGNORECASE,
)


def _extract_outcode_prefix(postcode: str) -> Optional[str]:
    """Extract the letter prefix from a UK postcode."""
    clean = postcode.strip().upper()
    match = UK_POSTCODE_RE.match(clean)
    if match:
        return match.group(1)
    # Try just the first 1-2 letters
    letters = re.match(r"^([A-Z]{1,2})", clean)
    return letters.group(1) if letters else None


@router.get("/lookup")
def lookup_local_authority(
    postcode: str = Query(..., min_length=2, max_length=10, description="UK postcode or first part"),
) -> Dict[str, Any]:
    """
    Look up the local authority and support services for a UK postcode.

    Returns the council name, local services, and national helplines.
    """
    prefix = _extract_outcode_prefix(postcode)

    if not prefix:
        raise HTTPException(
            status_code=400,
            detail="Invalid postcode format. Please enter a valid UK postcode (e.g. SW1A 1AA or M1)."
        )

    # Try 2-letter prefix first, then 1-letter
    council = POSTCODE_TO_COUNCIL.get(prefix)
    if not council and len(prefix) > 1:
        council = POSTCODE_TO_COUNCIL.get(prefix[0])

    local_services: List[Dict[str, str]] = []

    if council:
        local_services.append({
            "name": council,
            "type": "local_council",
            "description": f"Your local council. Contact their housing department for environmental health complaints, homelessness applications, and housing advice.",
            "action": f"Search '{council} housing department' or call their main switchboard.",
        })
        local_services.append({
            "name": f"{council} — Environmental Health",
            "type": "environmental_health",
            "description": "Report unsafe housing conditions (damp, mould, electrical hazards, pest infestations). They can inspect your property and issue improvement notices to your landlord.",
            "action": f"Search '{council} environmental health report' online.",
        })

    return {
        "postcode_searched": postcode.strip().upper(),
        "prefix": prefix,
        "local_council": council or "Not found — try entering a valid UK postcode",
        "local_services": local_services,
        "national_helplines": NATIONAL_HELPLINES,
        "note": (
            "If your council is not listed, search GOV.UK for 'find your local council' "
            "with your full postcode."
        ),
    }


@router.get("/helplines")
def list_helplines() -> Dict[str, Any]:
    """Return all national housing helplines. No authentication required."""
    return {"helplines": NATIONAL_HELPLINES}
