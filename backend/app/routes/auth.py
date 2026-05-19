from fastapi import APIRouter, Depends, HTTPException

from app.auth import create_jwt, exchange_code, get_current_user, get_login_url
from app.db.users import get_or_create_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login")
async def login():
    return {"url": get_login_url()}


@router.post("/callback")
async def callback(code: str):
    userinfo = await exchange_code(code)

    user_id = userinfo["sub"]
    email = userinfo.get("email", "")
    name = userinfo.get("name", "")

    await get_or_create_user(user_id, email, name)
    token = create_jwt(user_id, email, name)

    return {"token": token, "user": {"id": user_id, "email": email, "name": name}}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/dev-login")
async def dev_login():
    """Dev-only: create a test user and token without Google OAuth."""
    from app.config import settings

    if settings.environment != "development":
        raise HTTPException(403, "Dev login only available in development mode")

    user_id = "dev-user-001"
    email = "dev@kotoleaf.test"
    name = "Dev User"

    await get_or_create_user(user_id, email, name)
    token = create_jwt(user_id, email, name)
    return {"token": token, "user": {"id": user_id, "email": email, "name": name}}
