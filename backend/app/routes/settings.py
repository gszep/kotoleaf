from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.auth import get_current_user
from app.db.users import get_user, update_user

router = APIRouter(prefix="/settings", tags=["settings"])


class UpdateSettingsRequest(BaseModel):
    native_language: str | None = None
    jlpt_threshold: str | None = None


@router.get("")
async def get_settings(user: dict = Depends(get_current_user)):
    user_data = await get_user(user["sub"])
    if not user_data:
        return {"native_language": "en", "jlpt_threshold": "N1"}
    return {
        "native_language": user_data.get("native_language", "en"),
        "jlpt_threshold": user_data.get("jlpt_threshold", "N1"),
    }


@router.patch("")
async def update_settings(
    request: UpdateSettingsRequest,
    user: dict = Depends(get_current_user),
):
    updates = request.model_dump(exclude_none=True)
    if updates:
        await update_user(user["sub"], updates)
    return {"status": "updated"}
