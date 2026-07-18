// Deterministic input normalization for alias/keyword matching (spec appendix, lines 179-185):
// Unicode NFKC, Latin lowercase, hyphen/punctuation normalization, whitespace normalization.
// The same normalizer is applied to both the query and every catalog alias, so Hebrew
// gershayim/apostrophes and punctuation cancel out consistently on both sides.
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ") // punctuation & symbols → space (hyphens, quotes, geresh, &)
    .replace(/\s+/gu, " ")
    .trim();
}
