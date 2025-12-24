from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    ENV: str = "development"
    OPENAI_API_KEY: str

    class Config:
        env_file = ".env"


settings = Settings()
