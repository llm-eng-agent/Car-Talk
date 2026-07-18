"""Car-Talk offline ingestion pipeline."""

# Bump this whenever extraction, normalization, or chunking logic changes in a way
# that affects stored output. Idempotency keys combine content hashes with this value.
PIPELINE_VERSION = "0.1.0"
