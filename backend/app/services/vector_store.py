import chromadb
from chromadb.config import Settings

_chroma_client = None


def get_chroma_client():
    """Get or create the global Chroma client instance."""
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.Client(
            Settings(
                persist_directory="./chroma",
                anonymized_telemetry=False,
            )
        )
    return _chroma_client


def get_collection(website_id: int):
    """
    Get or create a collection for a specific website.
    
    Each website has its own collection for perfect isolation.
    """
    client = get_chroma_client()
    return client.get_or_create_collection(
        name=f"website_{website_id}"
    )
