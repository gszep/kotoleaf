import uuid
from datetime import datetime

from app.db.firestore import get_client
from app.models.session import CreateSessionRequest, Session


async def create_session(user_id: str, request: CreateSessionRequest) -> Session:
    db = get_client()
    session = Session(
        id=uuid.uuid4().hex,
        created_by=user_id,
        participants=[user_id],
        register=request.register,
        audio_source=request.audio_source,
        summarization_config=request.summarization_config,
    )
    await db.collection("sessions").document(session.id).set(
        session.model_dump(mode="json")
    )
    return session


async def get_session(session_id: str) -> dict | None:
    db = get_client()
    doc = await db.collection("sessions").document(session_id).get()
    return doc.to_dict() if doc.exists else None


async def end_session(session_id: str) -> None:
    db = get_client()
    await db.collection("sessions").document(session_id).update(
        {"status": "ended", "ended_at": datetime.utcnow()}
    )


async def rate_session(session_id: str, rating: int) -> None:
    db = get_client()
    await db.collection("sessions").document(session_id).update({"rating": rating})


async def save_summary(session_id: str, summary_data: dict) -> str:
    db = get_client()
    summary_id = uuid.uuid4().hex
    summary_data["created_at"] = datetime.utcnow()
    await (
        db.collection("sessions")
        .document(session_id)
        .collection("summaries")
        .document(summary_id)
        .set(summary_data)
    )
    return summary_id


async def save_speaker_map(session_id: str, speaker_map: dict[str, str]) -> None:
    db = get_client()
    await db.collection("sessions").document(session_id).update(
        {"speaker_map": speaker_map}
    )


async def list_sessions(user_id: str) -> list[dict]:
    db = get_client()
    docs = (
        db.collection("sessions")
        .where("participants", "array_contains", user_id)
        .order_by("started_at", direction="DESCENDING")
        .limit(50)
    )
    return [doc.to_dict() async for doc in docs.stream()]
