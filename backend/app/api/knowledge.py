from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.knowledge_source import KnowledgeSource
from app.models.document import Document
from app.models.knowledge_chunk import KnowledgeChunk
from app.services.document_parser import parse_pdf, parse_text
from app.services.chunking_service import chunk_text
from app.services.knowledge_indexer import index_document_chunks

router = APIRouter(prefix="/knowledge", tags=["Knowledge"])


@router.post("/sources")
def create_knowledge_source(payload: dict, db: Session = Depends(get_db)):
    """
    Create a new knowledge source for a website.
    
    A knowledge source is a logical grouping for documents (e.g., "Product Manuals").
    """
    source = KnowledgeSource(
        website_id=payload["website_id"],
        name=payload["name"],
        source_type=payload["source_type"],
        meta=payload.get("metadata"),
    )

    db.add(source)
    db.commit()
    db.refresh(source)

    return {"id": source.id, "name": source.name}


@router.post("/documents/upload")
def upload_document(
    website_id: int = Form(...),
    knowledge_source_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Upload a document (PDF or TXT) and automatically chunk it.
    
    This endpoint:
    1. Parses the file to extract text
    2. Creates a Document record
    3. Chunks the text
    4. Creates KnowledgeChunk records
    """
    # Parse file based on extension
    if file.filename.endswith(".pdf"):
        raw_text = parse_pdf(file.file)
    elif file.filename.endswith(".txt"):
        raw_text = parse_text(file.file)
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only .pdf and .txt are supported."
        )

    # Create document
    document = Document(
        website_id=website_id,
        knowledge_source_id=knowledge_source_id,
        title=file.filename,
        source_uri=file.filename,
        raw_text=raw_text,
    )

    db.add(document)
    db.commit()
    db.refresh(document)

    # Chunk the text
    chunks = chunk_text(raw_text)

    # Create knowledge chunks
    for chunk in chunks:
        db.add(
            KnowledgeChunk(
                website_id=website_id,
                document_id=document.id,
                chunk_index=chunk["index"],
                content=chunk["content"],
            )
        )

    db.commit()

    return {
        "document_id": document.id,
        "title": document.title,
        "chunks_created": len(chunks),
        "text_length": len(raw_text),
    }


@router.post("/documents/text")
def ingest_text(payload: dict, db: Session = Depends(get_db)):
    """
    Ingest raw text directly (no file upload).
    
    Useful for FAQs, policies, or any text content that doesn't come from a file.
    """
    # Create document
    document = Document(
        website_id=payload["website_id"],
        knowledge_source_id=payload["knowledge_source_id"],
        title=payload.get("title", "Untitled"),
        raw_text=payload["text"],
    )

    db.add(document)
    db.commit()
    db.refresh(document)

    # Chunk the text
    chunks = chunk_text(payload["text"])

    # Create knowledge chunks
    for chunk in chunks:
        db.add(
            KnowledgeChunk(
                website_id=payload["website_id"],
                document_id=document.id,
                chunk_index=chunk["index"],
                content=chunk["content"],
            )
        )

    db.commit()

    return {
        "document_id": document.id,
        "title": document.title,
        "chunks_created": len(chunks),
        "text_length": len(payload["text"]),
    }


@router.post("/documents/{document_id}/index")
def index_document(
    document_id: int,
    website_id: int,
    db: Session = Depends(get_db),
):
    """
    Index a document's chunks into Chroma vector store.
    
    This endpoint:
    1. Retrieves all chunks for the document
    2. Generates embeddings via OpenAI
    3. Stores them in Chroma for similarity search
    
    This is a separate step from upload to allow for:
    - Cost control (explicit indexing)
    - Re-indexing with different settings
    - Batch operations
    """
    count = index_document_chunks(
        website_id=website_id,
        document_id=document_id,
        db=db,
    )

    return {
        "document_id": document_id,
        "chunks_indexed": count,
        "message": f"Successfully indexed {count} chunks into vector store",
    }


@router.get("/documents")
def list_documents(website_id: int, db: Session = Depends(get_db)):
    """
    List all documents for a website.
    """
    documents = (
        db.query(Document)
        .filter(Document.website_id == website_id)
        .order_by(Document.created_at.desc())
        .all()
    )
    
    result = []
    for doc in documents:
        # Count chunks for this document
        chunk_count = (
            db.query(KnowledgeChunk)
            .filter(KnowledgeChunk.document_id == doc.id)
            .count()
        )
        
        result.append({
            "id": doc.id,
            "title": doc.title,
            "source_uri": doc.source_uri,
            "knowledge_source_id": doc.knowledge_source_id,
            "chunk_count": chunk_count,
            "text_length": len(doc.raw_text) if doc.raw_text else 0,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
        })
    
    return result


@router.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    website_id: int,
    db: Session = Depends(get_db),
):
    """
    Delete a document and all its chunks.
    """
    document = (
        db.query(Document)
        .filter(Document.id == document_id, Document.website_id == website_id)
        .first()
    )
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete all chunks (will cascade due to relationship)
    db.query(KnowledgeChunk).filter(KnowledgeChunk.document_id == document_id).delete()
    
    # Delete document
    db.delete(document)
    db.commit()
    
    return {
        "success": True,
        "message": f"Document '{document.title}' deleted successfully",
    }
