from __future__ import annotations

from pathlib import Path
from typing import Final

from fastapi import HTTPException, UploadFile

from app.core.config import settings


_MAX_DEFAULT_BYTES = 5 * 1024 * 1024
_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

_UPLOADS_URL_PREFIX: Final[str] = "/uploads/"


def get_uploads_root() -> Path:
    """Return the filesystem directory backing the public `/uploads/*` URLs.

    This must be stable across environments and must not depend on the process
    working directory (which differs in dev vs systemd).
    """

    override = (getattr(settings, "UPLOADS_DIR", "") or "").strip()
    if override:
        return Path(override)

    # Repo root is 3 levels up from app/core/uploads.py:
    # backend/app/core/uploads.py -> backend/app/core -> backend/app -> backend -> repo root
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / "uploads"


def uploads_url_to_path(url: str) -> Path | None:
    """Map a public `/uploads/...` URL to a filesystem path under uploads root.

    Returns None for non-uploads URLs.
    """
    if not (isinstance(url, str) and url.startswith(_UPLOADS_URL_PREFIX)):
        return None

    rel = url[len(_UPLOADS_URL_PREFIX) :]
    uploads_root = get_uploads_root().resolve()
    candidate = (uploads_root / rel).resolve()

    # Prevent path traversal.
    try:
        candidate.relative_to(uploads_root)
    except Exception:
        return None

    return candidate


def _detect_image_kind(header: bytes) -> str | None:
    # PNG
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"

    # JPEG
    if header.startswith(b"\xff\xd8\xff"):
        return "jpg"

    # GIF
    if header.startswith(b"GIF87a") or header.startswith(b"GIF89a"):
        return "gif"

    # WEBP: RIFF....WEBP
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "webp"

    return None


def validate_image_upload(
    file: UploadFile,
    *,
    max_bytes: int = _MAX_DEFAULT_BYTES,
) -> str:
    """Validate an uploaded image and return a safe file extension.

    Accepts common safe raster formats: PNG/JPEG/GIF/WEBP.
    Explicitly rejects SVG.

    This is intentionally strict for production safety.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    if file.content_type == "image/svg+xml":
        raise HTTPException(status_code=400, detail="SVG uploads are not allowed")

    # Validate size
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size > max_bytes:
        raise HTTPException(status_code=400, detail=f"File size must be less than {max_bytes // (1024 * 1024)}MB")

    # Validate magic bytes
    header = file.file.read(16)
    file.file.seek(0)
    kind = _detect_image_kind(header)
    if not kind:
        raise HTTPException(status_code=400, detail="Unsupported image format. Use PNG, JPG, GIF, or WEBP")

    return kind


def validate_attachment_upload(
    file: UploadFile,
    *,
    max_bytes: int = _MAX_ATTACHMENT_BYTES,
) -> str:
    """Validate an uploaded attachment and return a safe file extension.

    Allowed:
    - PNG/JPEG/GIF/WEBP images (strict magic-byte validation)
    - PDF documents (magic-byte validation)
    - Common office and text formats (MIME-based allowlist)

    This is intentionally strict.
    """
    if not file.content_type:
        raise HTTPException(status_code=400, detail="File type is required")

    # Validate size
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size > max_bytes:
        raise HTTPException(status_code=400, detail=f"File size must be less than {max_bytes // (1024 * 1024)}MB")

    if file.content_type.startswith("image/"):
        # Reuse strict image validation
        return validate_image_upload(file, max_bytes=max_bytes)

    if file.content_type == "application/pdf":
        header = file.file.read(8)
        file.file.seek(0)
        if not header.startswith(b"%PDF-"):
            raise HTTPException(status_code=400, detail="Invalid PDF file")
        return "pdf"

    # Office + text attachments (intentionally allowlist MIME types)
    office_mime_to_ext = {
        # Word
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        # Excel
        "application/vnd.ms-excel": "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        # PowerPoint
        "application/vnd.ms-powerpoint": "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        # CSV / text
        "text/plain": "txt",
        "text/csv": "csv",
        "application/csv": "csv",
    }

    if file.content_type in office_mime_to_ext:
        # Basic sanity: ensure file is non-empty.
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)
        if size <= 0:
            raise HTTPException(status_code=400, detail="Empty file")
        return office_mime_to_ext[file.content_type]

    raise HTTPException(
        status_code=400,
        detail="Unsupported attachment type. Use an image, PDF, or a common office/text document",
    )
