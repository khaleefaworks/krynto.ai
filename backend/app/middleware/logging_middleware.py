import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.logging import get_logger
import time
import structlog

logger = get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to add request logging and context"""
    
    async def dispatch(self, request: Request, call_next):
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        
        # Bind request context to logger
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            path=request.url.path,
            method=request.method,
        )
        
        # Log request
        start_time = time.time()
        logger.info("request_started", 
                   request_id=request_id, 
                   method=request.method, 
                   path=request.url.path,
                   client=request.client.host if request.client else None)
        
        # Process request
        try:
            response = await call_next(request)
            
            # Calculate duration
            duration = time.time() - start_time
            
            # Log response
            logger.info("request_completed",
                       request_id=request_id,
                       status_code=response.status_code,
                       duration_ms=round(duration * 1000, 2))
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            
            return response
        except Exception as e:
            duration = time.time() - start_time
            logger.error("request_failed",
                        request_id=request_id,
                        error=str(e),
                        duration_ms=round(duration * 1000, 2),
                        exc_info=True)
            raise
