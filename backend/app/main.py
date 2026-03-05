from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Import models as early as possible so SQLAlchemy metadata includes
# every table before any routers/services touch the ORM.
from app import models  # noqa: F401

from app.api.health import router as health_router
from app.api.ws_chat import router as ws_chat_router
from app.api.ws_agent import router as ws_agent_router
from app.api.ws_presence import router as ws_presence_router
from app.api.chats import router as chats_router
from app.api.conversations import router as conversations_router
from app.api.auth import router as auth_router
from app.api.users import router as users_router
from app.api.widget import router as widget_router
from app.api.websites import router as websites_router
from app.api.agent_assignments import router as agent_assignments_router
from app.api.system import router as system_router
from app.api.conversation_metadata import router as conversation_metadata_router
from app.api.shortcuts import router as shortcuts_router
from app.api.push import router as push_router
from app.api.metrics import router as metrics_router
from app.api.tags import router as tags_router
from app.api.attachments import router as attachments_router
from app.api.automations import router as automations_router
from app.api.customers import router as customers_router
from app.api.website_teams import router as website_teams_router
from app.api.website_shortcuts import router as website_shortcuts_router
from app.api.teams_overview import router as teams_overview_router
from app.api.analytics import router as analytics_router
from app.api.ratings import router as ratings_router
from app.core.logging import setup_logging
from app.middleware.logging_middleware import LoggingMiddleware
from app.core.config import settings
from app.core.limiter import limiter
from app.core.database import engine
from pathlib import Path
from app.infra import realtime_bus
from app.core.worker_detection import detect_configured_worker_count
import os
from typing import cast

from starlette.requests import Request
from starlette.responses import Response

# Setup structured logging
logger = setup_logging()
logger.info("application_starting", message="AI ChatAssist application initializing")
logger.info("realtime_bus_config", enabled=bool(realtime_bus.enabled))

configured_workers = detect_configured_worker_count(os.environ)
if configured_workers is not None:
    logger.info("worker_config", configured_workers=configured_workers)
    if configured_workers > 1 and not realtime_bus.enabled:
        if settings.is_production():
            raise RuntimeError(
                "REDIS_URL must be set in production when running multiple workers. "
                "WebSocket delivery requires Redis Pub/Sub for cross-worker fanout."
            )
        logger.warning(
            "multi_worker_without_realtime_bus",
            configured_workers=configured_workers,
            message="Multiple workers configured but realtime bus is disabled. Set REDIS_URL for cross-worker WebSocket fanout.",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enforce Postgres for development/runtime.
    # Tests explicitly set ENV=test and use SQLite in-memory.
    if (not settings.is_production()) and (settings.ENV or "").strip().lower() != "test":
        if str(settings.DATABASE_URL or "").startswith("sqlite"):
            raise RuntimeError(
                "SQLite is not supported for development. Install PostgreSQL and set DATABASE_URL "
                "(e.g. postgresql+psycopg2://chatassist:chatassist@localhost:5432/chatassist), "
                "then run: alembic upgrade head"
            )

    async def _handle_event(event: dict) -> None:
        # Dispatch to local websocket registries.
        from app.services.agent_service import AgentService
        from app.services.chat_service import ChatService

        await AgentService.deliver_bus_event(event)
        await ChatService.deliver_bus_event(event)

    await realtime_bus.start(_handle_event)
    try:
        yield
    finally:
        await realtime_bus.stop()


app = FastAPI(title="AI ChatAssist", lifespan=lifespan)
app.state.limiter = limiter


def _rate_limit_handler(request: Request, exc: Exception) -> Response:
    # FastAPI's typing expects `Exception`, but this handler is only registered
    # for `RateLimitExceeded` so runtime will always pass that type.
    return _rate_limit_exceeded_handler(request, cast(RateLimitExceeded, exc))


app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

# Add logging middleware (before CORS)
app.add_middleware(LoggingMiddleware)

# Configure CORS - Allow all origins in development for easier debugging
# In production, restrict to specific domains
cors_origins = settings.cors_allow_origins()
if settings.is_production():
    if not cors_origins:
        raise RuntimeError("CORS_ALLOWED_ORIGINS (or legacy CORS_ORIGINS) must be set in production")
    if any(o.strip() == "*" for o in cors_origins):
        raise RuntimeError("CORS allowed origins cannot include '*' in production")
    if not (settings.SECRET_KEY or "").strip():
        raise RuntimeError("SECRET_KEY must be set in production")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    # Auth uses Bearer tokens (Authorization header), not cookies.
    # Disabling credentials is safer when allowing broad origins.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],  # Expose all headers to frontend
    # Widgets are embedded on arbitrary customer domains and use fetch() which
    # requires CORS. Restricting CORS purely via static env lists breaks embeds.
    # Security is still enforced server-side via per-website Origin/Referer checks.
    allow_origin_regex=r"^https?://.+$",
)


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(system_router)
app.include_router(widget_router)
app.include_router(ws_chat_router)
app.include_router(ws_agent_router)
app.include_router(ws_presence_router)
app.include_router(chats_router)
app.include_router(conversations_router)
app.include_router(conversation_metadata_router)
app.include_router(websites_router)
app.include_router(agent_assignments_router)
app.include_router(shortcuts_router)
app.include_router(push_router)
app.include_router(metrics_router)
app.include_router(tags_router)
app.include_router(attachments_router)
app.include_router(automations_router)
app.include_router(customers_router)
app.include_router(website_teams_router)
app.include_router(website_shortcuts_router)
app.include_router(teams_overview_router)
app.include_router(analytics_router)
app.include_router(ratings_router)

# Serve widget files statically
project_root = Path(__file__).resolve().parents[2]
widget_dir = project_root / "widget"
if not widget_dir.is_dir():
    raise RuntimeError(f"Widget directory '{widget_dir}' does not exist")
app.mount("/widget", StaticFiles(directory=str(widget_dir)), name="widget")

# Serve uploaded files (avatars, etc.)
# NOTE: Upload endpoints write into the repo-root `uploads/` folder.
# Mount that same folder so returned `/uploads/...` URLs resolve.
from app.core.uploads import get_uploads_root

uploads_dir = get_uploads_root()
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
