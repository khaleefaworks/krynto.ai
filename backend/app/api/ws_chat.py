from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.database import SessionLocal
from app.services.conversation_orchestrator import ConversationOrchestrator
from app.services.chat_service import ChatService
from app.services.agent_service import AgentService
from app.core.logging import get_logger
from app.core.config import settings
import json
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import asyncio

from app.core.message_presenter import serialize_message
from app.repos import conversations as conversations_repo
from app.repos import messages as messages_repo
from app.repos import page_views as page_views_repo
from app.core.widget_origin import get_widget_request_host, is_host_allowed_for_website
from app.infra.ws_rate_limit import is_chat_rate_limited
from app.infra.metrics import ws_connect, ws_disconnect, ws_error, ws_message
import structlog
import uuid

router = APIRouter()
logger = get_logger(__name__)


def _to_naive_utc(dt: datetime | None) -> datetime | None:
    """Normalize a datetime to naive UTC for safe arithmetic.

    The codebase uses a mix of timezone-aware and naive datetimes depending on
    the SQLAlchemy column definitions. For comparisons/subtraction, we treat
    naive values as UTC and strip tzinfo from aware values.
    """

    if dt is None:
        return None
    try:
        if dt.tzinfo is None:
            return dt
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return dt


VISITOR_LEFT_DELAY_SECONDS = 15
_PRESENCE_HEARTBEAT_INTERVAL = 60  # seconds between Redis TTL renewals
_visitor_left_scheduled: set[int] = set()
# Keyed by "website_id:session_id" — prevents duplicate welcome tasks for the
# same session (e.g. rapid reconnect / double-connect within the delay window).
_welcome_pending: set[str] = set()


async def _presence_heartbeat(*, website_id: int, session_id: str) -> None:
    """Periodically renew the Redis TTL for an online session so it doesn't auto-expire."""
    try:
        while True:
            await asyncio.sleep(_PRESENCE_HEARTBEAT_INTERVAL)
            ChatService.refresh_session_online_ttl(int(website_id), str(session_id))
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _send_delayed_session_presence_event(
    *,
    website_id: int,
    session_id: str,
    delay_seconds: int,
) -> None:
    """Broadcast an offline session presence event after a short delay if still offline."""
    try:
        await asyncio.sleep(max(0, int(delay_seconds or 0)))

        if ChatService.is_session_online(website_id=int(website_id), session_id=str(session_id)):
            return

        last_disconnected_at = None
        try:
            snap = ChatService.session_presence_snapshot(
                website_id=int(website_id),
                recently_left_within_seconds=86400,
            )
            for r in snap:
                if int(r.get("website_id")) == int(website_id) and str(r.get("session_id")) == str(session_id):
                    last_disconnected_at = r.get("last_disconnected_at")
                    break
        except Exception:
            last_disconnected_at = None

        db2 = SessionLocal()
        try:
            agent_service2 = AgentService(db2)
            await agent_service2.broadcast_to_active_agents(
                website_id=int(website_id),
                message_data={
                    "type": "visitor_session_presence",
                    "website_id": int(website_id),
                    "session_id": str(session_id),
                    "is_online": False,
                    "last_disconnected_at": last_disconnected_at.isoformat() if getattr(last_disconnected_at, "isoformat", None) else None,
                },
                include_global=True,
            )
        finally:
            db2.close()
    except Exception:
        pass


async def _send_delayed_visitor_left_event(*, conversation_id: int, delay_seconds: int) -> None:
    """Emit a visitor_left_website event after a short delay if still disconnected."""
    try:
        await asyncio.sleep(max(0, int(delay_seconds or 0)))

        # If they reconnected, do not emit.
        if conversation_id in ChatService.active_visitors:
            return

        from app.core.database import SessionLocal

        db2 = SessionLocal()
        try:
            orchestrator2 = ConversationOrchestrator(db2)
            await orchestrator2.visitor_left_website(conversation_id=int(conversation_id))
        finally:
            db2.close()
    except Exception:
        # Best-effort
        pass
    finally:
        try:
            _visitor_left_scheduled.discard(int(conversation_id))
        except Exception:
            pass


async def _send_delayed_welcome(
    *,
    website_id: int,
    session_id: str,
    delay_seconds: float = 3.0,
) -> None:
    """Fire the visitor_connected automation flow after a short delay.

    Creates a conversation for the session if one doesn't exist yet (proactive
    welcome — visitor hasn't sent a message yet). The graph executor handles
    cooldown, message content, and delivery.
    """
    _key = f"{website_id}:{session_id}"
    _welcome_pending.add(_key)
    try:
        await asyncio.sleep(delay_seconds)

        db2 = SessionLocal()
        try:
            from app.services.conversation_orchestrator import ConversationOrchestrator
            from app.services.conversation_service import ConversationService

            conv_service = ConversationService(db2)
            conversation = conv_service.get_or_create_conversation(
                website_id=website_id,
                session_id=session_id,
            )

            # Link the visitor's already-connected WebSocket to this conversation
            # so send_to_visitor can deliver the welcome message immediately.
            from app.services.chat_service import ChatService as _CS
            was_already_known = conversation.id in _CS.active_visitors
            _CS.link_session_to_conversation(
                website_id=website_id,
                session_id=session_id,
                conversation_id=conversation.id,
            )

            # Notify the widget of the new conversation_id so it stores it
            # for future outgoing messages (only when we just created it).
            if not was_already_known:
                try:
                    await _CS.send_to_visitor(
                        conversation.id,
                        {"type": "conversation_created", "conversation_id": conversation.id},
                    )
                except Exception:
                    pass

            orchestrator = ConversationOrchestrator(db2)
            await orchestrator._run_automation_flows(
                conversation_id=conversation.id,
                website_id=website_id,
                trigger="visitor_connected",
                log_key="delayed_welcome_failed",
                send_to_visitor=True,
            )

            # Fire conversation_created automations (e.g. Team Routing Chatbot)
            # proactively on connect. The idempotency guard inside this method
            # prevents re-firing if the visitor sends a message before the delay.
            await orchestrator._fire_conversation_created_automations(
                conversation=conversation,
                website_id=website_id,
                visitor_ws=None,
            )
        finally:
            db2.close()
    except Exception as e:
        logger.warning(
            "delayed_welcome_failed",
            website_id=website_id,
            session_id=session_id,
            error=str(e),
        )
    finally:
        _welcome_pending.discard(_key)


def _ws_close_reason(reason: str | None) -> str:
    if not reason:
        return ""
    # WebSocket close reason is size-limited; truncate to stay safe.
    reason_str = str(reason).replace("\n", " ").replace("\r", " ")
    return reason_str[:120]


# Rate limiting for WebSocket messages
# Track message timestamps per session
message_timestamps = defaultdict(list)


@router.websocket("/ws/chat/{website_id}/{session_id}")
async def chat_ws(
    websocket: WebSocket,
    website_id: int,
    session_id: str,
):
    connection_id = str(uuid.uuid4())
    incoming = (websocket.headers.get("x-request-id") or "").strip()
    request_id = incoming[:200] if incoming else connection_id

    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        request_id=request_id,
        connection_id=connection_id,
        ws_kind="chat",
        website_id=website_id,
        session_id=session_id,
    )

    await websocket.accept()
    try:
        ws_connect(kind="chat")
    except Exception:
        pass
    logger.info("visitor_websocket_connected", website_id=website_id, session_id=session_id)

    db = SessionLocal()

    registered_conversation_id: int | None = None

    orchestrator = ConversationOrchestrator(db)
    agent_service = AgentService(db)

    try:
        # Validate website exists before processing messages
        from app.models.website import Website
        website = db.query(Website).filter_by(id=website_id).first()
        if not website:
            error_msg = f"Website with ID {website_id} does not exist. Please create website first."
            logger.error("website_not_found", website_id=website_id, session_id=session_id)
            await websocket.send_json({
                "type": "error",
                "message": error_msg
            })
            await websocket.close(code=1008, reason=_ws_close_reason(error_msg))
            db.close()
            return

        # Domain lock: the widget socket must originate from the website's domain/subdomains.
        request_host = get_widget_request_host(websocket.headers)
        if request_host and (not is_host_allowed_for_website(request_host=request_host, website_domain=website.domain)):
            error_msg = "Widget origin not allowed"
            logger.warning(
                "widget_origin_rejected",
                website_id=website_id,
                session_id=session_id,
                origin=str(websocket.headers.get("origin") or ""),
                referer=str(websocket.headers.get("referer") or ""),
                request_host=request_host,
                website_domain=str(website.domain or ""),
            )
            await websocket.close(code=1008, reason=_ws_close_reason(error_msg))
            db.close()
            return

        if (request_host is None) and settings.is_production():
            error_msg = "Widget origin is required"
            logger.warning(
                "widget_origin_missing",
                website_id=website_id,
                session_id=session_id,
            )
            await websocket.close(code=1008, reason=_ws_close_reason(error_msg))
            db.close()
            return

        # Track session-level presence (used by Customers -> Visitors).
        _heartbeat_task_1 = None
        try:
            ChatService.register_session(website_id=int(website_id), session_id=str(session_id), websocket=websocket)
            _heartbeat_task_1 = asyncio.create_task(
                _presence_heartbeat(website_id=int(website_id), session_id=str(session_id))
            )
        except Exception:
            pass

        # Realtime: notify agents about session-level presence (even before a conversation exists).
        try:
            snap = ChatService.session_presence_snapshot(
                website_id=int(website_id),
                recently_left_within_seconds=86400,
            )
            connected_at = None
            for r in snap:
                if int(r.get("website_id")) == int(website_id) and str(r.get("session_id")) == str(session_id):
                    connected_at = r.get("connected_at")
                    break

            await agent_service.broadcast_to_active_agents(
                website_id=int(website_id),
                message_data={
                    "type": "visitor_session_presence",
                    "website_id": int(website_id),
                    "session_id": str(session_id),
                    "is_online": True,
                    "connected_at": connected_at.isoformat() if getattr(connected_at, "isoformat", None) else None,
                },
                include_global=True,
            )
        except Exception:
            pass

        # Load history only for an OPEN conversation tied to this session.
        # Do NOT create a new conversation just because the widget connected.
        conversation = None
        try:
            conversation = conversations_repo.get_open_conversation_by_session(
                db,
                website_id=website_id,
                session_id=session_id,
            )
        except Exception:
            conversation = None

        if conversation:
            # Track whether this conversation already had an active visitor socket.
            # This is best-effort and helps reduce noisy presence events.
            try:
                _was_active = int(conversation.id) in ChatService.active_visitors
            except Exception:
                _was_active = False

            ChatService.register_visitor(conversation.id, websocket)
            registered_conversation_id = conversation.id

            # Smartsupp-like: visitor reconnected/connected (internal timeline event).
            # Use a fresh session to avoid stale transaction state from the current db session.
            try:
                if not _was_active:
                    from app.models.message import Message as _Msg
                    from app.core.database import SessionLocal as _SL
                    _detect_db = _SL()
                    try:
                        _last_presence = (
                            _detect_db.query(_Msg)
                            .filter(
                                _Msg.conversation_id == conversation.id,
                                _Msg.event_type.in_(["visitor_dropped", "visitor_reconnected", "visitor_socket_connected"]),
                            )
                            .order_by(_Msg.id.desc())
                            .first()
                        )
                    finally:
                        _detect_db.close()
                    if _last_presence and _last_presence.event_type == "visitor_dropped":
                        await orchestrator.visitor_reconnected(conversation_id=int(conversation.id))
                    elif int(conversation.id) not in _visitor_left_scheduled:
                        await orchestrator.visitor_socket_connected(conversation_id=int(conversation.id))
            except Exception as _exc:
                logger.warning("reconnect_detection_failed", conversation_id=conversation.id, error=str(_exc), exc_info=True)

            try:
                messages = messages_repo.list_messages_for_conversation(db, conversation.id)

                history_messages = []
                for msg in messages:
                    # Exclude agent-only system messages from visitor history.
                    if getattr(msg, 'is_agent_only', False):
                        continue
                    history_messages.append(serialize_message(db, msg))

                conv_status = conversation.status.value if hasattr(conversation.status, "value") else str(conversation.status)
                resolved_at = None
                if conv_status == "resolved" and conversation.updated_at:
                    try:
                        resolved_at = _to_naive_utc(conversation.updated_at).isoformat() + "Z"
                    except Exception:
                        pass

                await websocket.send_json(
                    {
                        "type": "history",
                        "conversation_id": conversation.id,
                        "status": conv_status,
                        "resolved_at": resolved_at,
                        "messages": history_messages,
                    }
                )
            except Exception as e:
                logger.error(
                    "failed_to_send_history",
                    website_id=website_id,
                    session_id=session_id,
                    error=str(e),
                    exc_info=True,
                )
        else:
            # Let the widget render an empty thread; conversation will be created on first message.
            await websocket.send_json({"type": "history", "conversation_id": None, "messages": []})

        # IMPORTANT: Close any read-only transaction opened by the initial SELECTs.
        # PostgreSQL's `now()`/`func.now()` is transaction timestamp; if we keep a transaction
        # open from connect until the first visitor message commit, that first message will
        # get a stale `created_at` and may sort above later events (agent join/agent message).
        try:
            db.rollback()
        except Exception:
            pass

        # Welcome automation: fire visitor_connected flow after a short delay.
        # Cooldown and message are defined inside the automation graph nodes.
        try:
            now = datetime.utcnow()
            from app.services.automation_service import AutomationService

            automation_service = AutomationService(db)
            cooldown_seconds = automation_service.get_cooldown_seconds(
                website_id=website_id,
                trigger="visitor_connected",
                default_seconds=24 * 3600,
            )
            cooldown = timedelta(seconds=max(1, int(cooldown_seconds)))

            if conversation:
                prev_seen_at = _to_naive_utc(conversation.last_seen_at)
                conversation.last_seen_at = now
                if prev_seen_at and (now - prev_seen_at) > cooldown:
                    conversation.visit_count = int(conversation.visit_count or 0) + 1
                db.commit()

            # Schedule the welcome — _send_delayed_welcome will create
            # the conversation if the visitor hasn't sent a message yet.
            # Skip if a task is already pending for this session (rapid reconnect guard).
            if f"{website_id}:{session_id}" not in _welcome_pending:
                asyncio.create_task(
                    _send_delayed_welcome(
                        website_id=website_id,
                        session_id=session_id,
                        delay_seconds=3.0,
                    )
                )
        except Exception as e:
            try:
                db.rollback()
            except Exception:
                pass
            logger.warning("welcome_automation_failed", website_id=website_id, session_id=session_id, error=str(e))

        # Close any transaction that may have been opened by read-only checks
        # (e.g. last_welcome lookup) so subsequent inserts get a fresh timestamp.
        try:
            db.rollback()
        except Exception:
            pass
    except Exception as e:
        logger.error("chat_service_init_error", website_id=website_id, session_id=session_id, error=str(e), exc_info=True)
        db.close()
        error_msg = f"Failed to initialize chat: {str(e)}"
        await websocket.send_json({
            "type": "error",
            "message": error_msg
        })
        await websocket.close(code=1011, reason=_ws_close_reason(error_msg))
        return

    try:
        while True:
            data = await websocket.receive_text()
            try:
                ws_message(kind="chat", direction="in", message_type="text")
            except Exception:
                pass
            logger.debug("visitor_message_received", session_id=session_id, data=data)
            payload = json.loads(data)

            message_type = payload.get("type")

            try:
                ws_message(kind="chat", direction="in", message_type=str(message_type or "unknown"))
            except Exception:
                pass

            # Heartbeat ping — update last_seen_at so the dropped-visitor heuristic
            # can tell a page reload from a true leave (45-second window).
            if message_type == "ping":
                try:
                    if registered_conversation_id is not None:
                        from app.models.conversation import Conversation as _Conv
                        _c = db.query(_Conv).filter_by(id=registered_conversation_id).first()
                        if _c:
                            _c.last_seen_at = datetime.utcnow()
                            db.commit()
                except Exception:
                    try:
                        db.rollback()
                    except Exception:
                        pass
                try:
                    await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
                continue

            # Page view / browsing history event.
            # This can arrive even before the first visitor message, so it must NOT create
            # a conversation (avoid spam inbox). We store by website_id+session_id and
            # attach to the conversation once it exists.
            if message_type == "page_view":
                url = payload.get("url")
                title = payload.get("title")
                referrer = payload.get("referrer")
                device_info = payload.get("device_info")
                browser_info = payload.get("browser_info")

                try:
                    url_str = str(url or "").strip()
                except Exception:
                    url_str = ""
                if not url_str:
                    continue
                if len(url_str) > 4096:
                    url_str = url_str[:4096]

                try:
                    title_str = str(title).strip() if title is not None else None
                except Exception:
                    title_str = None
                if title_str and len(title_str) > 255:
                    title_str = title_str[:255]

                try:
                    referrer_str = str(referrer).strip() if referrer is not None else None
                except Exception:
                    referrer_str = None
                if referrer_str and len(referrer_str) > 4096:
                    referrer_str = referrer_str[:4096]

                try:
                    device_str = str(device_info).strip() if device_info is not None else None
                except Exception:
                    device_str = None
                if device_str and len(device_str) > 255:
                    device_str = device_str[:255]

                try:
                    browser_str = str(browser_info).strip() if browser_info is not None else None
                except Exception:
                    browser_str = None
                if browser_str and len(browser_str) > 255:
                    browser_str = browser_str[:255]

                conversation_id: int | None = registered_conversation_id
                conversation = None
                if conversation_id is None:
                    try:
                        conversation = conversations_repo.get_open_conversation_by_session(
                            db,
                            website_id=website_id,
                            session_id=session_id,
                        )
                        if conversation:
                            conversation_id = conversation.id
                    except Exception:
                        conversation = None

                row = page_views_repo.create_page_view(
                    db,
                    website_id=website_id,
                    session_id=session_id,
                    conversation_id=conversation_id,
                    url=url_str,
                    title=title_str,
                    referrer=referrer_str,
                    device_info=device_str,
                    browser_info=browser_str,
                )

                # Best-effort: persist device/browser onto the conversation if it already exists.
                if conversation_id is not None:
                    if conversation is None:
                        try:
                            conversation = conversations_repo.get_conversation_by_id(db, conversation_id)
                        except Exception:
                            conversation = None

                if conversation:
                    changed = False
                    if device_str and conversation.device_info != device_str:
                        conversation.device_info = device_str
                        changed = True
                    if browser_str and conversation.browser_info != browser_str:
                        conversation.browser_info = browser_str
                        changed = True
                    if changed:
                        try:
                            db.commit()
                        except Exception:
                            try:
                                db.rollback()
                            except Exception:
                                pass

                # Realtime: notify agents (useful if agent has the chat open).
                if conversation_id is not None:
                    try:
                        event = {
                            "type": "page_view",
                            "website_id": website_id,
                            "conversation_id": conversation_id,
                            "page_view": {
                                "id": row.id,
                                "title": row.title,
                                "url": row.url,
                                "referrer": row.referrer,
                                "device_info": row.device_info,
                                "browser_info": row.browser_info,
                                "created_at": row.created_at.isoformat() if row.created_at else None,
                            },
                        }

                        if conversation and conversation.assigned_agent_id:
                            await agent_service.send_to_agent(conversation.assigned_agent_id, event)
                        else:
                            await agent_service.broadcast_to_active_agents(
                                website_id=website_id,
                                message_data=event,
                                include_global=False,
                                conversation_team_id=getattr(conversation, "team_id", None),
                            )
                    except Exception:
                        pass

                continue

            # Bot button click: visitor tapped a button from a bot_prompt_buttons message.
            if message_type == "bot_button_click":
                btn_automation_id = payload.get("automation_id")
                btn_button_path = payload.get("button_path")  # preferred: list[int]
                btn_button_index = payload.get("button_index")  # legacy scalar

                if btn_automation_id is None:
                    continue
                # Require at least one of path or index
                if btn_button_path is None and btn_button_index is None:
                    continue
                # Normalise to a list
                if btn_button_path is None:
                    btn_button_path = [int(btn_button_index)]

                # Resolve conversation
                btn_conversation_id: int | None = registered_conversation_id
                if btn_conversation_id is None:
                    try:
                        btn_conv = conversations_repo.get_open_conversation_by_session(
                            db,
                            website_id=website_id,
                            session_id=session_id,
                        )
                        if btn_conv:
                            btn_conversation_id = btn_conv.id
                    except Exception:
                        pass

                if btn_conversation_id is None:
                    continue

                try:
                    await orchestrator.handle_bot_button_click(
                        conversation_id=btn_conversation_id,
                        automation_id=int(btn_automation_id),
                        button_path=[int(x) for x in btn_button_path],
                        visitor_ws=websocket,
                    )
                except Exception as e:
                    logger.warning("bot_button_click_failed", error=str(e))

                continue

            # Visitor clicked 'End chat'. Record a timeline event but keep the
            # conversation OPEN — agents follow up and resolve manually (no lost leads).
            if message_type == "end_chat":
                conversation = None
                try:
                    conversation = conversations_repo.get_open_conversation_by_session(
                        db,
                        website_id=website_id,
                        session_id=session_id,
                    )
                except Exception:
                    conversation = None

                if not conversation:
                    # Nothing to record.
                    continue

                try:
                    await orchestrator.visitor_left_chat(conversation_id=int(conversation.id))
                except Exception:
                    # Best-effort: still allow the socket to continue.
                    pass

                continue

            # Handle visitor rating submission
            if message_type == "submit_rating":
                rating_val = payload.get("rating")
                conv_id = payload.get("conversation_id")
                feedback_val = payload.get("feedback") or None
                if rating_val is not None and isinstance(rating_val, int) and -1 <= rating_val <= 1:
                    try:
                        from app.models.conversation_rating import ConversationRating

                        # Find conversation if conv_id not provided
                        if not conv_id:
                            conv = conversations_repo.get_conversation_by_session(
                                db, website_id=website_id, session_id=session_id
                            )
                            if conv:
                                conv_id = conv.id

                        if conv_id:
                            existing = (
                                db.query(ConversationRating)
                                .filter(ConversationRating.conversation_id == conv_id)
                                .first()
                            )
                            if existing:
                                existing.rating = rating_val
                                if feedback_val is not None:
                                    existing.feedback = feedback_val
                                db.commit()
                            else:
                                new_rating = ConversationRating(
                                    conversation_id=conv_id,
                                    rating=rating_val,
                                    feedback=feedback_val,
                                    session_id=session_id,
                                )
                                db.add(new_rating)
                                db.commit()
                            logger.info(
                                "rating_submitted_ws",
                                conversation_id=conv_id,
                                rating=rating_val,
                            )
                            try:
                                await orchestrator.visitor_rated(
                                    conversation_id=conv_id,
                                    rating_val=rating_val,
                                    feedback=feedback_val,
                                )
                            except Exception:
                                pass
                            # Broadcast to agents so the right panel updates immediately.
                            try:
                                _rating_labels = {1: "\U0001f60a Good", 0: "\U0001f610 Neutral", -1: "\U0001f61e Bad"}
                                _rating_conv = conversations_repo.get_conversation_by_id(db, conv_id)
                                await agent_service.broadcast_to_active_agents(
                                    website_id=website_id,
                                    message_data={
                                        "type": "visitor_rated",
                                        "conversation_id": conv_id,
                                        "rating": rating_val,
                                        "rating_label": _rating_labels.get(rating_val, str(rating_val)),
                                        "website_id": website_id,
                                    },
                                    conversation_team_id=getattr(_rating_conv, "team_id", None),
                                )
                            except Exception:
                                pass
                    except Exception as e:
                        logger.warning("rating_submit_failed", error=str(e))
                        try:
                            db.rollback()
                        except Exception:
                            pass
                continue

            # Widget opened by visitor click — trigger welcome if not yet sent.
            if message_type == "widget_opened":
                try:
                    from app.repos import messages as messages_repo
                    _wo_conversation = conversations_repo.get_open_conversation_by_session(
                        db, website_id=website_id, session_id=session_id
                    )
                    if _wo_conversation:
                        last_welcome = messages_repo.get_last_welcome_message(db, _wo_conversation.id)
                        if not last_welcome:
                            last_welcome = messages_repo.get_last_event_message(
                                db, _wo_conversation.id, "bot_prompt_buttons"
                            )
                        if not last_welcome:
                            if f"{website_id}:{session_id}" not in _welcome_pending:
                                asyncio.create_task(
                                    _send_delayed_welcome(
                                        website_id=website_id,
                                        session_id=session_id,
                                        delay_seconds=0.5,
                                    )
                                )
                except Exception as _e:
                    logger.warning("widget_opened_handler_failed", error=str(_e))
                continue

            if message_type == "typing":
                is_typing = bool(payload.get("is_typing"))

                conversation_id: int | None = registered_conversation_id
                conversation = None
                if conversation_id is None:
                    try:
                        conversation = conversations_repo.get_open_conversation_by_session(
                            db,
                            website_id=website_id,
                            session_id=session_id,
                        )
                        if conversation:
                            conversation_id = conversation.id
                    except Exception:
                        conversation = None

                if conversation_id is None:
                    continue

                if conversation is None:
                    try:
                        conversation = conversations_repo.get_conversation_by_id(db, conversation_id)
                    except Exception:
                        conversation = None

                event = {
                    "type": "visitor_typing",
                    "conversation_id": conversation_id,
                    "website_id": website_id,
                    "session_id": session_id,
                    "is_typing": is_typing,
                }

                _typing_team_id = getattr(conversation, "team_id", None)
                if conversation and conversation.assigned_agent_id:
                    await agent_service.send_to_agent(conversation.assigned_agent_id, event)
                    await agent_service.broadcast_to_active_agents(
                        website_id=website_id,
                        message_data=event,
                        include_global=True,
                        exclude_agent_id=conversation.assigned_agent_id,
                        conversation_team_id=_typing_team_id,
                    )
                else:
                    await agent_service.broadcast_to_active_agents(
                        website_id=website_id,
                        message_data=event,
                        include_global=True,
                        conversation_team_id=_typing_team_id,
                    )

                continue

            if message_type == "visitor_contact":
                v_name = payload.get("visitor_name")
                v_email = payload.get("visitor_email")
                v_phone = payload.get("visitor_phone")
                if v_name or v_email or v_phone:
                    try:
                        conv = conversations_repo.get_open_conversation_by_session(
                            db, website_id=website_id, session_id=session_id
                        )
                        if conv:
                            changed = False
                            if v_name and not conv.visitor_name:
                                conv.visitor_name = str(v_name)
                                changed = True
                            if v_email and not conv.visitor_email:
                                conv.visitor_email = str(v_email)
                                changed = True
                            if v_phone and not conv.visitor_phone:
                                conv.visitor_phone = str(v_phone)
                                changed = True
                            if changed:
                                db.commit()
                    except Exception:
                        try:
                            db.rollback()
                        except Exception:
                            pass
                continue

            user_message = payload.get("message")
            if not user_message:
                continue

            # Optional client-generated message id (widget can use this to reconcile optimistic sends)
            client_message_id = payload.get("message_id") or payload.get("client_message_id")

            visitor_name = payload.get("visitor_name")
            visitor_email = payload.get("visitor_email")
            visitor_phone = payload.get("visitor_phone")
            
            # Rate limiting: multi-worker safe when REDIS_URL is configured.
            exceeded = False
            try:
                exceeded = await is_chat_rate_limited(
                    website_id=website_id,
                    session_id=session_id,
                    limit=settings.RATE_LIMIT_CHAT_MESSAGE,
                )
            except Exception:
                exceeded = False

            if exceeded:
                logger.warning("rate_limit_exceeded", session_id=session_id)
                await websocket.send_json(
                    {"type": "error", "message": "Rate limit exceeded. Please slow down."}
                )
                continue

            # Fallback in-memory limiter (single-worker) when Redis isn't enabled.
            if not settings.REDIS_URL:
                current_time = time.time()
                session_messages = message_timestamps[session_id]
                session_messages[:] = [ts for ts in session_messages if current_time - ts < 60]
                if len(session_messages) >= settings.RATE_LIMIT_CHAT_MESSAGE:
                    logger.warning(
                        "rate_limit_exceeded",
                        session_id=session_id,
                        message_count=len(session_messages),
                    )
                    await websocket.send_json(
                        {"type": "error", "message": "Rate limit exceeded. Please slow down."}
                    )
                    continue
                session_messages.append(current_time)

            logger.info("processing_visitor_message", session_id=session_id, message_length=len(user_message))

            response = await orchestrator.handle_visitor_message(
                website_id=website_id,
                session_id=session_id,
                message=user_message,
                visitor_ws=websocket,
                client_message_id=str(client_message_id) if client_message_id else None,
                visitor_ip=(getattr(getattr(websocket, "client", None), "host", None)),
                visitor_name=visitor_name,
                visitor_email=visitor_email,
                visitor_phone=visitor_phone,
            )

            # Conversation may have been created on first message; register for cleanup.
            if registered_conversation_id is None:
                try:
                    conv = conversations_repo.get_open_conversation_by_session(
                        db,
                        website_id=website_id,
                        session_id=session_id,
                    )
                    if conv:
                        registered_conversation_id = conv.id
                        ChatService.register_visitor(conv.id, websocket)

                        # Title is only set from the offline contact form (visitor_name).
                        # We no longer auto-generate titles from the first visitor message.

                        # Notify the widget so it can store the new conversation_id.
                        try:
                            await websocket.send_json(
                                {
                                    "type": "conversation_created",
                                    "conversation_id": conv.id,
                                }
                            )
                        except Exception:
                            pass
                except Exception:
                    pass

            # Orchestrator may return immediate text; keep backwards-compatible.
            if response:
                await websocket.send_json({"type": "system", "message": response})

    except WebSocketDisconnect:
        logger.info("visitor_websocket_disconnected", session_id=session_id)
    except Exception as e:
        try:
            ws_error(kind="chat", where="handler")
        except Exception:
            pass
        logger.error("websocket_handler_error", session_id=session_id, error=str(e), exc_info=True)
        try:
            await websocket.close(code=1011, reason=_ws_close_reason(str(e)))
        except:
            pass
    finally:
        try:
            ws_disconnect(kind="chat")
        except Exception:
            pass
        # Always clean up visitor mapping + rate limit tracking.
        try:
            ChatService.unregister_visitor_socket(websocket)
        except Exception:
            pass

        try:
            if _heartbeat_task_1 is not None:
                _heartbeat_task_1.cancel()
        except Exception:
            pass

        try:
            ChatService.unregister_session_socket(websocket)
        except Exception:
            pass

        # Realtime: broadcast offline after a short delay to avoid refresh flicker.
        try:
            asyncio.create_task(
                _send_delayed_session_presence_event(
                    website_id=int(website_id),
                    session_id=str(session_id),
                    delay_seconds=VISITOR_LEFT_DELAY_SECONDS,
                )
            )
        except Exception:
            pass

        try:
            # IMPORTANT: do not unregister by conversation_id here.
            # Another visitor socket may already be registered for the same conversation
            # (e.g. fast reconnect / reload). `unregister_visitor_socket` above is the safe cleanup.
            pass
        except Exception:
            pass

        # Best-effort: if the visitor truly left (tab closed), emit a timeline event.
        # Delay slightly to avoid false positives on transient disconnects.
        try:
            if registered_conversation_id is not None:
                cid = int(registered_conversation_id)
                if cid not in _visitor_left_scheduled:
                    _visitor_left_scheduled.add(cid)
                    asyncio.create_task(
                        _send_delayed_visitor_left_event(
                            conversation_id=cid,
                            delay_seconds=VISITOR_LEFT_DELAY_SECONDS,
                        )
                    )
        except Exception:
            pass

        try:
            if session_id in message_timestamps:
                del message_timestamps[session_id]
        except Exception:
            pass
        db.close()

        try:
            structlog.contextvars.clear_contextvars()
        except Exception:
            pass


@router.websocket("/ws/chat/{website_id}/{session_id}/{conversation_id}")
async def chat_ws_with_conversation(
    websocket: WebSocket,
    website_id: int,
    session_id: str,
    conversation_id: int,
):
    """WebSocket route with an explicit conversation_id.

    Used by the widget when reconnecting to a known conversation (e.g. from the
    conversation list view). For OPEN conversations, messages are processed
    normally. For RESOLVED conversations, only the history is delivered and
    further visitor messages are rejected with an informational notice.
    """
    connection_id = str(uuid.uuid4())
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(
        connection_id=connection_id,
        ws_kind="chat",
        website_id=website_id,
        session_id=session_id,
        conversation_id=conversation_id,
    )

    await websocket.accept()
    try:
        ws_connect(kind="chat")
    except Exception:
        pass

    db = SessionLocal()
    try:
        # Validate website exists.
        from app.models.website import Website
        from app.models.conversation import Conversation, ConversationStatus

        website = db.query(Website).filter_by(id=website_id).first()
        if not website:
            await websocket.close(code=1008, reason=_ws_close_reason("Website not found"))
            return

        # Validate conversation belongs to this website.
        conv = db.query(Conversation).filter(
            Conversation.id == conversation_id,
            Conversation.website_id == website_id,
        ).first()
        if not conv:
            await websocket.close(code=1008, reason=_ws_close_reason("Conversation not found"))
            return

        # Always register session-level presence so resolved-conv visitors appear in the Visitors page.
        is_open = conv.status not in (ConversationStatus.RESOLVED,)
        _was_active_cid = False
        _heartbeat_task_2 = None
        try:
            ChatService.register_session(website_id=int(website_id), session_id=str(session_id), websocket=websocket)
            _heartbeat_task_2 = asyncio.create_task(
                _presence_heartbeat(website_id=int(website_id), session_id=str(session_id))
            )
        except Exception:
            pass
        if is_open and str(conv.session_id) == str(session_id):
            try:
                _was_active_cid = int(conv.id) in ChatService.active_visitors
            except Exception:
                pass
            ChatService.register_visitor(conv.id, websocket)

        # Reconnect detection: if visitor was not already active, check for a prior
        # visitor_dropped event and fire visitor_reconnected automation if found.
        if is_open and not _was_active_cid:
            try:
                from app.models.message import Message as _MsgCid
                from app.core.database import SessionLocal as _SLCid
                _det_db = _SLCid()
                try:
                    _last_presence_cid = (
                        _det_db.query(_MsgCid)
                        .filter(
                            _MsgCid.conversation_id == conv.id,
                            _MsgCid.event_type.in_(["visitor_dropped", "visitor_reconnected", "visitor_socket_connected"]),
                        )
                        .order_by(_MsgCid.id.desc())
                        .first()
                    )
                finally:
                    _det_db.close()
                if _last_presence_cid and _last_presence_cid.event_type == "visitor_dropped":
                    _recon_orchestrator = ConversationOrchestrator(db)
                    await _recon_orchestrator.visitor_reconnected(conversation_id=int(conv.id))
                elif int(conv.id) not in _visitor_left_scheduled:
                    _recon_orchestrator = ConversationOrchestrator(db)
                    await _recon_orchestrator.visitor_socket_connected(conversation_id=int(conv.id))
            except Exception as _exc:
                logger.warning("reconnect_detection_failed_cid", conversation_id=conv.id, error=str(_exc), exc_info=True)

        # Send conversation history (excluding agent-only messages).
        try:
            messages = messages_repo.list_messages_for_conversation(db, conv.id)
            conv_status_str = conv.status.value if hasattr(conv.status, "value") else str(conv.status)
            resolved_at_str = None
            if conv_status_str == "resolved" and conv.updated_at:
                try:
                    resolved_at_str = _to_naive_utc(conv.updated_at).isoformat() + "Z"
                except Exception:
                    pass
            history_msgs = [
                serialize_message(db, m) for m in messages
                if not getattr(m, 'is_agent_only', False)
            ]
            await websocket.send_json(
                {
                    "type": "history",
                    "conversation_id": conv.id,
                    "status": conv_status_str,
                    "resolved_at": resolved_at_str,
                    "messages": history_msgs,
                }
            )
        except Exception as e:
            logger.error("conversation_history_failed", conversation_id=conversation_id, error=str(e))

        db.close()
        db = SessionLocal()
        orchestrator = ConversationOrchestrator(db)
        agent_service = AgentService(db)

        # For resolved conversations only deliver history; reject further messages.
        if not is_open:
            try:
                await websocket.send_json(
                    {"type": "resolved", "message": "This conversation is closed."}
                )
            except Exception:
                pass
            # Hold the socket open until the client disconnects.
            try:
                while True:
                    await websocket.receive_text()
                    await websocket.send_json(
                        {"type": "error", "message": "This conversation is closed. Start a new one."}
                    )
            except WebSocketDisconnect:
                pass
            return

        # OPEN conversation — process messages the same as the main route.
        try:
            while True:
                data = await websocket.receive_text()
                payload = json.loads(data)
                message_type = payload.get("type")

                if message_type == "typing":
                    is_typing = bool(payload.get("is_typing"))
                    event = {
                        "type": "visitor_typing",
                        "conversation_id": conv.id,
                        "website_id": website_id,
                        "session_id": session_id,
                        "is_typing": is_typing,
                    }
                    _conv_team_id = getattr(conv, "team_id", None)
                    if conv.assigned_agent_id:
                        await agent_service.send_to_agent(conv.assigned_agent_id, event)
                        await agent_service.broadcast_to_active_agents(
                            website_id=website_id,
                            message_data=event,
                            include_global=True,
                            exclude_agent_id=conv.assigned_agent_id,
                            conversation_team_id=_conv_team_id,
                        )
                    else:
                        await agent_service.broadcast_to_active_agents(
                            website_id=website_id,
                            message_data=event,
                            include_global=True,
                            conversation_team_id=_conv_team_id,
                        )
                    continue

                if message_type == "heartbeat":
                    continue

                if message_type == "page_view":
                    try:
                        page_views_repo.create_page_view(
                            db,
                            website_id=website_id,
                            session_id=session_id,
                            conversation_id=conv.id,
                            url=str(payload.get("url", ""))[:2048],
                            title=str(payload.get("title", ""))[:500] if payload.get("title") else None,
                            referrer=str(payload.get("referrer", ""))[:2048] if payload.get("referrer") else None,
                            device_info=str(payload.get("device_info", ""))[:255] if payload.get("device_info") else None,
                            browser_info=str(payload.get("browser_info", ""))[:255] if payload.get("browser_info") else None,
                        )
                    except Exception:
                        pass
                    continue

                if message_type == "end_chat":
                    try:
                        db.expire_all()
                        fresh_conv = db.query(Conversation).filter_by(id=conv.id).first()
                        if fresh_conv and fresh_conv.status == ConversationStatus.OPEN:
                            await orchestrator.visitor_left_chat(conversation_id=int(conv.id))
                    except Exception:
                        pass
                    continue

                if message_type == "bot_button_click":
                    btn_automation_id = payload.get("automation_id")
                    btn_button_path = payload.get("button_path")  # preferred: list[int]
                    btn_button_index = payload.get("button_index")  # legacy scalar
                    if btn_automation_id is not None and (btn_button_path is not None or btn_button_index is not None):
                        if btn_button_path is None:
                            btn_button_path = [int(btn_button_index)]
                        try:
                            await orchestrator.handle_bot_button_click(
                                conversation_id=int(conv.id),
                                automation_id=int(btn_automation_id),
                                button_path=[int(x) for x in btn_button_path],
                                visitor_ws=websocket,
                            )
                        except Exception as e:
                            logger.warning("bot_button_click_failed", error=str(e))
                    continue

                if message_type == "visitor_contact":
                    vc_name = payload.get("visitor_name")
                    vc_email = payload.get("visitor_email")
                    vc_phone = payload.get("visitor_phone")
                    if vc_name or vc_email or vc_phone:
                        try:
                            db.expire_all()
                            fresh_conv = db.query(Conversation).filter_by(id=conv.id).first()
                            if fresh_conv:
                                changed = False
                                if vc_name and not fresh_conv.visitor_name:
                                    fresh_conv.visitor_name = str(vc_name)
                                    changed = True
                                if vc_email and not fresh_conv.visitor_email:
                                    fresh_conv.visitor_email = str(vc_email)
                                    changed = True
                                if vc_phone and not fresh_conv.visitor_phone:
                                    fresh_conv.visitor_phone = str(vc_phone)
                                    changed = True
                                if changed:
                                    db.commit()
                        except Exception:
                            try:
                                db.rollback()
                            except Exception:
                                pass
                    continue

                if message_type == "submit_rating":
                    rating_val = payload.get("rating")
                    feedback_val = payload.get("feedback") or None
                    if rating_val is not None and isinstance(rating_val, int) and -1 <= rating_val <= 1:
                        try:
                            from app.models.conversation_rating import ConversationRating

                            existing = (
                                db.query(ConversationRating)
                                .filter(ConversationRating.conversation_id == conv.id)
                                .first()
                            )
                            if existing:
                                existing.rating = rating_val
                                if feedback_val is not None:
                                    existing.feedback = feedback_val
                                db.commit()
                            else:
                                new_rating = ConversationRating(
                                    conversation_id=conv.id,
                                    rating=rating_val,
                                    feedback=feedback_val,
                                    session_id=session_id,
                                )
                                db.add(new_rating)
                                db.commit()
                            try:
                                await orchestrator.visitor_rated(
                                    conversation_id=conv.id,
                                    rating_val=rating_val,
                                    feedback=feedback_val,
                                )
                            except Exception:
                                pass
                            # Broadcast to agents so the right panel updates immediately.
                            try:
                                _rating_labels = {1: "\U0001f60a Good", 0: "\U0001f610 Neutral", -1: "\U0001f61e Bad"}
                                await agent_service.broadcast_to_active_agents(
                                    website_id=website_id,
                                    message_data={
                                        "type": "visitor_rated",
                                        "conversation_id": conv.id,
                                        "rating": rating_val,
                                        "rating_label": _rating_labels.get(rating_val, str(rating_val)),
                                        "website_id": website_id,
                                    },
                                    conversation_team_id=getattr(conv, "team_id", None),
                                )
                            except Exception:
                                pass
                        except Exception as e:
                            logger.warning("rating_submit_failed", error=str(e))
                            try:
                                db.rollback()
                            except Exception:
                                pass
                    continue

                user_message = payload.get("message")
                if not user_message:
                    continue

                exceeded = False
                try:
                    exceeded = await is_chat_rate_limited(
                        website_id=website_id,
                        session_id=session_id,
                        limit=settings.RATE_LIMIT_CHAT_MESSAGE,
                    )
                except Exception:
                    pass
                if exceeded:
                    await websocket.send_json(
                        {"type": "error", "message": "Rate limit exceeded. Please slow down."}
                    )
                    continue

                response = await orchestrator.handle_visitor_message(
                    website_id=website_id,
                    session_id=session_id,
                    message=user_message,
                    visitor_ws=websocket,
                    visitor_ip=(getattr(getattr(websocket, "client", None), "host", None)),
                    visitor_name=payload.get("visitor_name"),
                    visitor_email=payload.get("visitor_email"),
                    visitor_phone=payload.get("visitor_phone"),
                    client_message_id=str(payload.get("message_id") or payload.get("client_message_id")) if (payload.get("message_id") or payload.get("client_message_id")) else None,
                )
                if response:
                    await websocket.send_json({"type": "system", "message": response})

        except WebSocketDisconnect:
            pass

    except Exception as e:
        logger.error("chat_ws_with_conversation_error", error=str(e), exc_info=True)
        try:
            await websocket.close(code=1011, reason=_ws_close_reason(str(e)))
        except Exception:
            pass
    finally:
        try:
            ws_disconnect(kind="chat")
        except Exception:
            pass
        try:
            ChatService.unregister_visitor_socket(websocket)
        except Exception:
            pass
        try:
            if _heartbeat_task_2 is not None:
                _heartbeat_task_2.cancel()
        except Exception:
            pass
        try:
            ChatService.unregister_session_socket(websocket)
        except Exception:
            pass
        # Best-effort: schedule visitor_left_website event for OPEN conversations.
        try:
            if is_open and conv and conv.id not in _visitor_left_scheduled:
                _visitor_left_scheduled.add(conv.id)
                asyncio.create_task(
                    _send_delayed_visitor_left_event(
                        conversation_id=int(conv.id),
                        delay_seconds=VISITOR_LEFT_DELAY_SECONDS,
                    )
                )
        except Exception:
            pass
        db.close()
        try:
            structlog.contextvars.clear_contextvars()
        except Exception:
            pass
