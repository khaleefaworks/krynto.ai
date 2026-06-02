from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.models.conversation_page_view import ConversationPageView

# De-dupe window: consecutive identical URLs within this period are merged.
# Visits beyond this threshold create a new page_view row so timestamps reflect reality.
_DEDUP_WINDOW = timedelta(minutes=30)


def _within_dedup_window(created_at: object) -> bool:
    """Return True if created_at is recent enough to be treated as a duplicate."""
    try:
        ts = created_at  # type: ignore[assignment]
        if ts is None:
            return False
        if ts.tzinfo is None:  # type: ignore[union-attr]
            ts = ts.replace(tzinfo=timezone.utc)  # type: ignore[union-attr]
        return (datetime.now(timezone.utc) - ts) <= _DEDUP_WINDOW
    except Exception:
        return False


def create_page_view(
    db: Session,
    *,
    website_id: int,
    session_id: str,
    conversation_id: int | None,
    url: str,
    title: str | None = None,
    referrer: str | None = None,
    device_info: str | None = None,
    browser_info: str | None = None,
) -> ConversationPageView:
    # De-dupe consecutive identical URLs for the same session.
    # This prevents spam from refreshes or repeated identical route events.
    latest = (
        db.query(ConversationPageView)
        .filter(
            ConversationPageView.website_id == website_id,
            ConversationPageView.session_id == session_id,
        )
        .order_by(desc(ConversationPageView.created_at))
        .first()
    )

    if latest and latest.url == url and _within_dedup_window(latest.created_at):
        changed = False
        if conversation_id is not None and latest.conversation_id is None:
            latest.conversation_id = conversation_id
            changed = True
        if title is not None and title != latest.title:
            latest.title = title
            changed = True
        if referrer is not None and referrer != latest.referrer:
            latest.referrer = referrer
            changed = True
        if device_info is not None and device_info != latest.device_info:
            latest.device_info = device_info
            changed = True
        if browser_info is not None and browser_info != latest.browser_info:
            latest.browser_info = browser_info
            changed = True

        if changed:
            db.commit()
            db.refresh(latest)
        return latest

    row = ConversationPageView(
        website_id=website_id,
        session_id=session_id,
        conversation_id=conversation_id,
        url=url,
        title=title,
        referrer=referrer,
        device_info=device_info,
        browser_info=browser_info,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_page_views_for_conversation(db: Session, conversation_id: int, *, limit: int = 50) -> List[ConversationPageView]:
    return (
        db.query(ConversationPageView)
        .filter_by(conversation_id=conversation_id)
        .order_by(desc(ConversationPageView.created_at))
        .limit(int(limit))
        .all()
    )


def list_page_views_for_session(db: Session, website_id: int, session_id: str, *, limit: int = 50) -> List[ConversationPageView]:
    """List recent page views for a visitor session (website_id + session_id)."""
    return (
        db.query(ConversationPageView)
        .filter_by(website_id=website_id, session_id=session_id)
        .order_by(desc(ConversationPageView.created_at))
        .limit(int(limit))
        .all()
    )


def attach_session_page_views_to_conversation(
    db: Session,
    *,
    website_id: int,
    session_id: str,
    conversation_id: int,
) -> Optional[ConversationPageView]:
    # Attach any pre-conversation events for this session.
    db.query(ConversationPageView).filter(
        ConversationPageView.website_id == website_id,
        ConversationPageView.session_id == session_id,
        ConversationPageView.conversation_id.is_(None),
    ).update({"conversation_id": conversation_id})

    # Return the latest page view for device/browser best-effort backfill.
    latest = (
        db.query(ConversationPageView)
        .filter_by(website_id=website_id, session_id=session_id)
        .order_by(desc(ConversationPageView.created_at))
        .first()
    )

    db.commit()
    return latest
