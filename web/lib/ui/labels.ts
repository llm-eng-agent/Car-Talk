// Hebrew display labels for the enum tokens the pipeline emits. The model and the deterministic
// engines speak the locked English vocabulary (spec §11.5 etc.); the UI is the only place these
// become user-facing Hebrew. Kept in one map so wording stays consistent across every component.
import { loadVehicleCatalog } from "@/lib/retrieval/catalog";
import type { AspectAssessmentValue, ConstraintAssessmentValue } from "@/lib/generation/schema";
import type { DecisionRule } from "@/lib/generation/recommend";

export const ASPECT_LABELS: Record<string, string> = {
  ride_comfort: "נוחות נסיעה",
  space_practicality: "מרחב ופרקטיות",
  performance: "ביצועים",
  handling: "אחיזת כביש",
  interior_quality: "איכות הפנים",
  usability_ergonomics: "שימושיות וארגונומיה",
  efficiency_range: "יעילות וטווח",
  refinement: "שקט ועידון",
  value_for_money: "תמורה למחיר",
  safety_equipment: "בטיחות וציוד",
  design: "עיצוב",
};

export const ASPECT_ASSESSMENT_LABELS: Record<AspectAssessmentValue, string> = {
  positive: "חיובי",
  negative: "שלילי",
  mixed: "מעורב",
  vehicle_advantage: "יתרון",
  tie: "תיקו",
  trade_off: "פשרה",
  insufficient_evidence: "אין מספיק מידע",
};

// Tone class for an aspect assessment badge — maps to the state colors in globals.css.
export const ASSESSMENT_TONE: Record<AspectAssessmentValue, "good" | "warn" | "bad" | "neutral"> = {
  positive: "good",
  vehicle_advantage: "good",
  negative: "bad",
  mixed: "warn",
  trade_off: "warn",
  tie: "neutral",
  insufficient_evidence: "neutral",
};

export const CONSTRAINT_LABELS: Record<string, string> = {
  minimum_seats: "מספר מושבים",
  allowed_powertrains: "סוג הנעה",
  transmission: "תיבת הילוכים",
};

export const CONSTRAINT_STATUS_LABELS: Record<ConstraintAssessmentValue, string> = {
  satisfied: "עומד בדרישה",
  not_satisfied: "אינו עומד",
  partially_satisfied: "עומד חלקית",
  insufficient_evidence: "אין מספיק מידע",
};

export const CONSTRAINT_STATUS_TONE: Record<ConstraintAssessmentValue, "good" | "warn" | "bad" | "neutral"> = {
  satisfied: "good",
  not_satisfied: "bad",
  partially_satisfied: "warn",
  insufficient_evidence: "neutral",
};

export const USAGE_PATTERN_LABELS: Record<string, string> = {
  city_driving: "נהיגה עירונית",
  highway_driving: "נהיגה בין-עירונית",
  long_trips: "נסיעות ארוכות",
  family_with_children: "משפחה עם ילדים",
  sporty_driving: "נהיגה ספורטיבית",
};

export const POWERTRAIN_LABELS: Record<string, string> = {
  electric: "חשמלי",
  hybrid: "היברידי",
  gasoline: "בנזין",
  diesel: "דיזל",
};

export const TRANSMISSION_LABELS: Record<string, string> = {
  automatic: "אוטומטית",
  manual: "ידנית",
};

export const DECISION_RULE_LABELS: Record<DecisionRule, string> = {
  constraint: "לפי אילוצים",
  lexicographic: "לפי סדר העדיפויות שלך",
  pareto: "יתרון מובהק",
  none: "פשרה — ללא מנצח חד-משמעי",
};

// vehicle_id → display name, from the shared catalog (spec §11.2). Falls back to the raw id.
const NAME_BY_ID = new Map(loadVehicleCatalog().map((v) => [v.vehicleId, v.canonicalName]));

export function vehicleName(vehicleId: string): string {
  return NAME_BY_ID.get(vehicleId) ?? vehicleId;
}

export function aspectLabel(aspect: string): string {
  return ASPECT_LABELS[aspect] ?? aspect;
}
