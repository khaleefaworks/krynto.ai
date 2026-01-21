from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_agent
from app.core.database import get_db
from app.core.uploads import get_uploads_root, validate_attachment_upload
from app.models.conversation import Conversation
from app.models.user import User


router = APIRouter(prefix="/attachments", tags=["attachments"])


class AttachmentUploadResponse(BaseModel):
    url: str
    filename: str
    content_type: str


@router.post("/upload", response_model=AttachmentUploadResponse)
async def upload_attachment(
    conversation_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(require_agent),
    db: Session = Depends(get_db),
):
    """Upload an attachment and return a public URL.

    This does not create a message record. The client can insert the returned
    URL into the outgoing message content.
    """
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")

    ext = validate_attachment_upload(file)

    upload_dir = get_uploads_root() / "attachments" / str(conversation_id)
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_filename = f"{uuid4().hex}.{ext}"
    file_path = upload_dir / unique_filename

    # Stream file to disk
    with file_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    public_url = f"/uploads/attachments/{conversation_id}/{unique_filename}"

    return AttachmentUploadResponse(
        url=public_url,
        filename=file.filename or unique_filename,
        content_type=file.content_type or "application/octet-stream",
    )
