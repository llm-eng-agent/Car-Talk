"""Tests for the sources manifest loader and the committed ``data/sources.json``."""

from __future__ import annotations

from pathlib import Path

import pytest

from car_talk_pipeline.scraping.manifest import ManifestError, find_source, load_manifest
from car_talk_pipeline.scraping.models import ArticleType, CoverageScope

REPO_ROOT = Path(__file__).resolve().parents[2]
SOURCES_PATH = REPO_ROOT / "data" / "sources.json"


def test_committed_manifest_has_eight_enabled_sources() -> None:
    manifest = load_manifest(SOURCES_PATH)
    assert len(manifest.sources) == 8
    assert len(manifest.enabled_sources()) == 8


def test_document_ids_are_unique() -> None:
    manifest = load_manifest(SOURCES_PATH)
    document_ids = [source.document_id for source in manifest.sources]
    assert len(document_ids) == len(set(document_ids))


def test_kia_ev9_is_long_term_partial_update() -> None:
    manifest = load_manifest(SOURCES_PATH)
    kia = find_source(manifest, "kia_ev9_long_term_report")
    assert kia.article_type is ArticleType.LONG_TERM_REPORT
    assert kia.coverage_scope is CoverageScope.PARTIAL_UPDATE


def test_all_urls_are_auto_co_il() -> None:
    manifest = load_manifest(SOURCES_PATH)
    for source in manifest.sources:
        assert source.url.startswith("https://www.auto.co.il/"), source.url


def test_missing_manifest_raises(tmp_path: Path) -> None:
    with pytest.raises(ManifestError, match="not found"):
        load_manifest(tmp_path / "does_not_exist.json")


def test_unknown_document_id_raises() -> None:
    manifest = load_manifest(SOURCES_PATH)
    with pytest.raises(ManifestError, match="No source with document_id"):
        find_source(manifest, "no_such_document")
