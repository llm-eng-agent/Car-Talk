// Deterministic aspect resolution (spec §11.5: Hebrew/English keyword aliases map to the
// approved aspect vocabulary; NOT an LLM step). At most 3 aspects per answer (line 1364);
// an empty result means the caller uses a general review query (conclusion/strengths/
// weaknesses).
import { loadAspectLexicon } from "./catalog";
import { phrasePresent } from "./matcher";
import { normalize } from "./normalize";
import { ASPECTS, type Aspect, MAX_ASPECTS } from "./types";

export function resolveAspects(
  text: string,
  lexicon: Record<Aspect, string[]> = loadAspectLexicon(),
): Aspect[] {
  const haystack = normalize(text);
  const found: Aspect[] = [];
  for (const aspect of ASPECTS) {
    const keywords = lexicon[aspect] ?? [];
    if (keywords.some((keyword) => phrasePresent(haystack, normalize(keyword)))) {
      found.push(aspect);
    }
  }
  return found.slice(0, MAX_ASPECTS);
}
