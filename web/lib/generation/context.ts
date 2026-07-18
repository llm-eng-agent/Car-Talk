// Context engineering (spec §13): turn a Phase-5 EvidencePackage into a token-bounded, grouped
// model input. Deterministic — decides which evidence is included, how it is grouped, and how
// citations are represented. The evidence is labelled UNTRUSTED so the model treats review text
// as data, not instructions (spec §24.2). SYSTEM RULES (§13.2) are the model's system message and
// are supplied at the generation call (Phase 6b); this builder produces the user-content portion.
import { loadVehicleCatalog } from "../retrieval/catalog";
import { type EvidencePackage } from "../retrieval/types";
import { buildCitations, type Citation, type CitationMap } from "./citations";

// Per-route chunk budget (spec §13.3 / §23.2): single 5; otherwise up to 3 per vehicle → 6 for
// two vehicles, 9 for three (open recommendation), matching the context-limit table.
const SINGLE_VEHICLE_CAP = 5;
const PER_VEHICLE_CAP = 3;

export interface SessionContext {
  activeVehicleIds?: string[];
  preferences?: string[];
}

export interface BuiltContext {
  contextText: string;
  citations: Citation[];
  citationMap: CitationMap;
}

export function buildContext(
  userQuery: string,
  pkg: EvidencePackage,
  session?: SessionContext,
): BuiltContext {
  const capped = capEvidence(pkg);
  const { citations, map } = buildCitations(capped);
  const names = vehicleNames();

  const sections = [
    section("USER REQUEST", userQuery.trim()),
    section("SESSION PREFERENCES", (session?.preferences ?? []).join("\n") || "None"),
    section(
      "ACTIVE VEHICLES",
      (session?.activeVehicleIds ?? []).map((id) => names.get(id) ?? id).join("\n") || "None",
    ),
    section("UNTRUSTED REVIEW EVIDENCE", renderEvidence(capped, citations, names)),
  ];
  return { contextText: sections.join("\n\n"), citations, citationMap: map };
}

// Trim each vehicle's chunk list to the per-route budget before citation IDs are assigned, so IDs
// stay contiguous over exactly the included evidence.
function capEvidence(pkg: EvidencePackage): EvidencePackage {
  const perVehicle = pkg.vehicles.length === 1 ? SINGLE_VEHICLE_CAP : PER_VEHICLE_CAP;
  return { ...pkg, vehicles: pkg.vehicles.map((v) => ({ ...v, chunks: v.chunks.slice(0, perVehicle) })) };
}

function renderEvidence(pkg: EvidencePackage, citations: Citation[], names: Map<string, string>): string {
  const byId = new Map(citations.map((c) => [c.chunkId, c]));
  const blocks: string[] = [];
  for (const vehicle of pkg.vehicles) {
    if (vehicle.chunks.length === 0) continue;
    blocks.push(`Vehicle: ${names.get(vehicle.vehicleId) ?? vehicle.vehicleId}`);
    for (const chunk of vehicle.chunks) {
      const citation = byId.get(chunk.chunkId);
      if (!citation) continue;
      blocks.push(`[${citation.id}]\nSection: ${chunk.sectionHeading}\nContent: ${chunk.content}`);
    }
  }
  return blocks.join("\n\n");
}

function section(heading: string, body: string): string {
  return `${heading}\n${body}`;
}

function vehicleNames(): Map<string, string> {
  return new Map(loadVehicleCatalog().map((v) => [v.vehicleId, v.canonicalName]));
}
