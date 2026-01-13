import asyncio

from app.services.chat_service import ChatService


class _FailingWebSocket:
    async def send_json(self, _payload):
        raise RuntimeError("boom")


def test_send_to_visitor_drops_stale_socket_on_error():
    conv_id = 123
    ChatService.active_visitors.clear()

    ChatService.register_visitor(conv_id, _FailingWebSocket())
    assert conv_id in ChatService.active_visitors

    asyncio.run(ChatService.send_to_visitor(conv_id, {"type": "test"}))

    # Socket should be removed after failure to avoid repeated send errors.
    assert conv_id not in ChatService.active_visitors


def test_unregister_visitor_socket_removes_only_matching_socket():
    ws1 = object()
    ws2 = object()

    ChatService.active_visitors.clear()
    ChatService.register_visitor(1, ws1)
    ChatService.register_visitor(2, ws1)
    ChatService.register_visitor(3, ws2)

    ChatService.unregister_visitor_socket(ws1)

    assert 1 not in ChatService.active_visitors
    assert 2 not in ChatService.active_visitors
    assert 3 in ChatService.active_visitors
