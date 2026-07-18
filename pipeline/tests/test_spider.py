"""Regression guards for the Scrapy spider (network-free).

Scrapy 2.13+ invokes ``async def start`` and no longer calls the old sync
``start_requests``. A revert to ``start_requests`` would silently fetch nothing and is
not caught elsewhere in CI, so we assert the async entry point here.
"""

from __future__ import annotations

import inspect

from car_talk_pipeline.scraping.spider import AutoCoIlSpider


def test_spider_defines_async_start() -> None:
    assert inspect.isasyncgenfunction(AutoCoIlSpider.start), (
        "AutoCoIlSpider.start must be an async generator (Scrapy 2.13+ entry point)"
    )
