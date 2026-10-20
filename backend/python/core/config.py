from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENV: str = "development"

    # AI Provider
    AI_BASE_URL: str = "https://api.groq.com/openai/v1"  # Groq free tier by default; any OpenAI-compatible URL works
    AI_API_KEY: str = ""
    AI_API_KEY2: str = ""
    AI_API_KEY3: str = ""
    AI_MODEL: str = "qwen/qwen3.8-27b"

    # PostgreSQL
    POSTGRES_HOST: str = "127.0.0.1"
    POSTGRES_PORT: int = 5433
    POSTGRES_USER: str = "sirjazper"
    POSTGRES_PASSWORD: str  # required — no default (P1-02)
    POSTGRES_DB: str = "coos"

    # Redis
    REDIS_HOST: str = "127.0.0.1"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str  # required — no default (P1-02)

    # MinIO
    MINIO_HOST: str = "localhost"
    MINIO_PORT: int = 9000
    MINIO_ROOT_USER: str = "sirjazper"
    MINIO_ROOT_PASSWORD: str = ""
    MINIO_BUCKET: str = "sirjazper"

    # LLM tiers (D-6). LIGHT_MODEL is used by legacy OpenAI-compatible call sites until they move to core.llm
    LIGHT_MODEL: str = "openai/gpt-oss-20b"
    EDGE_MODE: bool = False  # local models only allowed when true
    WS_TOKEN: str = ""  # when set, /ws/rpc requires ?token=

    # Embeddings (unified memory, D-5)
    EMBEDDING_PROVIDER: str = "local"
    EMBEDDING_MODEL: str = "BAAI/bge-m3"

    # Server
    FASTAPI_PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:3001"

    # Google OAuth + Gmail
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/google/oauth/callback"

    # Local model fallback (LM Studio) — used when all Groq keys are rate-limited
    LOCAL_FALLBACK_URL:     str  = "http://localhost:1234/v1"
    LOCAL_FALLBACK_MODEL:   str  = "lmstudio-community/qwen2.5-3b-instruct"
    LOCAL_FALLBACK_ENABLED: bool = True

    # Claude / Anthropic (used by Oracle + IT Dept for reasoning/code tasks)
    CLAUDE_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"

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
