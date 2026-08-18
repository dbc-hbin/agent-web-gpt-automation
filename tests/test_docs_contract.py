import importlib.util
from pathlib import Path


ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("check_docs", ROOT / "scripts" / "check_docs.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_public_docs_brand_assets_and_versions_are_consistent() -> None:
    assert MODULE.check_repository(ROOT) == []


def test_social_preview_has_github_recommended_dimensions() -> None:
    preview = ROOT / "docs" / "assets" / "brand" / "social-preview.png"
    assert MODULE._png_dimensions(preview) == (1280, 640)
