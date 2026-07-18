// The strict structured-output contract for the single generation call (spec §"Structured
// generation schema", lines 288-364). The model returns exactly this shape; the server validates
// it (validate.ts) before anything is displayed. No `recommended_vehicle_id` — the model never
// selects the final vehicle (spec line 360); that is deterministic Phase 7 work.
import { ASPECTS } from "../retrieval/types";

export const GENERATION_STATUSES = [
  "complete",
  "partial",
  "insufficient_evidence",
  "out_of_scope",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const GENERATION_MODES = ["single_vehicle", "comparison", "recommendation"] as const;
export type GenerationMode = (typeof GENERATION_MODES)[number];

export const ASPECT_ASSESSMENT_VALUES = [
  "positive",
  "negative",
  "mixed",
  "vehicle_advantage",
  "tie",
  "trade_off",
  "insufficient_evidence",
] as const;
export type AspectAssessmentValue = (typeof ASPECT_ASSESSMENT_VALUES)[number];

export const CONSTRAINT_ASSESSMENT_VALUES = [
  "satisfied",
  "not_satisfied",
  "partially_satisfied",
  "insufficient_evidence",
] as const;
export type ConstraintAssessmentValue = (typeof CONSTRAINT_ASSESSMENT_VALUES)[number];

// Hard constraints parsed deterministically before retrieval (spec §11.3, lines 213-217).
export const CONSTRAINTS = ["minimum_seats", "allowed_powertrains", "transmission"] as const;
export type Constraint = (typeof CONSTRAINTS)[number];

// Priority / source markers for preference and usage-pattern updates.
export const UPDATE_SOURCES = ["explicit", "inferred"] as const;

export interface CitedText {
  text: string;
  citation_ids: string[];
}

export interface AspectAssessment {
  aspect: string;
  assessment: AspectAssessmentValue;
  winner_vehicle_id: string | null;
  explanation: string;
  citation_ids: string[];
}

export interface ConstraintAssessment {
  constraint: string;
  vehicle_id: string;
  status: ConstraintAssessmentValue;
  explanation: string;
  citation_ids: string[];
}

export interface PreferenceUpdate {
  aspect: string;
  priority: number;
  source: string;
  evidence_text: string;
}

export interface UsagePatternUpdate {
  usage_pattern: string;
  source: string;
  evidence_text: string;
}

export interface GenerationOutput {
  status: GenerationStatus;
  mode: GenerationMode;
  overview: CitedText;
  aspect_assessments: AspectAssessment[];
  constraint_assessments: ConstraintAssessment[];
  missing_information: string[];
  preference_updates: PreferenceUpdate[];
  usage_pattern_updates: UsagePatternUpdate[];
  follow_up_question: string | null;
}

// JSON Schema for the OpenAI Responses API strict structured output. Every property is listed in
// `required` and objects are closed (`additionalProperties: false`) per strict-mode rules;
// optional values are expressed as nullable.
export const GENERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "mode",
    "overview",
    "aspect_assessments",
    "constraint_assessments",
    "missing_information",
    "preference_updates",
    "usage_pattern_updates",
    "follow_up_question",
  ],
  properties: {
    status: { type: "string", enum: [...GENERATION_STATUSES] },
    mode: { type: "string", enum: [...GENERATION_MODES] },
    overview: citedTextSchema(),
    aspect_assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["aspect", "assessment", "winner_vehicle_id", "explanation", "citation_ids"],
        properties: {
          aspect: { type: "string", enum: [...ASPECTS] },
          assessment: { type: "string", enum: [...ASPECT_ASSESSMENT_VALUES] },
          winner_vehicle_id: { type: ["string", "null"] },
          explanation: { type: "string" },
          citation_ids: stringArraySchema(),
        },
      },
    },
    constraint_assessments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["constraint", "vehicle_id", "status", "explanation", "citation_ids"],
        properties: {
          constraint: { type: "string", enum: [...CONSTRAINTS] },
          vehicle_id: { type: "string" },
          status: { type: "string", enum: [...CONSTRAINT_ASSESSMENT_VALUES] },
          explanation: { type: "string" },
          citation_ids: stringArraySchema(),
        },
      },
    },
    missing_information: stringArraySchema(),
    preference_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["aspect", "priority", "source", "evidence_text"],
        properties: {
          aspect: { type: "string", enum: [...ASPECTS] },
          priority: { type: "integer" },
          source: { type: "string", enum: [...UPDATE_SOURCES] },
          evidence_text: { type: "string" },
        },
      },
    },
    usage_pattern_updates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["usage_pattern", "source", "evidence_text"],
        properties: {
          usage_pattern: { type: "string" },
          source: { type: "string", enum: [...UPDATE_SOURCES] },
          evidence_text: { type: "string" },
        },
      },
    },
    follow_up_question: { type: ["string", "null"] },
  },
} as const;

function citedTextSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text", "citation_ids"],
    properties: { text: { type: "string" }, citation_ids: stringArraySchema() },
  };
}

function stringArraySchema() {
  return { type: "array", items: { type: "string" } };
}
