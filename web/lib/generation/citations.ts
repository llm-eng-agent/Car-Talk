// Deterministic citation mapping (spec §15.2). The model emits only internal citation IDs
// (C1, C2, …); the application resolves each to its source card here. The model never produces
// URLs (§15.4) — every field comes from the retrieved chunk's stored payload.
import { type EvidencePackage, type RetrievedChunk } from "../retrieval/types";

const EXCERPT_MAX_CHARS = 700; // spec line 418 / §15.2: excerpts truncated to 700 chars

export interface Citation {
  id: string; // C1, C2, …
  chunkId: string;
  vehicleId: string;
  articleTitle: string;
  sectionHeading: string;
  sourceUrl: string;
  excerpt: string;
}

export type CitationMap = Map<string, Citation>;

// Flatten the package's per-vehicle evidence (already grouped by vehicle) and assign C1..Cn in
// that order. Returns the ordered citations plus a lookup map for validation and rendering.
export function buildCitations(pkg: EvidencePackage): { citations: Citation[]; map: CitationMap } {
  const citations: Citation[] = [];
  const map: CitationMap = new Map();
  let n = 0;
  for (const vehicle of pkg.vehicles) {
    for (const chunk of vehicle.chunks) {
      n += 1;
      const citation = toCitation(`C${n}`, chunk);
      citations.push(citation);
      map.set(citation.id, citation);
    }
  }
  return { citations, map };
}

function toCitation(id: string, chunk: RetrievedChunk): Citation {
  return {
    id,
    chunkId: chunk.chunkId,
    vehicleId: chunk.vehicleId,
    articleTitle: chunk.articleTitle,
    sectionHeading: chunk.sectionHeading,
    sourceUrl: chunk.sourceUrl,
    excerpt: truncate(chunk.content, EXCERPT_MAX_CHARS),
  };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}
