"""Token counting for chunking (spec: tiktoken with the embedding model's encoding).

``TokenCounter`` is a small callable protocol so the chunker can be unit-tested with a
trivial deterministic counter and never needs network access in tests/CI.
"""

from __future__ import annotations

from typing import Protocol


class TokenCounter(Protocol):
    def __call__(self, text: str) -> int: ...


class TiktokenCounter:
    """Counts tokens with the encoding tiktoken selects for the embedding model.

    The encoding data is loaded lazily on first use (tiktoken may fetch/cache it), so this
    is only constructed in the live pipeline path, never in offline tests.
    """

    def __init__(self, model: str = "text-embedding-3-small") -> None:
        import tiktoken

        self._encoding = tiktoken.encoding_for_model(model)

    def __call__(self, text: str) -> int:
        return len(self._encoding.encode(text))
