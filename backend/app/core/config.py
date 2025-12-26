from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    ENV: str = "development"
    OPENAI_API_KEY: str
    SECRET_KEY: str = "your-secret-key-change-in-production-please"
    
    # Rate limiting settings
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = "100/minute"  # Default rate limit for API endpoints
    RATE_LIMIT_AUTH: str = "5/minute"  # Stricter limit for auth endpoints
    RATE_LIMIT_CHAT_MESSAGE: int = 10  # Max messages per minute per session

    class Config:
        env_file = ".env"


settings = Settings()
