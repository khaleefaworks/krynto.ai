from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    ENV: str = "development"
    OPENAI_API_KEY: str
    SECRET_KEY: str = "your-secret-key-change-in-production-please"

    class Config:
        env_file = ".env"


settings = Settings()
