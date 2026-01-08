from __future__ import annotations

from fastapi import HTTPException, UploadFile


_MAX_DEFAULT_BYTES = 5 * 1024 * 1024


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
