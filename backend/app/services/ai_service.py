"""AI service (temporarily stubbed during live-chat stabilization).

This module previously performed retrieval-augmented generation against
OpenAI. While we stabilize live agent flows, we short-circuit to avoid
calling external models and to force a predictable handoff path.
"""


def generate_ai_response(
    *,
    website_id: int,
    website_instructions: str,
    user_message: str,
):
    """
    Temporary stub: returns a deterministic low-confidence result.
    This keeps downstream logic stable without invoking external AI.
    """

    return {
        "answer": "",
        "confidence": 0.0,
        "disabled": True,
        "reason": "AI temporarily disabled during stabilization",
    }

