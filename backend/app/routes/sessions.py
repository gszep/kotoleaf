from fastapi import APIRouter, Depends, HTTPException, WebSocket
from pydantic import BaseModel, Field

from app.auth import get_current_user, verify_jwt
from app.db.sessions import (
    create_session,
    end_session,
    get_session,
    list_sessions,
    rate_session,
)
from app.models.session import CreateSessionRequest, Register, SummarizationConfig
from app.ws.session_handler import SessionHandler

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("")
async def create(
    request: CreateSessionRequest,
    user: dict = Depends(get_current_user),
):
    session = await create_session(user["sub"], request)
    return session.model_dump(mode="json")


@router.get("")
async def list_all(user: dict = Depends(get_current_user)):
    return await list_sessions(user["sub"])


@router.get("/{session_id}")
async def get(session_id: str, user: dict = Depends(get_current_user)):
    session = await get_session(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return session


@router.post("/{session_id}/end")
async def end(session_id: str, user: dict = Depends(get_current_user)):
    await end_session(session_id)
    return {"status": "ended"}


class RateRequest(BaseModel):
    rating: int = Field(ge=1, le=5)


@router.post("/{session_id}/rate")
async def rate(
    session_id: str,
    request: RateRequest,
    user: dict = Depends(get_current_user),
):
    await rate_session(session_id, request.rating)
    return {"status": "rated"}


@router.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    await websocket.accept()

    # First message must be auth
    try:
        init_data = await websocket.receive_json()
        if init_data.get("type") != "start_session":
            await websocket.close(code=4001, reason="Expected start_session message")
            return

        token = init_data.get("token", "")
        user = verify_jwt(token)
    except Exception:
        await websocket.close(code=4001, reason="Authentication failed")
        return

    session_data = await get_session(session_id)
    if not session_data:
        # In dev/memory mode, create the session on the fly
        from app.models.session import CreateSessionRequest
        session = await create_session(user["sub"], CreateSessionRequest())
        session_data = session.model_dump(mode="json")

    handler = SessionHandler(
        websocket=websocket,
        session_id=session_id,
        user_id=user["sub"],
        register=Register(session_data.get("register", "workplace_polite")),
        config=SummarizationConfig(**session_data.get("summarization_config", {})),
        jlpt_threshold=init_data.get("jlpt_threshold", "N1"),
    )
    await handler.run()
