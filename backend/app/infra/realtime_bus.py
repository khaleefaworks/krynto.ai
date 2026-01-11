import asyncio
import json
import os
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


EVENT_CHANNEL = os.getenv("AI_CHATASSIST_REDIS_CHANNEL", "aichatassist:events:v1")


@dataclass(frozen=True)
class BusEvent:
    schema_version: int = 1
    event_type: str
    payload: dict
    agent_id: int | None = None
    conversation_id: int | None = None
    website_id: int | None = None
    include_global: bool | None = None

    def to_dict(self) -> dict:
        return {
            "schema_version": int(self.schema_version),
            "event_type": self.event_type,
            "payload": self.payload,
            "agent_id": self.agent_id,
            "conversation_id": self.conversation_id,
            "website_id": self.website_id,
            "include_global": self.include_global,
        }


class RealtimeBus:
    """Optional Redis Pub/Sub bus for cross-worker WebSocket delivery.

    If REDIS_URL is not set (or redis lib isn't available), this becomes a no-op.
    """

    def __init__(self) -> None:
        self._redis_url = (getattr(settings, "REDIS_URL", "") or "").strip()
        self._enabled: bool = bool(self._redis_url)
        self._redis = None
        self._pubsub = None
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def publish(self, event: BusEvent) -> None:
        if not self._enabled:
            return

        try:
            redis_asyncio = _import_redis_asyncio()
            if redis_asyncio is None:
                return

            if self._redis is None:
                self._redis = redis_asyncio.from_url(self._redis_url, decode_responses=True)

            await self._redis.publish(EVENT_CHANNEL, json.dumps(event.to_dict()))
        except Exception as e:
            logger.error("realtime_bus_publish_failed", error=str(e), exc_info=True)
            # Force a reconnect on next publish.
            self._redis = None

    async def start(self, handler: Callable[[dict], Awaitable[None]]) -> None:
        if not self._enabled:
            return

        if self._task is not None:
            return

        redis_asyncio = _import_redis_asyncio()
        if redis_asyncio is None:
            self._enabled = False
            return

        self._stop_event = asyncio.Event()

        async def _connect() -> None:
            self._redis = redis_asyncio.from_url(self._redis_url, decode_responses=True)
            self._pubsub = self._redis.pubsub()
            await self._pubsub.subscribe(EVENT_CHANNEL)

        await _connect()

        async def _run() -> None:
            assert self._pubsub is not None
            assert self._stop_event is not None

            logger.info("realtime_bus_subscriber_started", channel=EVENT_CHANNEL)

            backoff_seconds: float = 1.0

            try:
                while not self._stop_event.is_set():
                    try:
                        msg = await self._pubsub.get_message(
                            ignore_subscribe_messages=True,
                            timeout=1.0,
                        )
                    except Exception as e:
                        # Connection dropped or pubsub is unhealthy. Reconnect with backoff.
                        logger.warning(
                            "realtime_bus_subscriber_error",
                            error=str(e),
                            backoff_seconds=backoff_seconds,
                        )
                        await asyncio.sleep(backoff_seconds)
                        backoff_seconds = min(backoff_seconds * 2.0, 30.0)
                        try:
                            # Tear down best-effort.
                            if self._pubsub is not None:
                                await self._pubsub.close()
                        except Exception:
                            pass
                        try:
                            if self._redis is not None:
                                await self._redis.aclose()
                        except Exception:
                            pass

                        try:
                            await _connect()
                            assert self._pubsub is not None
                            backoff_seconds = 1.0
                            logger.info("realtime_bus_reconnected", channel=EVENT_CHANNEL)
                        except Exception as e2:
                            logger.warning("realtime_bus_reconnect_failed", error=str(e2))
                        continue

                    if not msg:
                        await asyncio.sleep(0)
                        continue

                    data = msg.get("data")
                    if not data:
                        continue

                    try:
                        event_obj = json.loads(data)
                    except Exception:
                        logger.warning("realtime_bus_invalid_json", data_preview=str(data)[:200])
                        continue

                    # Backwards compatibility: tolerate older events with no version.
                    try:
                        if isinstance(event_obj, dict) and "schema_version" not in event_obj:
                            event_obj["schema_version"] = 1
                    except Exception:
                        pass

                    try:
                        await handler(event_obj)
                    except Exception as e:
                        logger.error("realtime_bus_handler_failed", error=str(e), exc_info=True)
            finally:
                try:
                    await self._pubsub.unsubscribe(EVENT_CHANNEL)
                except Exception:
                    pass
                try:
                    await self._pubsub.close()
                except Exception:
                    pass
                logger.info("realtime_bus_subscriber_stopped")

        self._task = asyncio.create_task(_run())

    async def stop(self) -> None:
        if not self._enabled:
            return

        if self._stop_event is not None:
            self._stop_event.set()

        if self._task is not None:
            try:
                await self._task
            finally:
                self._task = None

        try:
            if self._redis is not None:
                await self._redis.aclose()
        except Exception:
            pass
        finally:
            self._redis = None
            self._pubsub = None
            self._stop_event = None


def _import_redis_asyncio():
    try:
        import redis.asyncio as redis_asyncio  # type: ignore

        return redis_asyncio
    except Exception:
        logger.warning("redis_not_installed_or_unavailable_realtime_bus_disabled")
        return None


# Module-level singleton
realtime_bus = RealtimeBus()
