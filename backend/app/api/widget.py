"""
Widget API - Public endpoints for the chat widget.

These endpoints are called by the embedded chat widget on visitor websites.
They must be fast, reliable, and not require authentication.
"""

from typing import Optional
from fastapi import APIRouter, Query, HTTPException, Depends, Request
from fastapi.responses import Response, JSONResponse
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

router = APIRouter(prefix="/widget", tags=["widget"])


class WidgetReadStateResponse(BaseModel):
    conversation_id: int
    last_read_at: Optional[datetime]
    first_unread_message_id: Optional[int]


@router.post("/read")
async def mark_widget_read(
    website_id: int = Query(...),
    session_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Mark a conversation as read by the visitor."""
    from app.models.conversation import Conversation
    
    conv = db.query(Conversation).filter(
        Conversation.website_id == website_id,
        Conversation.session_id == session_id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    conv.visitor_last_read_at = datetime.now(timezone.utc)
    db.commit()
    
    return {"success": True, "conversation_id": conv.id}


@router.get("/read-state", response_model=WidgetReadStateResponse)
async def get_widget_read_state(
    website_id: int = Query(...),
    session_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """Return read state for the visitor thread UI."""
    from app.models.conversation import Conversation
    
    conv = db.query(Conversation).filter(
        Conversation.website_id == website_id,
        Conversation.session_id == session_id
    ).first()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
        
    last_read_at = conv.visitor_last_read_at
    
    # Find the earliest AGENT or BOT or SYSTEM message after last_read_at.
    first_unread_message_id = None
    try:
        q = db.query(Message).filter(
            Message.conversation_id == conv.id,
            Message.sender_type != MessageSenderType.VISITOR
        )
        if last_read_at is not None:
            q = q.filter(Message.created_at > last_read_at)
        
        first_unread = q.order_by(Message.created_at.asc(), Message.id.asc()).first()
        first_unread_message_id = int(first_unread.id) if first_unread else None
    except Exception:
        first_unread_message_id = None
        
    return {
        "conversation_id": conv.id,
        "last_read_at": last_read_at,
        "first_unread_message_id": first_unread_message_id,
    }


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
        return Response(
            content=f"// Error: Invalid widget key",
            media_type="application/javascript",
            status_code=404
        )

    # Domain lock: only allow this widget key to be used from the website domain/subdomains.
    enforce_widget_domain_or_403(headers=request.headers, website_domain=website.domain)
    
    # Get widget configuration
    config = website.widget_config or {}
    theme = config.get('theme', 'dark')
    position = config.get('position', 'bottom-right')
    welcome_message = config.get('welcome_message', 'Hi! How can we help you today?')
    primary_color = config.get('primary_color', '#000000')
    
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
  _aichatassist.welcomeMessage = {repr(welcome_message)};
  _aichatassist.primaryColor = '{primary_color}';
  
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
    
    return Response(
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
