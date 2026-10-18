"""
Phase 8E — Plugin Hot-Loading
GET  /api/plugins         → list registered dynamic plugins from _manifest.json
POST /api/plugins/register → manually add a plugin entry (for testing / agent use)
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_MANIFEST = (
    Path(__file__).parent.parent.parent.parent.parent
    / "frontend" / "src" / "plugins" / "_manifest.json"
)
_LOADER = _MANIFEST.parent / "_loader.ts"


def _read_manifest() -> list[dict]:
    if not _MANIFEST.exists():
        return []
    try:
        return json.loads(_MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write_manifest(plugins: list[dict]) -> None:
    _MANIFEST.write_text(json.dumps(plugins, indent=2), encoding="utf-8")


def _update_loader(plugin_id: str, component_name: str) -> None:
    """Append a dynamic import line to _loader.ts (idempotent)."""
    if not _LOADER.exists():
        return
    text = _LOADER.read_text(encoding="utf-8")
    if plugin_id in text:
        return
    new_line = f'  {plugin_id}: dynamic(() => import("./{component_name}"), {{ ssr: false }}),\n'
    text = text.replace(
        "  // [PLUGIN_LOADER_ENTRIES]\n",
        new_line + "  // [PLUGIN_LOADER_ENTRIES]\n",
    )
    _LOADER.write_text(text, encoding="utf-8")


class PluginRegisterBody(BaseModel):
    id: str
    label: str
    group: str = "main"
    icon: str = "Puzzle"
    description: str = ""
    component: str = ""   # component filename stem, defaults to PascalCase of id


@router.get("")
def list_plugins():
    return _read_manifest()


@router.post("/register", status_code=201)
def register_plugin(body: PluginRegisterBody):
    plugins = _read_manifest()
    if any(p["id"] == body.id for p in plugins):
        raise HTTPException(400, f"Plugin '{body.id}' already registered")

    plugins.append({
        "id":          body.id,
        "label":       body.label,
        "group":       body.group,
        "icon":        body.icon,
        "description": body.description,
    })
    _write_manifest(plugins)

    component_name = body.component or "".join(w.capitalize() for w in body.id.split("_"))
    _update_loader(body.id, component_name)

    return {"ok": True, "id": body.id, "total": len(plugins)}


@router.delete("/{plugin_id}")
def unregister_plugin(plugin_id: str):
    plugins = _read_manifest()
    before = len(plugins)
    plugins = [p for p in plugins if p["id"] != plugin_id]
    if len(plugins) == before:
        raise HTTPException(404, f"Plugin '{plugin_id}' not found")
    _write_manifest(plugins)
    return {"ok": True, "total": len(plugins)}
