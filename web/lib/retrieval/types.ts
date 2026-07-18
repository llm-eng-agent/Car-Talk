// Approved aspect vocabulary (spec §11.5, Locked Contract). The only valid aspect tokens.
export const ASPECTS = [
  "ride_comfort",
  "space_practicality",
  "performance",
  "handling",
  "interior_quality",
  "usability_ergonomics",
  "efficiency_range",
  "refinement",
  "value_for_money",
  "safety_equipment",
  "design",
] as const;

export type Aspect = (typeof ASPECTS)[number];

// At most three aspects are evaluated in a single answer (spec §11.5, line 1364).
export const MAX_ASPECTS = 3;

// One ranked search hit — a payload projection plus the fusion/similarity score. Mirrors the
// Python `RetrievedChunk` (pipeline/src/car_talk_pipeline/retrieval.py) so both stacks agree.
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  vehicleId: string;
  score: number;
  sectionHeading: string;
  contentType: string;
  content: string;
}

// The retrieval route is decided by the number of resolved vehicles (spec §11.4). `out_of_scope`
// is the non-retrieval outcome for a named-but-unknown vehicle (spec line 185 / eval q27).
export type Route = "single" | "comparison" | "discovery" | "out_of_scope";

// Evidence for one vehicle after balanced retrieval.
export interface VehicleEvidence {
  vehicleId: string;
  chunks: RetrievedChunk[];
}

// The orchestrator's output and the input contract for the Phase 6 context builder. When
// `sufficient` is false the caller abstains and never calls generation (Phase 5 DoD).
export interface EvidencePackage {
  route: Route;
  vehicles: VehicleEvidence[];
  aspects: Aspect[];
  sufficient: boolean;
  // On the `out_of_scope` route, the out-of-corpus make that was named (so the abstention
  // message can reference it, e.g. "טויוטה אינה במאגר").
  unresolvedMention?: string;
}
