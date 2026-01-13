import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.logging import get_logger
import time
import structlog

from app.infra.metrics import observe_http_request

logger = get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to add request logging and context"""
    
    async def dispatch(self, request: Request, call_next):
        # Propagate existing request id if present; otherwise generate.
        incoming = (request.headers.get("x-request-id") or "").strip()
        request_id = incoming[:200] if incoming else str(uuid.uuid4())

        # Prefer the route template path when available (lower cardinality).
        try:
            route = request.scope.get("route")
            path_template = getattr(route, "path", None) or request.url.path
        except Exception:
            path_template = request.url.path
        
        # Bind request context to logger
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            path=path_template,
            method=request.method,
        )
        
        # Log request
        start_time = time.time()
        logger.info("request_started", 
                   request_id=request_id, 
                   method=request.method, 
                   path=path_template,
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

            # Metrics
            try:
                observe_http_request(
                    method=request.method,
                    path_template=str(path_template),
                    status_code=int(response.status_code),
                    duration_ms=round(duration * 1000, 3),
                )
            except Exception:
                pass
            
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

            # Best-effort metrics for failures (no status code).
            try:
                observe_http_request(
                    method=request.method,
                    path_template=str(path_template),
                    status_code=0,
                    duration_ms=round(duration * 1000, 3),
                )
            except Exception:
                pass
            raise
