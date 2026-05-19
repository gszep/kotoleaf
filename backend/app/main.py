import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import auth, sessions, settings as settings_routes
from app.tongue.kanji_assist import init_tagger, load_jlpt_data

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_tagger()
    load_jlpt_data()
    logger.info("Kotoleaf server started")
    yield
    logger.info("Kotoleaf server shutting down")


app = FastAPI(title="Kotoleaf", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(settings_routes.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "kotoleaf"}
