import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import ai, auth, custom_templates, render, resumes, templates
from app.core import config, db
from app.core.config import settings
from app.core.limits import BodySizeLimitMiddleware
from app.services import template_registry

logging.basicConfig(level=logging.INFO if settings.debug else logging.WARNING)


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.check_production_config()
    await db.connect()
    template_registry.load_registry(force=True)
    yield
    await db.disconnect()


app = FastAPI(
    title=f"{settings.app_name} API",
    description="Resume builder API — data, templates and PDF rendering.",
    version="1.0.0",
    lifespan=lifespan,
)

# Added before CORS, which means it sits *inside* it: Starlette's add_middleware
# inserts at the head of the list, so the last one added ends up outermost. That
# is the order this wants -- a 413 from here still passes back out through
# CORSMiddleware and picks up the headers a browser needs to read the error,
# while the check itself still happens before routing or body parsing.
app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_json_body_bytes)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # The PDF download needs the filename from Content-Disposition.
    expose_headers=["Content-Disposition"],
)

for router in (
    auth.router,
    resumes.router,
    templates.router,
    custom_templates.router,
    render.router,
    ai.router,
):
    app.include_router(router, prefix=settings.api_v1_prefix)


@app.get("/health", tags=["meta"])
async def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "templates": len(template_registry.load_registry()),
    }
