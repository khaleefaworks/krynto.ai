"""
Widget API - Public endpoints for the chat widget.

These endpoints are called by the embedded chat widget on visitor websites.
They must be fast, reliable, and not require authentication.
"""

from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import Response, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.models.website import Website
from app.services.website_resolver import is_website_online


router = APIRouter(prefix="/widget", tags=["widget"])


@router.get("/loader.js")
async def get_widget_loader(key: str, db: Session = Depends(get_db)):
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
    
    # Get widget configuration
    config = website.widget_config or {}
    theme = config.get('theme', 'dark')
    position = config.get('position', 'bottom-right')
    welcome_message = config.get('welcome_message', 'Hi! How can we help you today?')
    primary_color = config.get('primary_color', '#000000')
    
    # Generate dynamic JavaScript
    js_content = f"""
(function() {{
  'use strict';
  
  // AI ChatAssist Widget Configuration
  var _aichatassist = window._aichatassist || {{}};
  _aichatassist.websiteId = {website.id};
  _aichatassist.widgetKey = '{key}';
  _aichatassist.apiUrl = window.location.protocol + '//localhost:8000';
  _aichatassist.wsUrl = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//localhost:8000';
  _aichatassist.theme = '{theme}';
  _aichatassist.position = '{position}';
  _aichatassist.welcomeMessage = {repr(welcome_message)};
  _aichatassist.primaryColor = '{primary_color}';
  
  // Load the actual widget script
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
async def get_widget_snippet(website_id: int, db: Session = Depends(get_db)):
    """
    Get the embed snippet code for a website.
    This is shown to admins in the dashboard to copy-paste into their website.
    """
    website = db.query(Website).filter(Website.id == website_id).first()
    
    if not website:
        raise HTTPException(status_code=404, detail="Website not found")
    
    # Generate the embed snippet (like Smartsupp)
    snippet = f"""<!-- AI ChatAssist Widget -->
<script type="text/javascript">
var _aichatassist = _aichatassist || {{}};
_aichatassist.key = '{website.widget_key}';
window.aichatassist||(function(d) {{
  var s,c,o=aichatassist=function(){{ o._.push(arguments)}};o._=[];
  s=d.getElementsByTagName('script')[0];c=d.createElement('script');
  c.type='text/javascript';c.charset='utf-8';c.async=true;
  c.src='http://localhost:8000/widget/loader.js?key=' + _aichatassist.key;
  s.parentNode.insertBefore(c,s);
}})(document);
</script>"""
    
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
def get_widget_status(website_id: int = Query(..., description="Website ID to check status for")):
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
    # Check if website is online
    online = is_website_online(website_id)
    
    return WidgetStatusResponse(online=online)
