from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional
from urllib.parse import urlparse

from fastapi import HTTPException

from app.core.config import settings


@dataclass(frozen=True)
class WidgetOrigin:
    host: str


def _extract_host_from_url(url: str) -> Optional[str]:
    try:
        parsed = urlparse(str(url))
    except Exception:
        return None

    host = parsed.hostname
    if not host:
        return None

    host = host.strip().strip(".").lower()
    if not host:
        return None

    # Normalize unicode domains to ASCII punycode so comparisons are consistent.
    try:
        host = host.encode("idna").decode("ascii")
    except Exception:
        pass

    return host


def get_widget_request_host(headers: Mapping[str, str]) -> Optional[str]:
    """Best-effort visitor site host.

    - WebSockets reliably send Origin.
    - Script tags often omit Origin but do include Referer.

    Returns normalized host (lowercase, no trailing dot) or None.
    """
    origin = headers.get("origin") or headers.get("Origin")
    if origin:
        return _extract_host_from_url(origin)

    referer = headers.get("referer") or headers.get("Referer")
    if referer:
        return _extract_host_from_url(referer)

    return None


def _normalize_domain(domain: str) -> str:
    d = (domain or "").strip().strip(".").lower()
    try:
        d = d.encode("idna").decode("ascii")
    except Exception:
        pass
    return d


def is_host_allowed_for_website(*, request_host: str, website_domain: str) -> bool:
    """Allow exact domain or any subdomain.

    Examples (website_domain = example.com):
    - example.com ✅
    - www.example.com ✅
    - x.y.example.com ✅
    - evil-example.com ❌
    """
    host = _normalize_domain(request_host)
    domain = _normalize_domain(website_domain)

    if not host or not domain:
        return False

    return host == domain or host.endswith("." + domain)


def enforce_widget_domain_or_403(*, headers: Mapping[str, str], website_domain: str) -> str:
    """Enforce widget domain lock.

    In production, missing Origin/Referer is rejected because it makes domain
    verification impossible.

    Returns the normalized request host if allowed.
    """
    request_host = get_widget_request_host(headers)

    if not request_host:
        if settings.is_production():
            raise HTTPException(status_code=403, detail="Widget origin is required")
        return ""

    if not is_host_allowed_for_website(request_host=request_host, website_domain=website_domain):
        raise HTTPException(status_code=403, detail="Widget origin not allowed")

    return request_host
