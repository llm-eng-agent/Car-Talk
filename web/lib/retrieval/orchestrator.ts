// Retrieval orchestrator (spec §11.4, §20.1) — TypeScript in the Next.js app, not Python. The
// number of resolved vehicles decides the route; every route yields a balanced `EvidencePackage`
// and a deterministic low-evidence gate keeps under-supported queries out of generation.
import { resolveAspects } from "./aspects";
import { detectOutOfCorpusMake } from "./knownMakes";
import { type SearchOptions } from "./retriever";
import { type EvidencePackage, type RetrievedChunk, type Route, type VehicleEvidence } from "./types";
import { resolveVehicles } from "./vehicleResolver";

const SINGLE_TOP_K = 5; // one vehicle → top 5 (spec §11.4)
const PER_VEHICLE_TOP_K = 3; // comparison / discovery → top 3 per vehicle (balanced evidence)
const DISCOVERY_POOL = 20; // global hybrid pool used to discover candidate vehicles
const MAX_COMPARISON_VEHICLES = 4; // spec §11.4: "two to four vehicles"
const MAX_CANDIDATES = 3; // discovery selects the top three candidate vehicles

// The retriever capability the orchestrator needs (satisfied by `HybridRetriever`).
export interface Retriever {
  search(queryText: string, options?: SearchOptions): Promise<RetrievedChunk[]>;
}

export interface OrchestrateOptions {
  // Vehicles from the active session (spec §11: follow-up references). Used only when the query
  // names no vehicle of its own — supplied later by Phase 8 session memory.
  activeVehicleIds?: string[];
}

// Resolve the query, run the matching retrieval route, and return a balanced evidence package.
export async function orchestrate(
  queryText: string,
  retriever: Retriever,
  options: OrchestrateOptions = {},
): Promise<EvidencePackage> {
  const aspects = resolveAspects(queryText);
  let vehicleIds = resolveVehicles(queryText);

  if (vehicleIds.length === 0) {
    // A named-but-unknown vehicle/brand must abstain, not fall through to discovery with evidence
    // for unrelated cars (spec line 185 / eval q27). Checked before the follow-up fallback so an
    // explicit out-of-corpus mention overrides prior session context.
    const make = detectOutOfCorpusMake(queryText);
    if (make) {
      return { route: "out_of_scope", vehicles: [], aspects, sufficient: false, unresolvedMention: make };
    }
    // Follow-up: no vehicle named in the query → fall back to the active session vehicles.
    if (options.activeVehicleIds && options.activeVehicleIds.length > 0) {
      vehicleIds = options.activeVehicleIds;
    }
  }

  if (vehicleIds.length === 1) {
    return single(vehicleIds[0], queryText, aspects, retriever);
  }
  if (vehicleIds.length >= 2) {
    return comparison(vehicleIds.slice(0, MAX_COMPARISON_VEHICLES), queryText, aspects, retriever);
  }
  return discovery(queryText, aspects, retriever);
}

async function single(
  vehicleId: string,
  queryText: string,
  aspects: EvidencePackage["aspects"],
  retriever: Retriever,
): Promise<EvidencePackage> {
  const chunks = await retriever.search(queryText, { topK: SINGLE_TOP_K, vehicleIds: [vehicleId] });
  const vehicles: VehicleEvidence[] = [{ vehicleId, chunks }];
  return pack("single", vehicles, aspects, chunks.length > 0);
}

async function comparison(
  vehicleIds: string[],
  queryText: string,
  aspects: EvidencePackage["aspects"],
  retriever: Retriever,
): Promise<EvidencePackage> {
  // Separate, balanced retrieval per vehicle so one article's length/style can't dominate the
  // pool (spec §11.5). Runs in parallel.
  const vehicles = await balancedRetrieval(vehicleIds, queryText, retriever);
  // A fair comparison needs evidence on at least two sides.
  const sidesWithEvidence = vehicles.filter((v) => v.chunks.length > 0).length;
  return pack("comparison", vehicles, aspects, sidesWithEvidence >= 2);
}

async function discovery(
  queryText: string,
  aspects: EvidencePackage["aspects"],
  retriever: Retriever,
): Promise<EvidencePackage> {
  // Open candidate discovery: one hybrid search over the whole collection, grouped by vehicle.
  const pool = await retriever.search(queryText, { topK: DISCOVERY_POOL });
  const candidateIds = topCandidates(pool, MAX_CANDIDATES);
  if (candidateIds.length === 0) {
    return pack("discovery", [], aspects, false);
  }
  const vehicles = await balancedRetrieval(candidateIds, queryText, retriever);
  const anyEvidence = vehicles.some((v) => v.chunks.length > 0);
  return pack("discovery", vehicles, aspects, anyEvidence);
}

// Run per-vehicle top-K searches in parallel — the balanced-evidence primitive shared by the
// comparison and discovery routes.
async function balancedRetrieval(
  vehicleIds: string[],
  queryText: string,
  retriever: Retriever,
): Promise<VehicleEvidence[]> {
  return Promise.all(
    vehicleIds.map(async (vehicleId) => ({
      vehicleId,
      chunks: await retriever.search(queryText, {
        topK: PER_VEHICLE_TOP_K,
        vehicleIds: [vehicleId],
      }),
    })),
  );
}

// The top-N vehicles by first appearance in a ranked pool (rank order → strongest candidates).
function topCandidates(pool: RetrievedChunk[], n: number): string[] {
  const seen: string[] = [];
  for (const chunk of pool) {
    if (!seen.includes(chunk.vehicleId)) seen.push(chunk.vehicleId);
    if (seen.length === n) break;
  }
  return seen;
}

function pack(
  route: Route,
  vehicles: VehicleEvidence[],
  aspects: EvidencePackage["aspects"],
  sufficient: boolean,
): EvidencePackage {
  return { route, vehicles, aspects, sufficient };
}
