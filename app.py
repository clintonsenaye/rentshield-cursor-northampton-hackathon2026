"""
RentShield - AI-Powered UK Renters' Rights Navigator.

Main FastAPI application entry point.

This module initializes the FastAPI app, sets up middleware, registers routes,
and handles application lifecycle.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import get_settings
from database.connection import close_database_connection, initialize_database, get_database, get_mongo_client
from routes import (
    admin_analytics, agreement, analytics, case_export, chat, compliance,
    dashboard, deadline_tracker, deposit, dispute_assessor, document_vault,
    evidence, evidence_guide, gdpr, knowledge, letters, local_authority,
    maintenance, messaging, notice, notice_calculator, notifications,
    panic_button, perks, quiz, reminders, rent_comparator, reputation,
    rewards, scenario_simulator, tasks, timeline, tts, users, wellbeing,
)

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)

# Rate limiter instance (shared across the app)
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Handles startup and shutdown tasks:
    - Startup: Initialize database connection
    - Shutdown: Close database connection
    """
    # Startup
    logger.info("Starting RentShield application...")

    # Initialize database connection
    db_connected = initialize_database()
    if not db_connected:
        logger.warning("Database connection failed - some features may be unavailable")

    logger.info("RentShield application started successfully")

    yield

    # Shutdown
    logger.info("Shutting down RentShield application...")
    close_database_connection()
    logger.info("RentShield application shut down")


# Initialize FastAPI app with settings
settings = get_settings()

app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="AI-powered UK Renters' Rights Navigator for the Renters' Rights Act 2025",
    lifespan=lifespan,
)

# Attach rate limiter to app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# HTTPS redirect in production (controlled by env var)
if os.getenv("FORCE_HTTPS", "").lower() in ("1", "true", "yes"):
    app.add_middleware(HTTPSRedirectMiddleware)

# Add CORS middleware with configurable origins (default: same-origin only)
_cors_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [o.strip() for o in _cors_env.split(",") if o.strip()] if _cors_env else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=bool(allowed_origins),
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)

# Security headers middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://cdnjs.cloudflare.com 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob: data:; "
            "connect-src 'self'; "
            "font-src 'self'; "
            "frame-ancestors 'none'"
        )
        return response

app.add_middleware(SecurityHeadersMiddleware)

# Register API routes
app.include_router(chat.router)
app.include_router(notice.router)
app.include_router(tts.router)
app.include_router(analytics.router)
app.include_router(wellbeing.router)
app.include_router(rewards.router)
app.include_router(users.router)
app.include_router(tasks.router)
app.include_router(perks.router)
app.include_router(evidence.router)
app.include_router(timeline.router)
app.include_router(letters.router)
app.include_router(agreement.router)
app.include_router(deposit.router)
app.include_router(maintenance.router)
app.include_router(compliance.router)
app.include_router(knowledge.router)
app.include_router(evidence_guide.router)
app.include_router(admin_analytics.router)
app.include_router(dashboard.router)
app.include_router(case_export.router)
app.include_router(notifications.router)
app.include_router(notice_calculator.router)
app.include_router(gdpr.router)
app.include_router(local_authority.router)
app.include_router(quiz.router)
app.include_router(reputation.router)
app.include_router(document_vault.router)
app.include_router(dispute_assessor.router)
app.include_router(messaging.router)
app.include_router(rent_comparator.router)
app.include_router(deadline_tracker.router)
app.include_router(scenario_simulator.router)
app.include_router(reminders.router)
app.include_router(panic_button.router)

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def root() -> FileResponse:
    """
    Serve the main frontend HTML file.

    Returns:
        FileResponse: The index.html file

    Raises:
        HTTPException: If index.html is not found
    """
    index_path = os.path.join("static", "index.html")

    if not os.path.exists(index_path):
        logger.error("Frontend file not found: %s", index_path)
        raise HTTPException(
            status_code=404,
            detail="Frontend not found. Ensure static/index.html exists.",
        )

    return FileResponse(index_path)


@app.get("/health")
def health_check() -> dict:
    """
    Health check endpoint.

    Checks database connectivity and provides detailed status.

    Returns:
        dict: Health status including database and service statuses
    """
    db = get_database()
    client = get_mongo_client()

    db_healthy = False
    if client is not None:
        try:
            client.admin.command("ping")
            db_healthy = True
        except Exception:
            db_healthy = False

    # Check AI service configuration
    ai_configured = bool(settings.minimax_api_key and settings.minimax_api_base)

    status = "healthy" if db_healthy else "degraded"

    return {
        "status": status,
        "database_connected": db_healthy,
        "ai_service_configured": ai_configured,
        "version": settings.app_version,
    }


if __name__ == "__main__":
    import uvicorn

    _settings = get_settings()

    uvicorn.run(
        "app:app",
        host=_settings.app_host,
        port=_settings.app_port,
        reload=os.getenv("RELOAD", "false").lower() in ("1", "true", "yes"),
        log_level="info",
    )
