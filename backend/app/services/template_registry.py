"""Discovers the available resume designs.

Each design is a folder under ``app/templates/`` holding ``meta.json``,
``template.html`` and ``style.css``. Adding a fifth design means adding a folder
-- no code change anywhere.
"""

import json
import logging
from pathlib import Path

from app.core.config import TEMPLATES_DIR
from app.schemas.template import TemplateMeta

logger = logging.getLogger(__name__)

DEFAULT_TEMPLATE_ID = "modern-professional"

_registry: dict[str, TemplateMeta] = {}


def load_registry(force: bool = False) -> dict[str, TemplateMeta]:
    if _registry and not force:
        return _registry
    _registry.clear()
    for meta_path in sorted(TEMPLATES_DIR.glob("*/meta.json")):
        folder = meta_path.parent
        if folder.name.startswith("_"):
            continue
        try:
            data = json.loads(meta_path.read_text("utf-8"))
            data.setdefault("id", folder.name)
            meta = TemplateMeta(**data)
        except Exception:
            logger.exception("Skipping malformed template at %s", folder)
            continue
        if not (folder / "template.html").exists():
            logger.warning("Template %s has no template.html; skipping", folder.name)
            continue
        _registry[meta.id] = meta
    logger.info("Loaded %d resume templates: %s", len(_registry), ", ".join(_registry))
    return _registry


def list_templates() -> list[TemplateMeta]:
    return list(load_registry(force=True).values())


def get_template(template_id: str) -> TemplateMeta | None:
    return load_registry(force=True).get(template_id)


def resolve_template_id(template_id: str | None) -> str:
    """Fall back to the default design rather than failing a render outright."""
    registry = load_registry()
    if template_id and template_id in registry:
        return template_id
    if DEFAULT_TEMPLATE_ID in registry:
        return DEFAULT_TEMPLATE_ID
    if registry:
        return next(iter(registry))
    raise RuntimeError(f"No resume templates found under {TEMPLATES_DIR}")


def template_dir(template_id: str) -> Path:
    return TEMPLATES_DIR / template_id
