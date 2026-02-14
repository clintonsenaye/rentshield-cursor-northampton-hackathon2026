"""
Rent Affordability Comparator — helps tenants challenge unfair rent increases.

Provides regional average rent data (based on ONS/VOA published figures) so
tenants can compare their rent against local averages when challenging a
Section 13 rent increase at a First-tier Tribunal.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rent-comparator", tags=["rent_comparator"])


# ---------------------------------------------------------------------------
# Regional rent data (ONS Private Rental Market Statistics, 2024)
# Source: https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/
#         indexofprivatehousingrentalprices/
# ---------------------------------------------------------------------------

REGIONAL_RENTS: Dict[str, Dict[str, Any]] = {
    "london": {
        "region": "London",
        "median_rent_pcm": 1500,
        "lower_quartile_pcm": 1200,
        "upper_quartile_pcm": 2000,
        "one_bed_avg": 1350,
        "two_bed_avg": 1600,
        "three_bed_avg": 1950,
        "annual_increase_pct": 7.7,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "south_east": {
        "region": "South East",
        "median_rent_pcm": 1050,
        "lower_quartile_pcm": 850,
        "upper_quartile_pcm": 1350,
        "one_bed_avg": 900,
        "two_bed_avg": 1100,
        "three_bed_avg": 1350,
        "annual_increase_pct": 6.5,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "south_west": {
        "region": "South West",
        "median_rent_pcm": 875,
        "lower_quartile_pcm": 700,
        "upper_quartile_pcm": 1100,
        "one_bed_avg": 725,
        "two_bed_avg": 900,
        "three_bed_avg": 1100,
        "annual_increase_pct": 6.0,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "east_of_england": {
        "region": "East of England",
        "median_rent_pcm": 950,
        "lower_quartile_pcm": 775,
        "upper_quartile_pcm": 1200,
        "one_bed_avg": 800,
        "two_bed_avg": 1000,
        "three_bed_avg": 1200,
        "annual_increase_pct": 6.2,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "east_midlands": {
        "region": "East Midlands",
        "median_rent_pcm": 725,
        "lower_quartile_pcm": 600,
        "upper_quartile_pcm": 900,
        "one_bed_avg": 600,
        "two_bed_avg": 750,
        "three_bed_avg": 900,
        "annual_increase_pct": 5.8,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "west_midlands": {
        "region": "West Midlands",
        "median_rent_pcm": 750,
        "lower_quartile_pcm": 625,
        "upper_quartile_pcm": 950,
        "one_bed_avg": 625,
        "two_bed_avg": 775,
        "three_bed_avg": 950,
        "annual_increase_pct": 5.9,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "north_west": {
        "region": "North West",
        "median_rent_pcm": 700,
        "lower_quartile_pcm": 575,
        "upper_quartile_pcm": 875,
        "one_bed_avg": 575,
        "two_bed_avg": 725,
        "three_bed_avg": 900,
        "annual_increase_pct": 5.5,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "north_east": {
        "region": "North East",
        "median_rent_pcm": 575,
        "lower_quartile_pcm": 475,
        "upper_quartile_pcm": 700,
        "one_bed_avg": 475,
        "two_bed_avg": 600,
        "three_bed_avg": 725,
        "annual_increase_pct": 4.8,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "yorkshire_and_humber": {
        "region": "Yorkshire and The Humber",
        "median_rent_pcm": 650,
        "lower_quartile_pcm": 525,
        "upper_quartile_pcm": 825,
        "one_bed_avg": 525,
        "two_bed_avg": 675,
        "three_bed_avg": 850,
        "annual_increase_pct": 5.2,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
    "wales": {
        "region": "Wales",
        "median_rent_pcm": 625,
        "lower_quartile_pcm": 500,
        "upper_quartile_pcm": 775,
        "one_bed_avg": 500,
        "two_bed_avg": 650,
        "three_bed_avg": 800,
        "annual_increase_pct": 5.0,
        "source": "ONS Index of Private Housing Rental Prices, 2024",
    },
}


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class RentComparisonRequest(BaseModel):
    """Request to compare current rent against regional averages."""
    current_rent_pcm: float = Field(..., gt=0, le=50000, description="Current monthly rent in GBP")
    proposed_rent_pcm: Optional[float] = Field(None, gt=0, le=50000, description="Proposed new rent (if increase)")
    region: str = Field(..., min_length=1, max_length=50, description="Region key")
    bedrooms: Optional[int] = Field(None, ge=1, le=5, description="Number of bedrooms")


class RentComparisonResponse(BaseModel):
    """Result of rent comparison analysis."""
    current_rent_pcm: float
    proposed_rent_pcm: Optional[float]
    region: str
    regional_median: float
    regional_lower_quartile: float
    regional_upper_quartile: float
    bedroom_average: Optional[float]
    annual_increase_pct: float
    source: str
    current_vs_median_pct: float
    proposed_vs_median_pct: Optional[float]
    increase_pct: Optional[float]
    assessment: str
    tribunal_advice: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/regions")
def list_regions(authorization: str = Header("")) -> List[Dict[str, str]]:
    """Return the list of available regions."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return [
        {"key": k, "label": v["region"]}
        for k, v in REGIONAL_RENTS.items()
    ]


@router.post("/compare", response_model=RentComparisonResponse)
def compare_rent(
    request: RentComparisonRequest,
    authorization: str = Header(""),
) -> RentComparisonResponse:
    """Compare current/proposed rent against regional market data."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    region_key = request.region.lower().replace(" ", "_")
    region_data = REGIONAL_RENTS.get(region_key)
    if not region_data:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown region. Available: {', '.join(REGIONAL_RENTS.keys())}",
        )

    median = region_data["median_rent_pcm"]
    lq = region_data["lower_quartile_pcm"]
    uq = region_data["upper_quartile_pcm"]
    annual_inc = region_data["annual_increase_pct"]
    source = region_data["source"]

    # Bedroom-specific average
    bedroom_avg = None
    if request.bedrooms:
        bed_key = {1: "one_bed_avg", 2: "two_bed_avg", 3: "three_bed_avg"}.get(request.bedrooms)
        if bed_key:
            bedroom_avg = region_data.get(bed_key)

    # Calculate percentages
    current_vs_median = round(((request.current_rent_pcm - median) / median) * 100, 1)

    proposed_vs_median = None
    increase_pct = None
    if request.proposed_rent_pcm:
        proposed_vs_median = round(((request.proposed_rent_pcm - median) / median) * 100, 1)
        increase_pct = round(
            ((request.proposed_rent_pcm - request.current_rent_pcm) / request.current_rent_pcm) * 100, 1
        )

    # Generate assessment
    ref_rent = request.proposed_rent_pcm or request.current_rent_pcm
    if ref_rent <= lq:
        assessment = "Your rent is below the lower quartile for this region — it's lower than 75% of comparable properties."
    elif ref_rent <= median:
        assessment = "Your rent is below the regional median — it's competitively priced."
    elif ref_rent <= uq:
        assessment = "Your rent is above the median but within the upper quartile — this is within market range."
    else:
        assessment = "Your rent is above the upper quartile — it's higher than 75% of comparable properties in this region."

    # Tribunal advice
    if request.proposed_rent_pcm:
        if increase_pct and increase_pct > annual_inc * 2:
            tribunal_advice = (
                f"The proposed increase of {increase_pct}% is significantly above the regional average increase "
                f"of {annual_inc}%. You may have strong grounds to challenge this at a First-tier Tribunal. "
                f"Under the Renters' Rights Act 2025, rent increases must follow the Section 13 process "
                f"and the tribunal will consider local market rates."
            )
        elif increase_pct and increase_pct > annual_inc:
            tribunal_advice = (
                f"The proposed increase of {increase_pct}% is above the regional average of {annual_inc}%. "
                f"Consider whether local factors justify this. You can challenge at a First-tier Tribunal "
                f"if you believe it's above market rate."
            )
        else:
            tribunal_advice = (
                f"The proposed increase is within or below the regional average increase of {annual_inc}%. "
                f"While you can still challenge it at tribunal, the increase appears to be in line with the market."
            )
    else:
        if ref_rent > uq:
            tribunal_advice = (
                "Your current rent is above the upper quartile for the region. If you receive a rent increase, "
                "you may have grounds to challenge it at a First-tier Tribunal."
            )
        else:
            tribunal_advice = (
                "Your current rent appears to be within market range for your region. "
                "Keep this data for reference if you receive a future rent increase."
            )

    return RentComparisonResponse(
        current_rent_pcm=request.current_rent_pcm,
        proposed_rent_pcm=request.proposed_rent_pcm,
        region=region_data["region"],
        regional_median=median,
        regional_lower_quartile=lq,
        regional_upper_quartile=uq,
        bedroom_average=bedroom_avg,
        annual_increase_pct=annual_inc,
        source=source,
        current_vs_median_pct=current_vs_median,
        proposed_vs_median_pct=proposed_vs_median,
        increase_pct=increase_pct,
        assessment=assessment,
        tribunal_advice=tribunal_advice,
    )
