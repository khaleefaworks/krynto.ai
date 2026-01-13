from fastapi import APIRouter
from starlette.responses import PlainTextResponse

from app.infra.metrics import render_prometheus_text

router = APIRouter(prefix="", tags=["metrics"])


@router.get("/metrics", response_class=PlainTextResponse)
def metrics():
    return PlainTextResponse(render_prometheus_text(), media_type="text/plain; version=0.0.4")
