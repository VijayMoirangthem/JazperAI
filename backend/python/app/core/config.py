from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENV: str = "development"

    # AI Provider
    AI_BASE_URL: str = "http://localhost:1234/v1"
    AI_API_KEY: str = "lm-studio"
    AI_MODEL: str = "qwen/qwen3.5-9b"

    # PostgreSQL
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "123456"
    POSTGRES_DB: str = "SirJazper"

    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = "changeme"

    # MinIO
    MINIO_HOST: str = "localhost"
    MINIO_PORT: int = 9000
    MINIO_ROOT_USER: str = "sirjazper"
    MINIO_ROOT_PASSWORD: str = "changeme"
    MINIO_BUCKET: str = "sirjazper"

    # Server
    FASTAPI_PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:3000"

    # Google OAuth + Gmail
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/google/oauth/callback"

    # Search
    TAVILY_API_KEY: str = ""
    BRAVE_API_KEY: str = ""
    GOOGLE_CUSTOM_SEARCH_API: str = ""
    GOOGLE_CSE_ID: str = ""
    EXA_AI_API_KEY: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
