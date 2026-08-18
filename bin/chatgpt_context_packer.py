from __future__ import annotations

"""Smart context packaging helper for ChatGPT attachments (ZIP).

Filters out build artifacts, caches, git objects, and binaries, bundling only
relevant source code and analysis documents into a high-compression ZIP archive
under Oracle's 1 MiB limit.
"""

import argparse
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import Any, Sequence

MAX_ATTACHMENT_BYTES = 1024 * 1024  # 1 MiB

IGNORED_DIR_NAMES = frozenset({
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".env",
    "dist",
    "build",
    "out",
    "target",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".tox",
    ".coverage",
    ".idea",
    ".vscode",
    ".next",
    ".nuxt",
})

IGNORED_FILE_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".mp4", ".mov", ".avi", ".mkv", ".mp3", ".wav",
    ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".obj", ".lib",
    ".pyc", ".pyo", ".pyd", ".class", ".wasm",
    ".pdf", ".docx", ".xlsx", ".pptx",
    ".parquet", ".sqlite", ".db", ".sqlite3",
    ".bin", ".dat", ".iso", ".dmg",
})

IGNORED_FILE_NAMES = frozenset({
    ".ds_store",
    "thumbs.db",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
})


class ContextPackerError(RuntimeError):
    def __init__(self, code: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.evidence = evidence or {}


def should_ignore_path(path: Path, *, base_root: Path | None = None) -> bool:
    name_lower = path.name.lower()
    if name_lower in IGNORED_FILE_NAMES:
        return True
    if path.suffix.lower() in IGNORED_FILE_EXTENSIONS:
        return True
    parts = path.parts
    if base_root is not None:
        try:
            rel = path.relative_to(base_root)
            parts = rel.parts
        except ValueError:
            parts = path.parts
    for part in parts:
        if part.lower() in IGNORED_DIR_NAMES:
            return True
    return False


def collect_project_files(
    project_root: Path,
    targets: Sequence[Path] | None = None,
) -> list[tuple[Path, str]]:
    root = project_root.expanduser().resolve(strict=True)
    items: list[tuple[Path, str]] = []
    
    if targets:
        for raw in targets:
            target = raw.expanduser().resolve(strict=True)
            if should_ignore_path(target, base_root=root):
                continue
            if target.is_file():
                rel = os.path.relpath(target, root)
                items.append((target, rel.replace("\\", "/")))
            elif target.is_dir():
                for current_root, dirnames, filenames in os.walk(target):
                    dirnames[:] = [d for d in dirnames if d.lower() not in IGNORED_DIR_NAMES]
                    for fname in sorted(filenames):
                        fpath = Path(current_root) / fname
                        if not should_ignore_path(fpath, base_root=root) and fpath.is_file():
                            rel = os.path.relpath(fpath, root)
                            items.append((fpath, rel.replace("\\", "/")))
    else:
        for current_root, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in IGNORED_DIR_NAMES]
            for fname in sorted(filenames):
                fpath = Path(current_root) / fname
                if not should_ignore_path(fpath, base_root=root) and fpath.is_file():
                    rel = os.path.relpath(fpath, root)
                    items.append((fpath, rel.replace("\\", "/")))

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_items: list[tuple[Path, str]] = []
    for file_path, arcname in items:
        if arcname not in seen:
            seen.add(arcname)
            unique_items.append((file_path, arcname))
    return unique_items


def pack_context(
    project_root: Path,
    output_zip_path: Path,
    targets: Sequence[Path] | None = None,
    *,
    max_archive_bytes: int = MAX_ATTACHMENT_BYTES,
) -> dict[str, Any]:
    root = project_root.expanduser().resolve(strict=True)
    out = output_zip_path.expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    
    files = collect_project_files(root, targets)
    if not files:
        raise ContextPackerError("NO_FILES_TO_PACK", "No eligible files found to pack into archive")
    
    temporary_zip = out.with_name(f".{out.name}.tmp")
    try:
        with zipfile.ZipFile(temporary_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for file_path, arcname in files:
                zf.write(file_path, arcname)
        
        final_size = temporary_zip.stat().st_size
        if final_size > max_archive_bytes:
            # Find largest contributors to help the user prune
            file_sizes = sorted(
                [(arcname, file_path.stat().st_size) for file_path, arcname in files],
                key=lambda x: x[1],
                reverse=True,
            )
            raise ContextPackerError(
                "CONTEXT_PACKET_OVERSIZED",
                f"Generated ZIP ({final_size:,} bytes) exceeds the 1 MiB limit ({max_archive_bytes:,} bytes). "
                "Please prune large files or summarize documents.",
                {
                    "size_bytes": final_size,
                    "max_bytes": max_archive_bytes,
                    "largest_files": [{"path": name, "size_bytes": size} for name, size in file_sizes[:5]],
                },
            )
        temporary_zip.replace(out)
    finally:
        if temporary_zip.exists():
            temporary_zip.unlink()
            
    return {
        "ok": True,
        "zip_path": str(out),
        "size_bytes": final_size,
        "file_count": len(files),
        "files": [arcname for _, arcname in files],
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Pack source code and documents into an optimal <1MB context ZIP.")
    parser.add_argument("--project-root", type=Path, default=Path.cwd(), help="Project root directory")
    parser.add_argument("--output", type=Path, required=True, help="Destination ZIP file path")
    parser.add_argument("--target", type=Path, action="append", default=[], help="Specific file or directory targets")
    args = parser.parse_args(argv)
    
    try:
        result = pack_context(
            project_root=args.project_root,
            output_zip_path=args.output,
            targets=args.target or None,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ContextPackerError as exc:
        print(json.dumps({"ok": False, "error": {"code": exc.code, "message": str(exc), "evidence": exc.evidence}}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

