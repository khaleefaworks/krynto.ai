from app.services.ai_service import generate_ai_response


def test_ai_stub_returns_disabled_marker():
    result = generate_ai_response(website_id=1, website_instructions="", user_message="hi")
    assert result["disabled"] is True
    assert result["confidence"] == 0.0
    assert result["answer"] == ""
