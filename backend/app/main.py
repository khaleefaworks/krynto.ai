from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

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
from app import models  # Import models to register them with SQLAlchemy
from app.core.logging import setup_logging
from app.middleware.logging_middleware import LoggingMiddleware
from app.core.config import settings
from app.core.limiter import limiter
from app.core.database import engine
from pathlib import Path
from app.infra import realtime_bus
from app.core.worker_detection import detect_configured_worker_count
import os

# Setup structured logging
logger = setup_logging()
logger.info("application_starting", message="AI ChatAssist application initializing")
logger.info("realtime_bus_config", enabled=bool(realtime_bus.enabled))

configured_workers = detect_configured_worker_count(os.environ)
if configured_workers is not None:
    logger.info("worker_config", configured_workers=configured_workers)
    if configured_workers > 1 and not realtime_bus.enabled:
        logger.warning(
            "multi_worker_without_realtime_bus",
            configured_workers=configured_workers,
            message="Multiple workers configured but realtime bus is disabled. Set REDIS_URL for cross-worker WebSocket fanout.",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
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
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],  # Expose all headers to frontend
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

# Serve widget files statically
project_root = Path(__file__).resolve().parents[2]
widget_dir = project_root / "widget"
if not widget_dir.is_dir():
    raise RuntimeError(f"Widget directory '{widget_dir}' does not exist")
app.mount("/widget", StaticFiles(directory=str(widget_dir)), name="widget")

# Serve uploaded files (avatars, etc.)
uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")
