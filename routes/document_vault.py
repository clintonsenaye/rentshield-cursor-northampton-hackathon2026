"""
Document Vault with Versioning — typed document storage with version chains.

Tenants and landlords can upload and manage important housing documents
(tenancy agreements, inventories, correspondence) with version tracking.
Each new upload of the same document type creates a new version in the chain.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from database.connection import get_database
from utils.auth import require_role

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/vault", tags=["document_vault"])

# Allowed document types
DOCUMENT_TYPES = [
    "tenancy_agreement",
    "inventory",
    "gas_safety_certificate",
    "epc",
    "eicr",
    "deposit_certificate",
    "rent_statement",
    "correspondence",
    "section_8_notice",
    "section_13_notice",
    "council_letter",
    "court_document",
    "photo_evidence",
    "other",
]

DOCUMENT_TYPE_LABELS = {
    "tenancy_agreement": "Tenancy Agreement",
    "inventory": "Inventory / Check-in Report",
    "gas_safety_certificate": "Gas Safety Certificate",
    "epc": "Energy Performance Certificate",
    "eicr": "Electrical Safety Report (EICR)",
    "deposit_certificate": "Deposit Protection Certificate",
    "rent_statement": "Rent Statement",
    "correspondence": "Correspondence",
    "section_8_notice": "Section 8 Notice",
    "section_13_notice": "Section 13 Notice",
    "council_letter": "Council / Local Authority Letter",
    "court_document": "Court Document",
    "photo_evidence": "Photo Evidence",
    "other": "Other Document",
}


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class DocumentCreateRequest(BaseModel):
    """Create a new document entry in the vault."""
    doc_type: str = Field(..., description="Document type key")
    title: str = Field(..., min_length=1, max_length=200, description="Document title")
    description: Optional[str] = Field(None, max_length=2000, description="Description or notes")
    content_text: Optional[str] = Field(None, max_length=50000, description="Document text content (if not a file)")
    file_url: Optional[str] = Field(None, max_length=500, description="URL to uploaded file")
    tags: Optional[List[str]] = Field(default_factory=list, description="Tags for organisation")


class DocumentResponse(BaseModel):
    """A single document with version info."""
    document_id: str
    user_id: str
    doc_type: str
    doc_type_label: str
    title: str
    description: Optional[str]
    content_text: Optional[str]
    file_url: Optional[str]
    tags: List[str]
    version: int
    version_chain_id: str
    created_at: str
    updated_at: str


class DocumentListResponse(BaseModel):
    """List of documents in the vault."""
    documents: List[DocumentResponse]
    total: int


class VersionHistoryResponse(BaseModel):
    """All versions of a document chain."""
    version_chain_id: str
    doc_type: str
    versions: List[DocumentResponse]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=DocumentResponse)
def create_document(
    request: DocumentCreateRequest,
    authorization: str = Header(""),
) -> DocumentResponse:
    """Create a new document or a new version of an existing document type."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    if request.doc_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid document type. Allowed: {', '.join(DOCUMENT_TYPES)}")

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    now = datetime.now(timezone.utc).isoformat()
    user_id = user["user_id"]

    # Check if there's an existing version chain for this doc type
    latest = db["document_vault"].find_one(
        {"user_id": user_id, "doc_type": request.doc_type},
        {"_id": 0},
        sort=[("version", -1)],
    )

    if latest:
        version_chain_id = latest["version_chain_id"]
        version = latest["version"] + 1
    else:
        version_chain_id = str(uuid.uuid4())
        version = 1

    doc = {
        "document_id": str(uuid.uuid4()),
        "user_id": user_id,
        "doc_type": request.doc_type,
        "doc_type_label": DOCUMENT_TYPE_LABELS.get(request.doc_type, request.doc_type),
        "title": request.title.strip(),
        "description": request.description.strip() if request.description else None,
        "content_text": request.content_text,
        "file_url": request.file_url,
        "tags": request.tags or [],
        "version": version,
        "version_chain_id": version_chain_id,
        "created_at": now,
        "updated_at": now,
    }

    db["document_vault"].insert_one(doc)

    return DocumentResponse(**{k: v for k, v in doc.items() if k != "_id"})


@router.get("", response_model=DocumentListResponse)
def list_documents(
    doc_type: Optional[str] = Query(None, description="Filter by document type"),
    authorization: str = Header(""),
) -> DocumentListResponse:
    """List all documents in the user's vault (latest version of each chain)."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    query: Dict[str, Any] = {"user_id": user["user_id"]}
    if doc_type:
        query["doc_type"] = doc_type

    all_docs = list(
        db["document_vault"]
        .find(query, {"_id": 0})
        .sort("created_at", -1)
        .limit(500)
    )

    # Keep only the latest version per version_chain_id
    seen_chains: Dict[str, bool] = {}
    latest_docs: List[Dict] = []
    for doc in all_docs:
        chain_id = doc["version_chain_id"]
        if chain_id not in seen_chains:
            seen_chains[chain_id] = True
            latest_docs.append(doc)

    return DocumentListResponse(
        documents=[DocumentResponse(**d) for d in latest_docs],
        total=len(latest_docs),
    )


@router.get("/types")
def list_document_types(authorization: str = Header("")) -> List[Dict[str, str]]:
    """Return the list of allowed document types with labels."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    return [
        {"key": k, "label": DOCUMENT_TYPE_LABELS.get(k, k)}
        for k in DOCUMENT_TYPES
    ]


@router.get("/versions/{version_chain_id}", response_model=VersionHistoryResponse)
def get_version_history(
    version_chain_id: str,
    authorization: str = Header(""),
) -> VersionHistoryResponse:
    """Get all versions of a document chain."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    versions = list(
        db["document_vault"]
        .find(
            {"version_chain_id": version_chain_id, "user_id": user["user_id"]},
            {"_id": 0},
        )
        .sort("version", -1)
        .limit(50)
    )

    if not versions:
        raise HTTPException(status_code=404, detail="Document chain not found")

    return VersionHistoryResponse(
        version_chain_id=version_chain_id,
        doc_type=versions[0]["doc_type"],
        versions=[DocumentResponse(**v) for v in versions],
    )


@router.delete("/{document_id}")
def delete_document(
    document_id: str,
    authorization: str = Header(""),
) -> Dict[str, str]:
    """Delete a specific document version."""
    user, error = require_role(authorization, ["tenant", "landlord"])
    if error:
        raise HTTPException(status_code=401, detail=error)

    db = get_database()
    if db is None:
        raise HTTPException(status_code=503, detail="Database unavailable")

    doc = db["document_vault"].find_one(
        {"document_id": document_id, "user_id": user["user_id"]},
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    db["document_vault"].delete_one({"document_id": document_id})

    return {"status": "deleted", "document_id": document_id}
