from app.core.message_presenter import resolve_actor_kind


def test_resolve_actor_kind_banner_event_is_not_chat():
    # emit_system_event's resolve/end-chat banners (e.g. "conversation_resolved_message")
    # must classify as kind="event", not "chat" — the widget only clears a pending
    # chatbot_pending typing dot for kind="chat" messages (see
    # ConversationOrchestrator._execute_flow's emit_system_event branch, which relies
    # on this to decide whether to send the chatbot_pending marker at all).
    actor, kind = resolve_actor_kind(
        sender_type="system", sender="system", event_type="conversation_resolved_message"
    )
    assert (actor, kind) == ("system", "event")


def test_resolve_actor_kind_bot_authored_system_message_is_chat():
    actor, kind = resolve_actor_kind(
        sender_type="system", sender="bot", event_type="some_custom_event"
    )
    assert (actor, kind) == ("bot", "chat")
