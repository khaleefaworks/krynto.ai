from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool

from app.core.config import settings

database_url = settings.DATABASE_URL

engine_kwargs: dict = {"pool_pre_ping": True}

# SQLite needs special handling for multi-threaded access (Starlette TestClient)
# and for in-memory DBs where each connection would otherwise get a new empty DB.
if database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
    if ":memory:" in database_url:
        engine_kwargs["poolclass"] = StaticPool

engine = create_engine(database_url, **engine_kwargs)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # Create tables for all models
    Base.metadata.create_all(bind=engine)
