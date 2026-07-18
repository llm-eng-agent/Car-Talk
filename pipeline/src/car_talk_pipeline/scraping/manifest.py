"""Loading and validation of the ``data/sources.json`` manifest."""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from car_talk_pipeline.scraping.models import SourceEntry, SourcesManifest


class ManifestError(Exception):
    """Raised when the sources manifest is missing, malformed, or inconsistent."""


def load_manifest(manifest_path: Path) -> SourcesManifest:
    """Load and validate the sources manifest.

    Raises:
        ManifestError: If the file is missing, is not valid JSON matching the schema,
            or contains duplicate ``document_id`` values.
    """

    if not manifest_path.is_file():
        raise ManifestError(f"Sources manifest not found: {manifest_path}")

    raw_json = manifest_path.read_text(encoding="utf-8")
    try:
        manifest = SourcesManifest.model_validate_json(raw_json)
    except ValidationError as error:
        raise ManifestError(f"Invalid sources manifest {manifest_path}: {error}") from error

    document_ids = [source.document_id for source in manifest.sources]
    duplicates = {doc_id for doc_id in document_ids if document_ids.count(doc_id) > 1}
    if duplicates:
        raise ManifestError(f"Duplicate document_id values in manifest: {sorted(duplicates)}")

    return manifest


def find_source(manifest: SourcesManifest, document_id: str) -> SourceEntry:
    """Return the source entry for ``document_id``.

    Raises:
        ManifestError: If no entry has the given ``document_id``.
    """

    for source in manifest.sources:
        if source.document_id == document_id:
            return source
    raise ManifestError(f"No source with document_id {document_id!r} in manifest")
