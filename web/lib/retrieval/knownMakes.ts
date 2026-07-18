// Detects a car make that is *known but outside our 8-article corpus* (e.g. Toyota, BMW). Such a
// named-but-unsupported vehicle mention must abstain (spec line 185 / eval q27), not fall through
// to open discovery. Genuine open recommendations name no make and return null here. Reuses the
// same normalize + phrasePresent primitives as the vehicle resolver (Hebrew-prefix tolerant).
// The list is curated, not exhaustive — an unlisted brand falls through to discovery (documented
// POC trade-off in data/known_makes.json).
import knownMakesData from "../../../data/known_makes.json";
import { phrasePresent } from "./matcher";
import { normalize } from "./normalize";

interface KnownMake {
  make: string;
  aliases: string[];
}

const OUT_OF_CORPUS: KnownMake[] = knownMakesData.out_of_corpus_makes;

// Returns the display name of the first out-of-corpus make mentioned in the text, or null.
export function detectOutOfCorpusMake(text: string): string | null {
  const haystack = normalize(text);
  for (const { make, aliases } of OUT_OF_CORPUS) {
    if (aliases.some((alias) => phrasePresent(haystack, normalize(alias)))) {
      return make;
    }
  }
  return null;
}
