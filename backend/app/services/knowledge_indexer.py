from sqlalchemy.orm import Session
from app.models.knowledge_chunk import KnowledgeChunk
from app.services.embedding_service import embed_texts
from app.services.vector_store import get_collection


def index_document_chunks(
    *,
    website_id: int,
    document_id: int,
    db: Session,
):
    """
    Index all chunks from a document into Chroma vector store.
    
    This function:
    1. Retrieves all chunks for the document
    2. Generates embeddings via OpenAI
    3. Stores them in Chroma with metadata
    
    Args:
        website_id: Website ID for collection isolation
        document_id: Document ID to index chunks from
        db: Database session
        
    Returns:
        Number of chunks indexed
    """
    chunks = (
        db.query(KnowledgeChunk)
        .filter(
            KnowledgeChunk.website_id == website_id,
            KnowledgeChunk.document_id == document_id,
        )
        .order_by(KnowledgeChunk.chunk_index)
        .all()
    )

    if not chunks:
        return 0

    # Extract text content
    texts = [chunk.content for chunk in chunks]
    
    # Generate embeddings
    embeddings = embed_texts(texts)

    # Get website-specific collection
    collection = get_collection(website_id)

    # Add to Chroma with metadata
    collection.add(
        ids=[f"chunk_{c.id}" for c in chunks],
        documents=texts,
        embeddings=embeddings,
        metadatas=[
            {
                "website_id": website_id,
                "document_id": document_id,
                "chunk_index": c.chunk_index,
            }
            for c in chunks
        ],
    )

    return len(chunks)
