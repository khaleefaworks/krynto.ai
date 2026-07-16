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
from app.api.conversation_metadata import router as conversation_metadata_router
from app.api.shortcuts import router as shortcuts_router
from app.api.push import router as push_router
from app.api.metrics import router as metrics_router
from app.api.tags import router as tags_router
from app.api.attachments import router as attachments_router
from app.api.automations import router as automations_router
from app.api.automation_templates import router as automation_templates_router
from app.api.customers import router as customers_router
from app.api.website_teams import router as website_teams_router
from app.api.website_shortcuts import router as website_shortcuts_router
from app.api.forms import router as forms_router
from app.api.teams_overview import router as teams_overview_router
from app.api.analytics import router as analytics_router
from app.api.ratings import router as ratings_router
from app.api.organization import router as organization_router
from app.api.admin import router as admin_router
from app.api.backups import router as backups_router
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
    from app.services.auto_close_scheduler import start_scheduler, stop_scheduler
    start_scheduler()

    # Reconcile any bot_only conversations that were left open due to a
    # process restart (lost asyncio tasks).
    #
    # This used to force-resolve every bot_only+OPEN conversation 1 second
    # after every restart, no matter how recently the visitor was active —
    # so a visitor sitting mid-flow (e.g. still reading the Careers sub-menu)
    # at the exact moment of a routine redeploy got their conversation ended
    # out from under them. Instead, re-arm each one for its *remaining* delay:
    # compute how much of the visitor_dropped abandonment window has already
    # elapsed since the conversation's last message, same as
    # _reconcile_new_chat_reminders() below re-arms PN1's loop rather than
    # firing it immediately. A conversation that's already well past the
    # window (task genuinely lost mid-countdown) resolves right away; one the
    # visitor is still actively in gets a fresh grace period instead of being
    # cut off by an unrelated backend restart.
    try:
        import asyncio as _asyncio
        from datetime import datetime as _datetime, timezone as _tz
        from app.core.database import SessionLocal as _SL
        from app.models.conversation import Conversation as _Conv, ConversationStatus as _CS
        from app.models.message import Message as _Msg
        from app.services.automation_service import AutomationService as _AS
        from app.services.conversation_orchestrator import _close_bot_conversation_after_delay

        def _reconcile_bot_conversations() -> None:
            with _SL() as _db:
                stale = (
                    _db.query(_Conv)
                    .filter(_Conv.bot_only == True, _Conv.status == _CS.OPEN)  # noqa: E712
                    .all()
                )
                now = _datetime.now(_tz.utc)
                for conv in stale:
                    last_msg_at = (
                        _db.query(_Msg.created_at)
                        .filter(_Msg.conversation_id == conv.id)
                        .order_by(_Msg.created_at.desc())
                        .limit(1)
                        .scalar()
                    )
                    last_activity = last_msg_at or conv.created_at
                    if last_activity is not None and last_activity.tzinfo is None:
                        last_activity = last_activity.replace(tzinfo=_tz.utc)
                    elapsed = (now - last_activity).total_seconds() if last_activity else 0

                    configured_delay = _AS(_db).get_delay_seconds(
                        website_id=int(conv.website_id),
                        trigger="visitor_dropped",
                        default_seconds=300,
                    )
                    remaining = max(1, int(configured_delay - elapsed))

                    _asyncio.get_event_loop().create_task(
                        _close_bot_conversation_after_delay(
                            conversation_id=conv.id,
                            website_id=int(conv.website_id),
                            delay_seconds=remaining,
                        )
                    )

        _reconcile_bot_conversations()
    except Exception:
        pass

    # Same problem, different loop: _repeat_new_chat_notification_until_claimed
    # (PN1) is also a plain asyncio task with no durable state, so a restart
    # silently kills the nag-until-claimed reminder for every still-unassigned
    # conversation it was running for. Re-schedule those here — reuses the same
    # per-website enable/interval logic the live path uses, no duplicated logic.
    #
    # Bounded to conversations created in the last hour: with no cleanup job
    # for ordinary (non-bot) abandoned conversations, "status=OPEN and
    # unassigned" alone matches every never-explicitly-resolved chat in the
    # table's entire history (18k+ on this DB) — an unbounded scan here spun
    # up thousands of reminder loops synchronously and froze startup. Only
    # conversations still recent enough to plausibly have had a live reminder
    # loop running at restart time actually need one resumed.
    try:
        from datetime import datetime as _dt2, timedelta as _td2, timezone as _tz2
        from app.core.database import SessionLocal as _SL2
        from app.models.conversation import Conversation as _Conv2, ConversationStatus as _CS2
        from app.models.message import Message as _Msg2, MessageSenderType as _MST2
        from app.services.conversation_orchestrator import ConversationOrchestrator as _CO2

        def _reconcile_new_chat_reminders() -> None:
            cutoff = _dt2.now(_tz2.utc) - _td2(hours=1)
            with _SL2() as _db2:
                # A reminder loop is only ever started (live path) once the
                # visitor's first message fires _broadcast_new_chat_to_agents —
                # so "has at least one visitor message" is exactly the signal
                # that this conversation actually had one running before the
                # restart. Without this check, a visitor who merely opened the
                # widget and never clicked/typed anything also matches
                # open+unassigned+recent, and gets a reminder loop it never had.
                _visitor_msg_exists = (
                    _db2.query(_Msg2.id)
                    .filter(_Msg2.conversation_id == _Conv2.id, _Msg2.sender_type == _MST2.VISITOR)
                    .exists()
                )
                unclaimed = (
                    _db2.query(_Conv2)
                    .filter(
                        _Conv2.status == _CS2.OPEN,
                        _Conv2.assigned_agent_id.is_(None),
                        _Conv2.visitor_ended == False,  # noqa: E712
                        _Conv2.bot_only == False,  # noqa: E712
                        _Conv2.created_at >= cutoff,
                        _visitor_msg_exists,
                    )
                    .limit(500)
                    .all()
                )
                orchestrator = _CO2(_db2)
                for conv in unclaimed:
                    orchestrator._maybe_schedule_new_chat_reminder(
                        conversation_id=conv.id, website_id=int(conv.website_id)
                    )

        _reconcile_new_chat_reminders()
    except Exception:
        pass

    # Seed automation library templates if the table is empty (idempotent).
    try:
        from seed_data import seed_automation_library
        seed_automation_library()
    except Exception:
        pass

    try:
        yield
    finally:
        stop_scheduler()
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
app.include_router(automation_templates_router)
app.include_router(customers_router)
app.include_router(website_teams_router)
app.include_router(website_shortcuts_router)
app.include_router(forms_router)
app.include_router(teams_overview_router)
app.include_router(analytics_router)
app.include_router(ratings_router)
app.include_router(organization_router)
app.include_router(admin_router)
app.include_router(backups_router)

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

# Serve notification sound files from frontend/public/sounds/
# The widget loads sounds via apiUrl + /sounds/<file>, so they must be on the backend.
sounds_dir = project_root / "frontend" / "public" / "sounds"
if sounds_dir.is_dir():
    app.mount("/sounds", StaticFiles(directory=str(sounds_dir)), name="sounds")
