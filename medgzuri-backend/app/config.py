"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration — reads from environment / .env file."""

    # Anthropic
    anthropic_api_key: str = ""
    claude_sonnet_model: str = "claude-sonnet-4-6"
    claude_opus_model: str = "claude-opus-4-6"

    # External APIs
    ncbi_api_key: str = ""

    # Database
    database_url: str = "postgresql+asyncpg://medgzuri:medgzuri@localhost:5432/medgzuri"

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Optional
    deepl_api_key: str = ""

    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    allowed_origins: str = "*"
    rate_limit_per_minute: int = 20

    # Cache TTLs (seconds)
    cache_ttl_clinical_trials: int = 86400      # 24 hours
    cache_ttl_pubmed: int = 604800              # 7 days
    cache_ttl_clinics: int = 2592000            # 30 days

    # LLM defaults
    llm_max_retries: int = 1
    llm_timeout_seconds: int = 60

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def has_anthropic_key(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def is_demo_mode(self) -> bool:
        return not self.has_anthropic_key

    @property
    def cors_origins(self) -> list[str]:
        if self.allowed_origins == "*":
            return ["*"]
        return [o.strip() for o in self.allowed_origins.split(",")]


settings = Settings()
