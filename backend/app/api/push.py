from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_agent
from app.core.config import settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.user import User
from app.repos import push_subscriptions as push_subs_repo
from app.services.push_service import send_web_push_to_subscriptions

router = APIRouter(prefix="/push", tags=["push"])
logger = get_logger(__name__)


class _SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: _SubscriptionKeys


class PushTestIn(BaseModel):
    title: str = "Test notification"
    body: str | None = "If you see this, push is working."
    url: str | None = ""


@router.get("/status")
async def push_status(
    current_user: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    subs = push_subs_repo.list_subscriptions_for_agent(db, agent_id=int(current_user.id))
    vapid_ready = bool(
        (settings.VAPID_PUBLIC_KEY or "").strip()
        and (settings.VAPID_PRIVATE_KEY or "").strip()
        and (settings.VAPID_SUBJECT or "").strip()
    )

    return {
        "ok": True,
        "vapid_public_key_present": bool((settings.VAPID_PUBLIC_KEY or "").strip()),
        "vapid_configured": vapid_ready,
        "subscription_count": len(subs),
    }


@router.get("/vapid-public-key")
async def vapid_public_key():
    # Public key is safe to return.
    return {"public_key": (settings.VAPID_PUBLIC_KEY or "").strip()}


@router.post("/subscribe")
async def subscribe(
    payload: PushSubscriptionIn,
    request: Request,
    current_user: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    ua = str(request.headers.get("user-agent") or "") or None

    sub = push_subs_repo.upsert_subscription(
        db,
        agent_id=int(current_user.id),
        endpoint=str(payload.endpoint),
        p256dh=str(payload.keys.p256dh),
        auth=str(payload.keys.auth),
        user_agent=ua,
    )

    logger.info("push_subscription_upserted", agent_id=current_user.id)

    return {"ok": True, "id": sub.id}


@router.post("/unsubscribe")
async def unsubscribe(
    payload: PushSubscriptionIn,
    current_user: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    deleted = push_subs_repo.delete_subscription(db, agent_id=int(current_user.id), endpoint=str(payload.endpoint))
    return {"ok": True, "deleted": deleted}


@router.post("/test")
async def test_push(
    payload: PushTestIn,
    current_user: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    subs = push_subs_repo.list_subscriptions_for_agent(db, agent_id=int(current_user.id))

    attempted = send_web_push_to_subscriptions(
        subscriptions=subs,
        title=str(payload.title),
        body=str(payload.body) if payload.body is not None else None,
        url=str(payload.url) if payload.url is not None else None,
    )

    return {
        "ok": True,
        "subscriptions": len(subs),
        "attempted": attempted,
        "vapid_configured": bool((settings.VAPID_PUBLIC_KEY or "").strip() and (settings.VAPID_PRIVATE_KEY or "").strip() and (settings.VAPID_SUBJECT or "").strip()),
    }
