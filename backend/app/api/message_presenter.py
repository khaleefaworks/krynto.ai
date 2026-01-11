"""Backward-compatible shim.

The canonical message presenter lives in `app.core.message_presenter`.
Keep this module to avoid breaking older imports.
"""

from app.core.message_presenter import (  # noqa: F401
    resolve_sender_user,
    message_presentation,
    serialize_message,
)
