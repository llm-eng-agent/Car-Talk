// Deterministic vehicle resolution (spec §11.1: NOT LLM-based; the corpus has a known,
// closed set of vehicles). Alias matching is longest-match-first over normalized, token-
// bounded text; no fuzzy matching (spec appendix lines 181-184).
//
// Returns the resolved `vehicle_id`s (in longest-alias order):
//   - one id  → single-vehicle route
//   - 2..N ids → comparison route
//   - []      → no explicit vehicle (the caller routes to open discovery, or abstains for an
//               out-of-corpus mention). Clarification for open "which is best?" requests is a
//               route-level concern handled in the orchestrator (Phase 5b), not here.
import { loadVehicleCatalog, type Vehicle } from "./catalog";
import { phrasePresent } from "./matcher";
import { normalize } from "./normalize";

interface AliasEntry {
  vehicleId: string;
  norm: string;
}

function aliasEntries(catalog: Vehicle[]): AliasEntry[] {
  return catalog
    .flatMap((v) => v.aliases.map((alias) => ({ vehicleId: v.vehicleId, norm: normalize(alias) })))
    .filter((entry) => entry.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length); // longest-match-first
}

export function resolveVehicles(
  text: string,
  catalog: Vehicle[] = loadVehicleCatalog(),
): string[] {
  const haystack = normalize(text);
  const found: string[] = [];
  for (const entry of aliasEntries(catalog)) {
    if (phrasePresent(haystack, entry.norm) && !found.includes(entry.vehicleId)) {
      found.push(entry.vehicleId);
    }
  }
  return found;
}
