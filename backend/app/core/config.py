from pathlib import Path

from pydantic_settings import BaseSettings
from typing import List, Optional


class Settings(BaseSettings):
    DATABASE_URL: str
    ENV: str = "development"
    # SECURITY: must be explicitly set for production.
    SECRET_KEY: str = ""

    # Optional - Redis (Pub/Sub for multi-worker WebSocket routing)
    REDIS_URL: str = ""

    # Optional - Web Push (VAPID)
    # Public key is safe to expose to clients.
    VAPID_PUBLIC_KEY: str = ""
    # Private key must never be exposed to clients.
    VAPID_PRIVATE_KEY: str = ""
    # RFC 8292: must be a URL or a mailto:
    VAPID_SUBJECT: str = ""

    # Public base URL for generating widget loader/snippets (e.g. https://api.example.com)
    # If not set, endpoints will fall back to request.base_url.
    PUBLIC_BASE_URL: Optional[str] = None

    # Filesystem directory used to store uploaded files served under `/uploads/*`.
    # If unset, defaults to <repo-root>/uploads.
    UPLOADS_DIR: str = ""

    # CORS
    # Comma-separated list of allowed origins. In development, defaults are applied if empty.
    CORS_ALLOWED_ORIGINS: str = ""
    # Backward-compatible alias (older docs/envs)
    CORS_ORIGINS: str = ""
    
    # Rate limiting settings
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = "100/minute"  # Default rate limit for API endpoints
    RATE_LIMIT_AUTH: str = "5/minute"  # Stricter limit for auth endpoints
    RATE_LIMIT_CHAT_MESSAGE: int = 10  # Max messages per minute per session

    # Auth / JWT
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # Agent inactivity timeout (seconds)
    AGENT_INACTIVITY_TIMEOUT_SECONDS: int = 15 * 60  # 15 minutes

    def is_production(self) -> bool:
        env = (self.ENV or "").strip().lower()
        return env in {"production", "prod"} or env.startswith("prod")

    def cors_allow_origins(self) -> List[str]:
        raw = (self.CORS_ALLOWED_ORIGINS or "").strip()
        if not raw:
            raw = (self.CORS_ORIGINS or "").strip()
        if raw:
            return [o.strip() for o in raw.split(",") if o.strip()]

        # Reasonable non-production defaults (no wildcard).
        # Note: treat any non-production ENV as development-like for CORS,
        # otherwise unexpected values (e.g. "dev", "staging") would return [].
        if not self.is_production():
            return [
                "http://localhost:5173",
                "http://localhost:3000",
                "http://127.0.0.1:5173",
                "http://127.0.0.1:3000",
                "http://localhost:8080",
                "http://127.0.0.1:8080",
                "http://localhost:8000",
                "http://127.0.0.1:8000",
            ]

        return []

    class Config:
        # Load backend/.env regardless of the process working directory.
        # This avoids surprises when running from the repo root (PYTHONPATH=backend).
        env_file = str(Path(__file__).resolve().parents[2] / ".env")
        extra = "ignore"  # Ignore extra fields in .env (for backward compatibility)


settings = Settings()
