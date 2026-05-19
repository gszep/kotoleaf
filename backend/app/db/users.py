from datetime import datetime

from app.db.firestore import get_client


async def get_or_create_user(
    user_id: str,
    email: str,
    display_name: str,
) -> dict:
    db = get_client()
    doc_ref = db.collection("users").document(user_id)
    doc = await doc_ref.get()

    if doc.exists:
        return doc.to_dict()  # type: ignore[return-value]

    user_data = {
        "email": email,
        "display_name": display_name,
        "native_language": "en",
        "jlpt_threshold": "N1",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    await doc_ref.set(user_data)
    return user_data


async def get_user(user_id: str) -> dict | None:
    db = get_client()
    doc = await db.collection("users").document(user_id).get()
    return doc.to_dict() if doc.exists else None


async def update_user(user_id: str, updates: dict) -> None:
    db = get_client()
    updates["updated_at"] = datetime.utcnow()
    await db.collection("users").document(user_id).update(updates)
