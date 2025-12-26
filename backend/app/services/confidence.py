def calculate_confidence(answer: str, context_chunks: list[dict]) -> float:
    """
    Calculate confidence score for AI answer using simple heuristics.
    
    This is intentionally heuristic-based for now. Can be improved later
    with more sophisticated methods without schema changes.
    
    Args:
        answer: AI's generated answer
        context_chunks: Knowledge chunks that were used
        
    Returns:
        Confidence score between 0.0 and 1.0
    """
    # No context means low confidence
    if not context_chunks:
        return 0.0

    # Check for explicit uncertainty indicators
    uncertainty_phrases = [
        "not sure",
        "i don't know",
        "cannot answer",
        "unable to help",
        "don't have information",
    ]
    
    answer_lower = answer.lower()
    if any(phrase in answer_lower for phrase in uncertainty_phrases):
        return 0.2

    # Length-based heuristic (longer, more detailed answers = higher confidence)
    # Assumes 300 chars is a "full" confident answer
    length_score = min(len(answer) / 300, 1.0)

    # Combined score: base 0.5 + length contribution up to 0.5
    confidence = 0.5 + (length_score * 0.5)

    return round(confidence, 2)
