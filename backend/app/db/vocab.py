from datetime import datetime

from app.db.firestore import get_client
from app.models.vocab import Encounter


async def save_encounter(user_id: str, encounter: Encounter) -> None:
    db = get_client()
    collection = db.collection("encounters").document(user_id).collection("items")

    existing = (
        collection.where("term", "==", encounter.term)
        .where("reading", "==", encounter.reading)
        .limit(1)
    )
    docs = [doc async for doc in existing.stream()]

    if docs:
        doc = docs[0]
        current = doc.to_dict()
        await doc.reference.update(
            {
                "encounter_count": current.get("encounter_count", 1) + 1,
                "last_seen": datetime.utcnow(),
            }
        )
    else:
        await collection.document(encounter.id).set(encounter.model_dump(mode="json"))


async def get_encounters(user_id: str, limit: int = 100) -> list[dict]:
    db = get_client()
    docs = (
        db.collection("encounters")
        .document(user_id)
        .collection("items")
        .order_by("encounter_count", direction="DESCENDING")
        .limit(limit)
    )
    return [doc.to_dict() async for doc in docs.stream()]
