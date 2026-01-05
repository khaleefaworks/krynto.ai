from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    ENV: str = "development"
    SECRET_KEY: str = "your-secret-key-change-in-production-please"
    
    # Rate limiting settings
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = "100/minute"  # Default rate limit for API endpoints
    RATE_LIMIT_AUTH: str = "5/minute"  # Stricter limit for auth endpoints
    RATE_LIMIT_CHAT_MESSAGE: int = 10  # Max messages per minute per session
    
    # Agent inactivity timeout (seconds)
    AGENT_INACTIVITY_TIMEOUT_SECONDS: int = 15 * 60  # 15 minutes

    class Config:
        env_file = ".env"
        extra = "ignore"  # Ignore extra fields in .env (for backward compatibility)


settings = Settings()
