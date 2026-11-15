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
    OFFICE_AUTH_REQUIRED: bool = False  # enables signed founder/admin checks for Office people management

    # Embeddings (unified memory, D-5): CLOUD ONLY (founder decision 2026-11-15: no model runs on this PC). Any OpenAI-compatible
    # /embeddings endpoint works (OpenAI, Gemini's OpenAI-compatible endpoint, Jina, Voyage...). Unset = memory recall is simply off.
    EMBEDDING_PROVIDER: str = "cloud"        # "cloud" or "none"
    EMBEDDING_BASE_URL: str = ""             # e.g. https://api.jina.ai/v1  (the key goes in the vault as EMBEDDING_API_KEY, or this env var)
    EMBEDDING_MODEL: str = ""                # the provider's model name
    EMBEDDING_API_KEY: str = ""

    # Server
    FASTAPI_PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:3001"

    # Google OAuth + Gmail
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/google/oauth/callback"

    # Local model fallback (LM Studio): OFF. Cloud models only (founder decision 2026-11-15); a rate-limited provider falls back to another CLOUD model.
    LOCAL_FALLBACK_URL:     str  = ""
    LOCAL_FALLBACK_MODEL:   str  = ""
    LOCAL_FALLBACK_ENABLED: bool = False

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
