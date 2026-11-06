import warnings

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_config = {"env_prefix": "KOTOLEAF_", "env_file": ".env", "extra": "ignore"}

    # Deepgram
    deepgram_api_key: str = ""
    deepgram_model: str = "nova-3"
    deepgram_language: str = "multi"

    # Anthropic API
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5-20251001"

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:5173/auth/callback"
    allowed_domain: str = ""

    # JWT
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expiry_hours: int = 24

    # NOTE: Firestore connection (KOTOLEAF_GCP_PROJECT_ID / FIRESTORE_EMULATOR_HOST)
    # is read directly from the environment in app/db/firestore.py, not via these
    # settings. Summarization tuning lives in SummarizationConfig
    # (app/models/session.py) — the live source used by the trigger. Do not
    # re-add defaults for either here; nothing reads them.

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    environment: str = "development"


settings = Settings()

if settings.jwt_secret == "dev-secret-change-me" and settings.environment != "development":
    warnings.warn(
        "KOTOLEAF_JWT_SECRET is using the default value in a non-development environment. "
        "Set a strong secret via the KOTOLEAF_JWT_SECRET environment variable.",
        stacklevel=1,
    )
