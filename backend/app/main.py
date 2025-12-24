from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.ws_chat import router as ws_chat_router
from app import models  # Import models to register them with SQLAlchemy


app = FastAPI(title="AI ChatAssist")


app.include_router(health_router)
app.include_router(ws_chat_router)
