"""CLI entry point for Spike A scraping.

Usage:
    car-talk-scrape --document-id mg_s6
    car-talk-scrape --all
"""

from __future__ import annotations

import argparse
from pathlib import Path

from scrapy.crawler import CrawlerProcess

from car_talk_pipeline import PIPELINE_VERSION
from car_talk_pipeline.scraping.manifest import find_source, load_manifest
from car_talk_pipeline.scraping.models import SourceEntry
from car_talk_pipeline.scraping.spider import AutoCoIlSpider
from car_talk_pipeline.scraping.storage import IngestionStorage

REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_MANIFEST = REPO_ROOT / "data" / "sources.json"
DEFAULT_OUTPUT_DIR = REPO_ROOT / ".tmp"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape approved Auto.co.il review articles.")
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--document-id", help="Scrape a single source by document_id.")
    selection.add_argument("--all", action="store_true", help="Scrape all enabled sources.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    return parser.parse_args(argv)


def _select_sources(args: argparse.Namespace) -> list[SourceEntry]:
    manifest = load_manifest(args.manifest)
    if args.all:
        return manifest.enabled_sources()
    return [find_source(manifest, args.document_id)]


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    sources = _select_sources(args)
    storage = IngestionStorage(args.output_dir)

    process = CrawlerProcess(settings={"TELNETCONSOLE_ENABLED": False})
    process.crawl(
        AutoCoIlSpider,
        sources=sources,
        storage=storage,
        pipeline_version=PIPELINE_VERSION,
    )
    process.start()


if __name__ == "__main__":
    main()
