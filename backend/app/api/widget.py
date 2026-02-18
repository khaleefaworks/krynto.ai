"""
Widget API - Public endpoints for the chat widget.

These endpoints are called by the embedded chat widget on visitor websites.
They must be fast, reliable, and not require authentication.
"""

from typing import Optional
import json
from fastapi import APIRouter, Query, HTTPException, Depends, Request, Response as FastAPIResponse, File, UploadFile
from fastapi.responses import Response as RawResponse, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.config import settings
from app.core.widget_origin import enforce_widget_domain_or_403
from app.models.website import Website
from app.services.website_resolver import is_website_online
from app.api.deps import require_authenticated_user


from app.models.message import Message, MessageSenderType
from datetime import datetime, timezone
from uuid import uuid4

from app.core.uploads import get_uploads_root, validate_attachment_upload

router = APIRouter(prefix="/widget", tags=["widget"])


def _set_widget_cors_headers(*, response: FastAPIResponse, request: Request) -> None:
    origin = request.headers.get("origin") or request.headers.get("Origin")
    if not origin:
        return

    request_headers = request.headers.get("access-control-request-headers") or request.headers.get(
        "Access-Control-Request-Headers"
    )

    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Max-Age"] = "600"
    response.headers["Access-Control-Allow-Headers"] = request_headers or "*"


class WidgetReadStateResponse(BaseModel):
    # A new visitor session may not have a Conversation row yet.
    # Use 0 to represent "not created yet".
    conversation_id: int = 0
    last_read_at: Optional[datetime]
    first_unread_message_id: Optional[int]
    unread_count: int = 0


class WidgetAttachmentUploadResponse(BaseModel):
    url: str
    filename: str
    content_type: str
    conversation_id: int


@router.post("/read")
async def mark_widget_read(
    request: Request,
    response: FastAPIResponse,
    website_id: int = Query(...),
    session_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Mark a conversation as read by the visitor."""
    from app.models.conversation import Conversation

    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    _set_widget_cors_headers(response=response, request=request)
    
    conv = db.query(Conversation).filter(
        Conversation.website_id == website_id,
        Conversation.session_id == session_id
    ).first()
    
    if not conv:
        # Conversation is created lazily (typically on first message / WS activity).
        # Returning 200 avoids noisy 404s in browser consoles.
        return {"success": True, "conversation_id": 0}
        
    conv.visitor_last_read_at = datetime.now(timezone.utc)
    db.commit()

    return {"success": True, "conversation_id": conv.id}


@router.options("/read")
async def mark_widget_read_options(
    request: Request,
    response: FastAPIResponse,
    website_id: int = Query(None),
    db: Session = Depends(get_db),
):
    if website_id is not None:
        website = db.query(Website).filter(Website.id == website_id).first()
        if website:
            try:
                enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
            except HTTPException:
                # Return preflight response without ACAO if not allowed.
                return RawResponse(status_code=204)
    _set_widget_cors_headers(response=response, request=request)
    return RawResponse(status_code=204)


@router.get("/read-state", response_model=WidgetReadStateResponse)
async def get_widget_read_state(
    request: Request,
    response: FastAPIResponse,
    website_id: int = Query(...),
    session_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return read state for the visitor thread UI."""
    from app.models.conversation import Conversation

    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    _set_widget_cors_headers(response=response, request=request)
    
    conv = db.query(Conversation).filter(
        Conversation.website_id == website_id,
        Conversation.session_id == session_id
    ).first()
    
    if not conv:
        return {
            "conversation_id": 0,
            "last_read_at": None,
            "first_unread_message_id": None,
            "unread_count": 0,
        }
        
    last_read_at = conv.visitor_last_read_at
    
    # Find the earliest AGENT or BOT or SYSTEM message after last_read_at.
    first_unread_message_id = None
    unread_count = 0
    try:
        q = db.query(Message).filter(
            Message.conversation_id == conv.id,
            Message.sender_type != MessageSenderType.VISITOR
        )
        if last_read_at is not None:
            q = q.filter(Message.created_at > last_read_at)
        
        unread_count = q.count()
        first_unread = q.order_by(Message.created_at.asc(), Message.id.asc()).first()
        first_unread_message_id = int(first_unread.id) if first_unread else None
    except Exception:
        first_unread_message_id = None
        unread_count = 0
        
    return {
        "conversation_id": conv.id,
        "last_read_at": last_read_at,
        "first_unread_message_id": first_unread_message_id,
        "unread_count": unread_count,
    }


@router.options("/read-state")
async def get_widget_read_state_options(
    request: Request,
    response: FastAPIResponse,
    website_id: int = Query(None),
    db: Session = Depends(get_db),
):
    if website_id is not None:
        website = db.query(Website).filter(Website.id == website_id).first()
        if website:
            try:
                enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
            except HTTPException:
                return RawResponse(status_code=204)
    _set_widget_cors_headers(response=response, request=request)
    return RawResponse(status_code=204)


@router.post("/attachments/upload", response_model=WidgetAttachmentUploadResponse)
async def widget_upload_attachment(
    request: Request,
    response: FastAPIResponse,
    website_id: int = Query(...),
    session_id: str = Query(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload an attachment from the public widget.

    This does not create a message record; the client should embed the returned
    public URL into the outgoing message content.
    """
    from app.models.conversation import Conversation

    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    _set_widget_cors_headers(response=response, request=request)

    conv = (
        db.query(Conversation)
        .filter(Conversation.website_id == website_id, Conversation.session_id == session_id)
        .first()
    )
    if not conv:
        conv = Conversation(
            website_id=website_id,
            session_id=session_id,
            visitor_ip=(request.client.host if request.client else None),
        )
        db.add(conv)
        db.commit()
        db.refresh(conv)

    ext = validate_attachment_upload(file)

    upload_dir = get_uploads_root() / "attachments" / str(conv.id)
    upload_dir.mkdir(parents=True, exist_ok=True)

    unique_filename = f"{uuid4().hex}.{ext}"
    file_path = upload_dir / unique_filename

    with file_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)

    public_url = f"/uploads/attachments/{conv.id}/{unique_filename}"

    return WidgetAttachmentUploadResponse(
        url=public_url,
        filename=file.filename or unique_filename,
        content_type=file.content_type or "application/octet-stream",
        conversation_id=int(conv.id),
    )


@router.options("/attachments/upload")
async def widget_upload_attachment_options(
    request: Request,
    response: FastAPIResponse,
    website_id: int = Query(None),
    db: Session = Depends(get_db),
):
    if website_id is not None:
        website = db.query(Website).filter(Website.id == website_id).first()
        if website:
            try:
                enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
            except HTTPException:
                return RawResponse(status_code=204)
    _set_widget_cors_headers(response=response, request=request)
    return RawResponse(status_code=204)


@router.get("/loader.js")
async def get_widget_loader(request: Request, key: str, db: Session = Depends(get_db)):
    """
    Dynamic widget loader endpoint - serves JavaScript with embedded website configuration.
    
    This is called by the embed snippet on client websites.
    Returns a JavaScript file that initializes the chat widget with the correct website ID.
    
    Usage: <script src="https://your-domain.com/widget/loader.js?key=WIDGET_KEY"></script>
    """
    # Find website by widget_key
    website = db.query(Website).filter(Website.widget_key == key).first()
    
    if not website:
        # Return 404 as JavaScript comment to avoid console errors
        return RawResponse(
            content=f"// Error: Invalid widget key",
            media_type="application/javascript",
            status_code=404
        )

    # Domain lock: only allow this widget key to be used from the website domain/subdomains.
    try:
        enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    except HTTPException as exc:
        # Always return JavaScript to avoid browser OpaqueResponseBlocking on JSON error payloads.
        return RawResponse(
            content=f"// Error: {exc.detail}",
            media_type="application/javascript",
            status_code=exc.status_code,
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    
    # Get widget configuration
    config = website.widget_config or {}
    theme = config.get('theme', 'dark')
    position = config.get('position', 'bottom-right')
    welcome_message = config.get('welcome_message', 'Hi! How can we help you today?')
    primary_color = config.get('primary_color', '#000000')

    header_title = config.get("header_title", "How can we help?")
    online_status_text = config.get("online_status_text", "We reply immediately")
    bubble_text = config.get("bubble_text", "Chat")
    header_icon_url = config.get("header_icon_url")
    show_emoji_picker = config.get("show_emoji_picker", True)
    show_attachments = config.get("show_attachments", False)
    branding_text = config.get("branding_text")
    
    def _normalize_base(base: str) -> str:
        b = (base or "").strip()
        return b[:-1] if b.endswith("/") else b

    api_base = _normalize_base(settings.PUBLIC_BASE_URL or str(request.base_url))
    if api_base.startswith("https://"):
        ws_base = "wss://" + api_base[len("https://"):]
    elif api_base.startswith("http://"):
        ws_base = "ws://" + api_base[len("http://"):]
    else:
        ws_base = api_base

    # Generate dynamic JavaScript
    js_content = f"""
(function() {{
  'use strict';
  
  // AI ChatAssist Widget Configuration
  var _aichatassist = window._aichatassist || {{}};
  _aichatassist.websiteId = {website.id};
  _aichatassist.widgetKey = '{key}';
    _aichatassist.apiUrl = '{api_base}';
    _aichatassist.wsUrl = '{ws_base}';
  _aichatassist.theme = '{theme}';
  _aichatassist.position = '{position}';
    _aichatassist.welcomeMessage = {json.dumps(welcome_message)};
  _aichatassist.primaryColor = '{primary_color}';

    // Optional UI config (if not provided, widget defaults apply)
    _aichatassist.headerTitle = {json.dumps(header_title)};
    _aichatassist.onlineStatusText = {json.dumps(online_status_text)};
    _aichatassist.bubbleText = {json.dumps(bubble_text)};
    _aichatassist.headerIconUrl = {json.dumps(header_icon_url)};
    _aichatassist.showEmojiPicker = {json.dumps(bool(show_emoji_picker))};
    _aichatassist.showAttachments = {json.dumps(bool(show_attachments))};
    _aichatassist.brandingText = {json.dumps(branding_text)};
  
  // Load the widget CSS
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = _aichatassist.apiUrl + '/widget/chat-widget.css';
  document.head.appendChild(link);
  
  // Load the widget script
  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = _aichatassist.apiUrl + '/widget/chat-widget.js';
  
  var firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(script, firstScript);
  
  window._aichatassist = _aichatassist;
}})();
"""
    
    return RawResponse(
        content=js_content,
        media_type="application/javascript",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )


@router.get("/snippet/{website_id}")
async def get_widget_snippet(
    request: Request,
    website_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(require_authenticated_user),
):
    """
    Get the embed snippet code for a website.
    This is shown to admins in the dashboard to copy-paste into their website.
    """
    website = db.query(Website).filter(Website.id == website_id).first()

    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    def _normalize_base(base: str) -> str:
        b = (base or "").strip()
        return b[:-1] if b.endswith("/") else b

    api_base = _normalize_base(settings.PUBLIC_BASE_URL or str(request.base_url))

    # Generate the embed snippet (like Smartsupp)
    snippet = f"""<!-- AI ChatAssist Live Chat script -->
    <script type="text/javascript">
    var _aichatassist = _aichatassist || {{}};
    _aichatassist.key = '{website.widget_key}';
    window.aichatassist||(function(d) {{
      var s,c,o=aichatassist=function(){{ o._.push(arguments)}}; o._=[];
      s=d.getElementsByTagName('script')[0];c=d.createElement('script');
      c.type='text/javascript';c.charset='utf-8';c.async=true;
            // Ensure the loader request includes a Referer on sites that set Referrer-Policy: no-referrer
            // (required for server-side domain lock verification).
            c.referrerPolicy='origin';
      c.src='{api_base}/widget/loader.js?key=' + _aichatassist.key;
      s.parentNode.insertBefore(c,s);
    }})(document);
    </script>
    <noscript> Powered by <a href="#" target="_blank">AI ChatAssist</a></noscript>"""
    
    return JSONResponse({
        "website_id": website.id,
        "website_name": website.name,
        "widget_key": website.widget_key,
        "snippet": snippet
    })


class WidgetStatusResponse(BaseModel):
    """Response model for widget status check"""
    online: bool
    # ai_enabled will be added later when AI feature is implemented


@router.get("/status", response_model=WidgetStatusResponse)
def get_widget_status(
    request: Request,
    website_id: int = Query(..., description="Website ID to check status for"),
    db: Session = Depends(get_db),
):
    """
    Get online/offline status for a website.
    
    This endpoint is called by the chat widget to determine:
    - Whether to show "We're online" or "We're offline"
    - Whether to enable chat input or show offline message form
    
    A website is online when at least one agent is:
    - Assigned to the website
    - Active (account enabled)
    - Available (user toggled availability on)
    - Connected (has active WebSocket connection)
    
    Args:
        website_id: ID of the website to check
        
    Returns:
        WidgetStatusResponse with online status
        
    Example:
        GET /widget/status?website_id=1
        
        Response (online):
        {
            "online": true
        }
        
        Response (offline):
        {
            "online": false
        }
    """
    website = db.query(Website).filter(Website.id == website_id).first()
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")

    # Domain lock: status is called from visitor sites.
    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)

    # Check if website is online
    online = is_website_online(website_id)
    
    return WidgetStatusResponse(online=online)
