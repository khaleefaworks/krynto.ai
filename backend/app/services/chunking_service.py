def chunk_text(text: str, chunk_size=500, overlap=50):
    """
    Split text into overlapping chunks.
    
    Args:
        text: The text to chunk
        chunk_size: Maximum size of each chunk
        overlap: Number of characters to overlap between chunks
        
    Returns:
        List of dicts with 'index' and 'content' keys
    """
    chunks = []
    start = 0
    index = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]

        chunks.append({
            "index": index,
            "content": chunk
        })

        index += 1
        start = end - overlap

    return chunks
