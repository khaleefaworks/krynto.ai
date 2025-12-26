from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.health import router as health_router
from app.api.ws_chat import router as ws_chat_router
from app.api.ws_agent import router as ws_agent_router
from app.api.chats import router as chats_router
from app.api.auth import router as auth_router
from app.api.knowledge import router as knowledge_router
from app.api.websites import router as websites_router
from app.api.agent_assignments import router as agent_assignments_router
from app import models  # Import models to register them with SQLAlchemy


app = FastAPI(title="AI ChatAssist")

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
app.include_router(ws_chat_router)
app.include_router(ws_agent_router)
app.include_router(chats_router)
app.include_router(knowledge_router)
app.include_router(websites_router)
app.include_router(agent_assignments_router)

# Serve widget files statically
app.mount("/widget", StaticFiles(directory="../widget"), name="widget")
