from __future__ import annotations

import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "bin" / "chatgpt_context_packer.py"


def load_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("chatgpt_context_packer", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_pack_context_filters_junk_and_includes_source_docs(tmp_path: Path) -> None:
    module = load_module()
    
    # Create project structure
    project = tmp_path / "my_project"
    project.mkdir()
    
    (project / "src").mkdir()
    (project / "src" / "app.py").write_text("print('hello')", encoding="utf-8")
    (project / "README.md").write_text("# Docs", encoding="utf-8")
    (project / "analysis.md").write_text("# Analysis", encoding="utf-8")
    
    # Junk folders & files
    (project / ".git").mkdir()
    (project / ".git" / "HEAD").write_text("ref: refs/heads/main", encoding="utf-8")
    (project / "node_modules").mkdir()
    (project / "node_modules" / "junk.js").write_text("// junk", encoding="utf-8")
    (project / ".venv").mkdir()
    (project / ".venv" / "pyvenv.cfg").write_text("home = /usr", encoding="utf-8")
    (project / "src" / "__pycache__").mkdir()
    (project / "src" / "__pycache__" / "app.cpython-311.pyc").write_bytes(b"pyc")
    (project / "image.png").write_bytes(b"png")
    (project / ".DS_Store").write_bytes(b"ds_store")
    
    out_zip = tmp_path / "context.zip"
    result = module.pack_context(project, out_zip)
    
    assert result["ok"] is True
    assert out_zip.is_file()
    assert result["size_bytes"] < 1024 * 1024
    
    with zipfile.ZipFile(out_zip, "r") as zf:
        namelist = set(zf.namelist())
        assert "src/app.py" in namelist
        assert "README.md" in namelist
        assert "analysis.md" in namelist
        assert not any(".git" in name for name in namelist)
        assert not any("node_modules" in name for name in namelist)
        assert not any(".venv" in name for name in namelist)
        assert not any("__pycache__" in name for name in namelist)
        assert not any(".png" in name for name in namelist)
        assert not any(".DS_Store" in name for name in namelist)


def test_pack_context_raises_when_no_files_found(tmp_path: Path) -> None:
    module = load_module()
    empty = tmp_path / "empty"
    empty.mkdir()
    (empty / ".git").mkdir()
    
    out_zip = tmp_path / "empty.zip"
    with pytest.raises(module.ContextPackerError) as exc:
        module.pack_context(empty, out_zip)
    assert exc.value.code == "NO_FILES_TO_PACK"


def test_pack_context_enforces_1mb_limit(tmp_path: Path) -> None:
    module = load_module()
    project = tmp_path / "large_project"
    project.mkdir()
    
    # Incompressible data over 1MB
    import os
    (project / "huge.dat_text").write_bytes(os.urandom(1100 * 1024))
    
    out_zip = tmp_path / "huge.zip"
    with pytest.raises(module.ContextPackerError) as exc:
        module.pack_context(project, out_zip, max_archive_bytes=1024 * 1024)
    assert exc.value.code == "CONTEXT_PACKET_OVERSIZED"
    assert "largest_files" in exc.value.evidence


def test_context_packer_cli(tmp_path: Path) -> None:
    project = tmp_path / "cli_project"
    project.mkdir()
    (project / "main.py").write_text("pass", encoding="utf-8")
    out_zip = tmp_path / "cli.zip"
    
    res = subprocess.run(
        [sys.executable, str(MODULE_PATH), "--project-root", str(project), "--output", str(out_zip)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert out_zip.is_file()
    payload = json.loads(res.stdout)
    assert payload["ok"] is True
    assert payload["file_count"] == 1

