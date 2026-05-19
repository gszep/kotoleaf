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

    # GCP / Firestore
    gcp_project_id: str = ""
    firestore_emulator_host: str = ""

    # CORS
    cors_origins: list[str] = ["http://localhost:5173"]

    # Summarization defaults
    summarization_utterance_threshold: int = 3
    summarization_min_words: int = 5
    summarization_min_duration_sec: float = 3.0
    summarization_max_interval_sec: float = 45.0
    summarization_cooldown_sec: float = 8.0

    # Audio buffer
    audio_buffer_duration_sec: int = 120

    # Kanji assist
    default_jlpt_threshold: str = "N1"

    environment: str = "development"


settings = Settings()
