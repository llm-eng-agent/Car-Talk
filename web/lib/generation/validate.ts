// Server-side validation of the model's structured output before anything is displayed
// (spec §14.6, lines 362-364, §22.5). A response that fails is not shown — the caller retries
// once, then returns a safe fallback. Deterministic; no network.
import { ASPECTS } from "../retrieval/types";
import { type CitationMap } from "./citations";
import {
  ASPECT_ASSESSMENT_VALUES,
  CONSTRAINT_ASSESSMENT_VALUES,
  CONSTRAINTS,
  type GenerationOutput,
} from "./schema";

export interface ValidationContext {
  citationMap: CitationMap;
  userMessage: string;
  allowedVehicleIds: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const ASPECT_SET = new Set<string>(ASPECTS);
const ASSESSMENT_SET = new Set<string>(ASPECT_ASSESSMENT_VALUES);
const CONSTRAINT_SET = new Set<string>(CONSTRAINTS);
const CONSTRAINT_STATUS_SET = new Set<string>(CONSTRAINT_ASSESSMENT_VALUES);

export function validateGenerationOutput(
  output: GenerationOutput,
  ctx: ValidationContext,
): ValidationResult {
  const errors: string[] = [];
  const vehicles = new Set(ctx.allowedVehicleIds);
  const citationExists = (id: string) => ctx.citationMap.has(id);

  const checkCitations = (ids: string[], where: string) => {
    for (const id of ids) {
      if (!citationExists(id)) errors.push(`Unknown citation '${id}' in ${where}`);
    }
  };

  // Overview: a non-empty overview must carry at least one valid citation (spec line 362).
  checkCitations(output.overview.citation_ids, "overview");
  if (output.overview.text.trim() && output.overview.citation_ids.length === 0) {
    errors.push("Non-empty overview has no citation");
  }

  // Aspect assessments: valid aspect + enum; a material assessment needs a citation; a declared
  // winner must be an allowed vehicle.
  for (const [i, a] of output.aspect_assessments.entries()) {
    if (!ASPECT_SET.has(a.aspect)) errors.push(`Unknown aspect '${a.aspect}' at aspect_assessments[${i}]`);
    if (!ASSESSMENT_SET.has(a.assessment)) errors.push(`Invalid assessment '${a.assessment}' at aspect_assessments[${i}]`);
    checkCitations(a.citation_ids, `aspect_assessments[${i}]`);
    if (a.assessment !== "insufficient_evidence" && a.citation_ids.length === 0) {
      errors.push(`Material aspect_assessments[${i}] has no citation`);
    }
    if (a.winner_vehicle_id !== null && !vehicles.has(a.winner_vehicle_id)) {
      errors.push(`Winner '${a.winner_vehicle_id}' at aspect_assessments[${i}] is not an evidence vehicle`);
    }
  }

  // Constraint assessments: valid constraint + status + allowed vehicle.
  for (const [i, c] of output.constraint_assessments.entries()) {
    if (!CONSTRAINT_SET.has(c.constraint)) errors.push(`Unknown constraint '${c.constraint}' at constraint_assessments[${i}]`);
    if (!CONSTRAINT_STATUS_SET.has(c.status)) errors.push(`Invalid constraint status '${c.status}' at constraint_assessments[${i}]`);
    if (!vehicles.has(c.vehicle_id)) errors.push(`Constraint vehicle '${c.vehicle_id}' at constraint_assessments[${i}] is not an evidence vehicle`);
    checkCitations(c.citation_ids, `constraint_assessments[${i}]`);
  }

  // Preference / usage updates: aspect must be valid; evidence_text must be an exact substring of
  // the current user message (spec line 363).
  for (const [i, p] of output.preference_updates.entries()) {
    if (!ASPECT_SET.has(p.aspect)) errors.push(`Unknown aspect '${p.aspect}' at preference_updates[${i}]`);
    if (!ctx.userMessage.includes(p.evidence_text)) {
      errors.push(`preference_updates[${i}].evidence_text is not a substring of the user message`);
    }
  }
  for (const [i, u] of output.usage_pattern_updates.entries()) {
    if (!ctx.userMessage.includes(u.evidence_text)) {
      errors.push(`usage_pattern_updates[${i}].evidence_text is not a substring of the user message`);
    }
  }

  // No recommendation may be surfaced when evidence is insufficient / out of scope (spec §14.6):
  // a declared aspect winner is a recommendation signal.
  if (output.status === "insufficient_evidence" || output.status === "out_of_scope") {
    if (output.aspect_assessments.some((a) => a.winner_vehicle_id !== null)) {
      errors.push(`A winner is declared under status '${output.status}'`);
    }
  }

  return { ok: errors.length === 0, errors };
}
