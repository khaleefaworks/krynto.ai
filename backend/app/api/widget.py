"""
Widget API - Public endpoints for the chat widget.

These endpoints are called by the embedded chat widget on visitor websites.
They must be fast, reliable, and not require authentication.
"""

from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from app.services.website_resolver import is_website_online


router = APIRouter(prefix="/widget", tags=["widget"])


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
