// Deterministic aspect resolution (spec §11.5: Hebrew/English keyword aliases map to the
// approved aspect vocabulary; NOT an LLM step). At most 3 aspects per answer (line 1364);
// an empty result means the caller uses a general review query (conclusion/strengths/
// weaknesses).
import { loadAspectLexicon } from "./catalog";
import { phraseIndex } from "./matcher";
import { normalize } from "./normalize";
import { ASPECTS, type Aspect, MAX_ASPECTS } from "./types";

export function resolveAspects(
  text: string,
  lexicon: Record<Aspect, string[]> = loadAspectLexicon(),
): Aspect[] {
  const haystack = normalize(text);
  // Match each aspect at the earliest position any of its keywords appears, then keep the
  // first MAX_ASPECTS in the user's stated order (spec §11.5) — not the fixed ASPECTS order.
  const matched: { aspect: Aspect; at: number }[] = [];
  for (const aspect of ASPECTS) {
    const keywords = lexicon[aspect] ?? [];
    let at = Infinity;
    for (const keyword of keywords) {
      const idx = phraseIndex(haystack, normalize(keyword));
      if (idx !== -1 && idx < at) at = idx;
    }
    if (at !== Infinity) matched.push({ aspect, at });
  }
  // Stable sort: ties (same position) fall back to ASPECTS order, so results stay deterministic.
  matched.sort((a, b) => a.at - b.at);
  return matched.slice(0, MAX_ASPECTS).map((m) => m.aspect);
}
