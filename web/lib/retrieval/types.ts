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
