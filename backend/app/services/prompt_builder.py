def build_prompt(
    *,
    website_instructions: str,
    context_chunks: list[dict],
    user_message: str,
):
    """
    Build system and user prompts for AI chat completion.
    
    Args:
        website_instructions: Website-specific AI instructions
        context_chunks: List of relevant knowledge chunks from retrieval
        user_message: The user's question/message
        
    Returns:
        Tuple of (system_prompt, user_prompt)
    """
    # Build context from retrieved chunks
    context_text = "\n\n".join(
        f"- {chunk['content']}" for chunk in context_chunks
    )

    # System prompt with instructions and rules
    system_prompt = f"""
You are an AI support assistant for a website.

INSTRUCTIONS:
{website_instructions or "Be helpful and provide accurate information."}

RULES:
- Answer ONLY using the provided context.
- If context is insufficient, say you are not sure and cannot answer confidently.
- Never hallucinate or make up information.
- Be concise and helpful.
- Stay professional and friendly.
"""

    # User prompt with context and question
    user_prompt = f"""
CONTEXT:
{context_text if context_text else "No specific context available."}

USER QUESTION:
{user_message}
"""

    return system_prompt.strip(), user_prompt.strip()
