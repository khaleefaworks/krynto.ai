from __future__ import annotations


def generate_ai_response(website_id: int, website_instructions: str, user_message: str) -> dict:
    """Stub AI response used by unit tests.

    The production implementation can be wired later; Phase 0 keeps this as a
    predictable, side-effect-free function.
    """

    return {
        "disabled": True,
        "confidence": 0.0,
        "answer": "",
    }
