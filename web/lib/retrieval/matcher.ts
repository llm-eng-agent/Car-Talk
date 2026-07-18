// Token-bounded phrase matching that tolerates Hebrew one/two-letter prefixes attached to a
// word (ו ה ב ל מ ש כ), e.g. "לאיון" contains "איון", "והטעינה" contains "טעינה". Prefixes are
// only allowed before a Hebrew-initial phrase (they never attach to Latin tokens like "mg").
// Inputs are already normalized by `normalize`.
const HEB_PREFIX = "[והבלמשכ]"; // vav he bet lamed mem shin kaf
const HEB_START = /^[֐-׿]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function phrasePresent(haystackNorm: string, phraseNorm: string): boolean {
  if (!phraseNorm) return false;
  const prefix = HEB_START.test(phraseNorm) ? `${HEB_PREFIX}{0,2}` : "";
  const re = new RegExp(`(?:^|\\s)${prefix}${escapeRegExp(phraseNorm)}(?=\\s|$)`, "u");
  return re.test(haystackNorm);
}
