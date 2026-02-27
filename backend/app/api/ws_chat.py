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


VISITOR_LEFT_DELAY_SECONDS = 2
_visitor_left_scheduled: set[int] = set()


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
    websocket: WebSocket,
    website_id: int,
    session_id: str,
    welcome_message: str,
    delay_seconds: float = 4.0,
) -> None:
    """Send the welcome automation message after a short delay.

    Delaying the welcome creates a more natural "someone is messaging you"
    feel and gives the widget time to arm notification sounds via user gesture.
    """
    try:
        await asyncio.sleep(delay_seconds)

        db2 = SessionLocal()
        try:
            from app.services.conversation_service import ConversationService

            service = ConversationService(db2)

            conversation = service.get_or_create_conversation(
                website_id=website_id,
                session_id=session_id,
            )
            if not conversation:
                return

            # Register visitor socket if not already registered.
            ChatService.register_visitor(conversation.id, websocket)

            # Ensure last_seen_at is set for newly created conversations.
            if not conversation.last_seen_at:
                conversation.last_seen_at = datetime.utcnow()
                conversation.visit_count = int(conversation.visit_count or 0) or 1
                db2.commit()

            saved = service.add_bot_message(
                conversation.id,
                welcome_message,
                event_type="automation_welcome",
            )
            await websocket.send_json(
                {
                    "type": "bot",
                    "message": welcome_message,
                    "message_obj": serialize_message(db2, saved),
                }
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
        try:
            ChatService.register_session(website_id=int(website_id), session_id=str(session_id), websocket=websocket)
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

        # Load history if a conversation already exists for this session.
        # IMPORTANT: Do NOT create a new conversation just because the widget connected.
        # We only create the conversation on the first visitor message.
        conversation = None
        try:
            conversation = conversations_repo.get_conversation_by_session(
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
            try:
                # If a delayed "left" is scheduled, treat this as a transient reconnect and
                # avoid persisting a redundant "connected" event (page refresh / quick reconnect).
                if (not _was_active) and (int(conversation.id) not in _visitor_left_scheduled):
                    await orchestrator.visitor_socket_connected(conversation_id=int(conversation.id))
            except Exception:
                pass

            try:
                messages = messages_repo.list_messages_for_conversation(db, conversation.id)

                history_messages = []
                for msg in messages:
                    history_messages.append(serialize_message(db, msg))

                await websocket.send_json(
                    {
                        "type": "history",
                        "conversation_id": conversation.id,
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

        # Welcome automation: send on first visit or if returning after cooldown.
        # DB-backed automation only (no legacy widget_config.automations fallback).
        try:
            from app.services.conversation_service import ConversationService
            from app.services.automation_service import AutomationService

            automation_service = AutomationService(db)
            action = automation_service.get_first_bot_message_action(website_id=website_id, trigger="visitor_connected")
            welcome_message = action.get("message").strip() if (action and isinstance(action.get("message"), str)) else None

            cooldown_seconds = automation_service.get_cooldown_seconds(
                website_id=website_id,
                trigger="visitor_connected",
                default_seconds=24 * 3600,
            )
            cooldown = timedelta(seconds=max(1, int(cooldown_seconds)))

            now = datetime.utcnow()

            prev_seen_at = None

            should_send = bool(isinstance(welcome_message, str) and welcome_message.strip())

            # Update last_seen_at for existing conversations on every connect.
            if conversation:
                prev_seen_at = _to_naive_utc(conversation.last_seen_at)
                conversation.last_seen_at = now
                if prev_seen_at and (now - prev_seen_at) > cooldown:
                    conversation.visit_count = int(conversation.visit_count or 0) + 1
                db.commit()

            if should_send and conversation:
                last_welcome = messages_repo.get_last_welcome_message(db, conversation.id)

                if last_welcome and last_welcome.created_at:
                    last_welcome_at = _to_naive_utc(last_welcome.created_at)
                    should_send = bool(last_welcome_at and (now - last_welcome_at) > cooldown)
                else:
                    # If we've never tracked last_seen_at before, use other activity timestamps.
                    last_activity = (
                        prev_seen_at
                        or conversation.last_visitor_message_at
                        or conversation.last_agent_message_at
                        or conversation.updated_at
                        or conversation.created_at
                    )
                    if last_activity:
                        last_activity_at = _to_naive_utc(last_activity)
                        should_send = bool(last_activity_at and (now - last_activity_at) > cooldown)

            if should_send:
                # Read configurable delay from automation conditions (default 3s).
                welcome_delay = 3.0
                try:
                    welcome_automation = automation_service.list_enabled_for_trigger(
                        website_id=website_id, trigger="visitor_connected"
                    )
                    if welcome_automation:
                        conds = welcome_automation[0].conditions or {}
                        if isinstance(conds, str):
                            import json as _json
                            conds = _json.loads(conds)
                        raw_delay = conds.get("welcome_delay_seconds")
                        if raw_delay is not None:
                            welcome_delay = max(0.0, float(raw_delay))
                except Exception:
                    pass

                asyncio.create_task(
                    _send_delayed_welcome(
                        websocket=websocket,
                        website_id=website_id,
                        session_id=session_id,
                        welcome_message=str(welcome_message).strip(),
                        delay_seconds=welcome_delay,
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
                        conversation = conversations_repo.get_conversation_by_session(
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
                            )
                    except Exception:
                        pass

                continue

            # Smartsupp-like UX: allow the visitor to explicitly end/close the chat.
            # IMPORTANT: this should NOT mark the conversation as resolved.
            # The agent is the only one who should resolve conversations.
            if message_type == "end_chat":
                conversation = None
                try:
                    conversation = conversations_repo.get_conversation_by_session(
                        db,
                        website_id=website_id,
                        session_id=session_id,
                    )
                except Exception:
                    conversation = None

                if not conversation:
                    # Nothing to close.
                    continue

                # Trigger automation-driven bot/system messages for this event.
                # This does not change conversation.status.
                try:
                    await orchestrator.visitor_closed_chat(conversation_id=int(conversation.id))
                except Exception:
                    # Best-effort: still allow the socket to continue.
                    pass

                # Optional ack for the widget.
                try:
                    await websocket.send_json(
                        {
                            "type": "end_chat_ok",
                            "conversation_id": int(conversation.id),
                            "website_id": website_id,
                        }
                    )
                except Exception:
                    pass

                continue

            if message_type == "typing":
                is_typing = bool(payload.get("is_typing"))

                conversation_id: int | None = registered_conversation_id
                conversation = None
                if conversation_id is None:
                    try:
                        conversation = conversations_repo.get_conversation_by_session(
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

                if conversation and conversation.assigned_agent_id:
                    await agent_service.send_to_agent(conversation.assigned_agent_id, event)
                else:
                    await agent_service.broadcast_to_active_agents(
                        website_id=website_id,
                        message_data=event,
                        include_global=True,
                    )

                continue

            user_message = payload.get("message")
            if not user_message:
                continue

            # Optional client-generated message id (widget can use this to reconcile optimistic sends)
            client_message_id = payload.get("message_id") or payload.get("client_message_id")

            visitor_name = payload.get("visitor_name")
            visitor_email = payload.get("visitor_email")
            
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
            )

            # Conversation may have been created on first message; register for cleanup.
            if registered_conversation_id is None:
                try:
                    from app.models.conversation import Conversation

                    conv = (
                        db.query(Conversation)
                        .filter_by(session_id=session_id, website_id=website_id)
                        .first()
                    )
                    if conv:
                        registered_conversation_id = conv.id
                except Exception:
                    pass

            # Store visitor contact info if provided (conversation exists now after first message)
            if visitor_name or visitor_email:
                try:
                    from app.models.conversation import Conversation
                    conv = (
                        db.query(Conversation)
                        .filter_by(session_id=session_id, website_id=website_id)
                        .first()
                    )
                    if conv:
                        changed = False
                        if visitor_name and not conv.visitor_name:
                            conv.visitor_name = str(visitor_name)
                            changed = True
                        if visitor_email and not conv.visitor_email:
                            conv.visitor_email = str(visitor_email)
                            changed = True
                        if changed:
                            db.commit()
                except Exception:
                    # Don't fail chat delivery if metadata storage fails
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
