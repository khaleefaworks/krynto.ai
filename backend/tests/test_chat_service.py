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
