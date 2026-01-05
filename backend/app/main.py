from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.api.health import router as health_router
from app.api.ws_chat import router as ws_chat_router
from app.api.ws_agent import router as ws_agent_router
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
from app import models  # Import models to register them with SQLAlchemy
from app.core.logging import setup_logging
from app.middleware.logging_middleware import LoggingMiddleware
from app.core.config import settings

# Setup structured logging
logger = setup_logging()
logger.info("application_starting", message="AI ChatAssist application initializing")

# Setup rate limiter
limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])

app = FastAPI(title="AI ChatAssist")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Add logging middleware (before CORS)
app.add_middleware(LoggingMiddleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative dev port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://localhost:8080",  # Widget demo server
        "http://127.0.0.1:8080",
        "http://localhost:8000",  # Same origin (static widget)
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(system_router)
app.include_router(widget_router)
app.include_router(ws_chat_router)
app.include_router(ws_agent_router)
app.include_router(chats_router)
app.include_router(conversations_router)
app.include_router(conversation_metadata_router)
app.include_router(websites_router)
app.include_router(agent_assignments_router)
app.include_router(shortcuts_router)

# Serve widget files statically
app.mount("/widget", StaticFiles(directory="../widget"), name="widget")
