"""Canonical module and legacy import compatibility checks; no external services."""
import importlib
from pathlib import Path


def test_old_imports_resolve_to_the_same_module_object():
    mapping = {
        "stage7_review": "knowledge_review",
        "stage8b_auth": "account_auth",
        "stage8c2_guard": "ownership_guard",
        "stage9_speech": "speech_transcription",
        "stage10_pptx": "pptx_import",
        "stage11_local": "account_storage",
        "stage13_bootstrap": "account_bootstrap",
    }
    for old, current in mapping.items():
        assert importlib.import_module(f"app.{old}") is importlib.import_module(f"app.{current}")


def test_persisted_contract_names_are_unchanged():
    root = Path(__file__).resolve().parents[2]
    timer = (root / "frontend/src/components/speech/defenseTime.ts").read_text(encoding="utf-8")
    database = (root / "backend/app/account_bootstrap.py").read_text(encoding="utf-8")
    assert "stage9c:minutes:" in timer
    assert "stage9d:total-minutes:" in timer
    assert "app_stage8c2_meta" in database


def test_frontend_dom_identifiers_do_not_contain_stage_prefixes():
    root = Path(__file__).resolve().parents[2] / "frontend/src/components"
    import re
    for path in root.rglob("*.css"):
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"\.stage\d", text), path
    for path in root.rglob("*.tsx"):
        text = path.read_text(encoding="utf-8")
        assert not re.search(r'(?:className|id|data-)=[^\n]*stage\d', text), path
