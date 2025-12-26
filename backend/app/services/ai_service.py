from openai import OpenAI
from app.core.config import settings
from app.services.retrieval_service import retrieve_context
from app.services.prompt_builder import build_prompt
from app.services.confidence import calculate_confidence

client = OpenAI(api_key=settings.OPENAI_API_KEY)


def generate_ai_response(
    *,
    website_id: int,
    website_instructions: str,
    user_message: str,
):
    """
    Generate AI response using RAG (Retrieval-Augmented Generation).
    
    Flow:
    1. Retrieve relevant knowledge chunks via similarity search
    2. Build system and user prompts with context
    3. Call OpenAI GPT-4o-mini
    4. Calculate confidence score
    5. Return answer with confidence
    
    Args:
        website_id: Website ID for knowledge retrieval
        website_instructions: Website-specific AI instructions
        user_message: User's question/message
        
    Returns:
        Dict with 'answer' and 'confidence' keys
    """
    # Retrieve relevant context from vector store
    context_chunks = retrieve_context(
        website_id=website_id,
        query=user_message,
        top_k=5,
    )

    # Build prompts with context
    system_prompt, user_prompt = build_prompt(
        website_instructions=website_instructions,
        context_chunks=context_chunks,
        user_message=user_message,
    )

    # Generate response using OpenAI
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.2,  # Low temperature for more focused, factual responses
    )

    answer = response.choices[0].message.content

    # Calculate confidence score
    confidence = calculate_confidence(answer, context_chunks)

    return {
        "answer": answer,
        "confidence": confidence,
    }

