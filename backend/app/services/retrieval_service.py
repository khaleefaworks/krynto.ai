from app.services.embedding_service import embed_texts
from app.services.vector_store import get_collection


def retrieve_context(
    *,
    website_id: int,
    query: str,
    top_k: int = 5,
):
    """
    Retrieve relevant context chunks for a query using similarity search.
    
    This function:
    1. Embeds the query
    2. Searches the website's Chroma collection
    3. Returns top-k most similar chunks
    
    Args:
        website_id: Website ID to search within
        query: Search query string
        top_k: Number of results to return (default: 5)
        
    Returns:
        List of dicts with 'content' and 'metadata' keys
    """
    # Embed the query
    query_embedding = embed_texts([query])[0]
    
    # Get website collection
    collection = get_collection(website_id)

    # Perform similarity search
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k,
    )

    # Extract results
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    return [
        {
            "content": doc,
            "metadata": meta,
        }
        for doc, meta in zip(documents, metadatas)
    ]
