// Short-term session memory (spec §16). State lives in the browser and is sent with each request;
// the server sanitizes incoming state and returns a canonical updated state (§16.6). There is no
// long-term memory, no DB — a new session starts empty (§16.2). Preference extraction rides on the
// existing generation call (the model's preference_updates / usage_pattern_updates) — no extra LLM
// call (§16.5). All logic here is deterministic and offline-testable; browser persistence is Phase 9.
import { loadVehicleCatalog } from "../retrieval/catalog";
import { ASPECTS, type Aspect, type Route } from "../retrieval/types";
import {
  mergeConstraints,
  POWERTRAINS,
  TRANSMISSIONS,
  type ParsedConstraints,
  type Powertrain,
  type Transmission,
} from "./constraints";
import { type GenerationOutput } from "./schema";

// Supported usage patterns (spec §11.3, lines 237-243).
export const USAGE_PATTERNS = [
  "city_driving",
  "highway_driving",
  "long_trips",
  "family_with_children",
  "sporty_driving",
] as const;
export type UsagePattern = (typeof USAGE_PATTERNS)[number];

export interface SessionPreferences {
  priorities: Aspect[];
  constraints: ParsedConstraints;
  usagePatterns: UsagePattern[];
}

export interface RecentTurn {
  user: string;
  assistant: string;
}

export interface SessionState {
  activeVehicleIds: string[];
  comparisonVehicleIds: string[];
  preferences: SessionPreferences;
  recentTurns: RecentTurn[];
  // Per-aspect counters for the two-turn inferred-preference rule (spec §251). Not user-facing.
  inferredCounts: Record<string, number>;
}

export interface SessionTurn {
  userQuery: string;
  resolvedVehicleIds: string[];
  route: Route;
  output: GenerationOutput;
  constraints: ParsedConstraints;
}

const MAX_RECENT_TURNS = 2;
const INFERRED_THRESHOLD = 2; // an inferred preference sticks only after two distinct turns (§249)

const ASPECT_SET = new Set<string>(ASPECTS);
const USAGE_SET = new Set<string>(USAGE_PATTERNS);
const POWERTRAIN_SET = new Set<string>(POWERTRAINS);
const TRANSMISSION_SET = new Set<string>(TRANSMISSIONS);

export function emptySession(): SessionState {
  return {
    activeVehicleIds: [],
    comparisonVehicleIds: [],
    preferences: { priorities: [], constraints: {}, usagePatterns: [] },
    recentTurns: [],
    inferredCounts: {},
  };
}

// Server-side validation of client-sent state (§16.6): keep only approved vehicles, in-enum aspects
// / usage patterns / constraint values, and at most two recent turns. Tolerant of arbitrary input.
export function sanitizeSession(raw: unknown): SessionState {
  const state = emptySession();
  if (!raw || typeof raw !== "object") return state;
  const r = raw as Record<string, unknown>;
  const approved = new Set(loadVehicleCatalog().map((v) => v.vehicleId));

  state.activeVehicleIds = strings(r.activeVehicleIds).filter((id) => approved.has(id));
  state.comparisonVehicleIds = strings(r.comparisonVehicleIds).filter((id) => approved.has(id));

  const prefs = isObject(r.preferences) ? r.preferences : {};
  state.preferences.priorities = strings(prefs.priorities).filter((a) => ASPECT_SET.has(a)) as Aspect[];
  state.preferences.usagePatterns = strings(prefs.usagePatterns).filter((u) => USAGE_SET.has(u)) as UsagePattern[];
  state.preferences.constraints = sanitizeConstraints(prefs.constraints);

  if (Array.isArray(r.recentTurns)) {
    state.recentTurns = r.recentTurns
      .filter(isObject)
      .map((t) => ({ user: asString(t.user), assistant: asString(t.assistant) }))
      .slice(-MAX_RECENT_TURNS);
  }

  if (isObject(r.inferredCounts)) {
    for (const [aspect, count] of Object.entries(r.inferredCounts)) {
      if (ASPECT_SET.has(aspect) && typeof count === "number" && Number.isFinite(count)) {
        state.inferredCounts[aspect] = count;
      }
    }
  }
  return state;
}

// Fold one completed turn into the state (§16.3-16.4).
export function updateSession(prev: SessionState, turn: SessionTurn): SessionState {
  const next: SessionState = {
    activeVehicleIds: [...prev.activeVehicleIds],
    comparisonVehicleIds: [...prev.comparisonVehicleIds],
    preferences: {
      priorities: [...prev.preferences.priorities],
      constraints: { ...prev.preferences.constraints },
      usagePatterns: [...prev.preferences.usagePatterns],
    },
    recentTurns: [...prev.recentTurns],
    inferredCounts: { ...prev.inferredCounts },
  };

  // Active/comparison vehicles: a turn that names vehicles sets them; a follow-up that names none
  // keeps the prior active set.
  if (turn.resolvedVehicleIds.length > 0) {
    next.activeVehicleIds = [...turn.resolvedVehicleIds];
    if (turn.route === "comparison") next.comparisonVehicleIds = [...turn.resolvedVehicleIds];
  }

  // Priorities. Explicit updates define/override the ranking: sorted by their stated priority and
  // moved to the front, so a fresh explicit correction overrides a stale order (§16.4). Inferred
  // updates only stick after two turns (§249) and are appended.
  const explicit = turn.output.preference_updates.filter((u) => u.source === "explicit" && ASPECT_SET.has(u.aspect));
  const inferred = turn.output.preference_updates.filter((u) => u.source !== "explicit" && ASPECT_SET.has(u.aspect));

  if (explicit.length > 0) {
    const ranked = [...explicit].sort((a, b) => a.priority - b.priority).map((u) => u.aspect as Aspect);
    const rest = next.preferences.priorities.filter((a) => !ranked.includes(a));
    next.preferences.priorities = [...dedupe(ranked), ...rest];
  }
  for (const update of inferred) {
    const aspect = update.aspect as Aspect;
    next.inferredCounts[aspect] = (next.inferredCounts[aspect] ?? 0) + 1;
    if (next.inferredCounts[aspect] >= INFERRED_THRESHOLD) addPriority(next.preferences.priorities, aspect);
  }

  // Constraints: a new turn's explicitly-stated constraints override conflicting fields (§16.4).
  next.preferences.constraints = mergeConstraints(prev.preferences.constraints, turn.constraints);

  // Usage patterns: distinct union of in-enum values.
  for (const update of turn.output.usage_pattern_updates) {
    if (USAGE_SET.has(update.usage_pattern) && !next.preferences.usagePatterns.includes(update.usage_pattern as UsagePattern)) {
      next.preferences.usagePatterns.push(update.usage_pattern as UsagePattern);
    }
  }

  next.recentTurns = [...prev.recentTurns, { user: turn.userQuery, assistant: turn.output.overview.text }].slice(
    -MAX_RECENT_TURNS,
  );

  return next;
}

function addPriority(priorities: Aspect[], aspect: Aspect): void {
  if (!priorities.includes(aspect)) priorities.push(aspect);
}

function dedupe(aspects: Aspect[]): Aspect[] {
  return [...new Set(aspects)];
}

function sanitizeConstraints(raw: unknown): ParsedConstraints {
  const constraints: ParsedConstraints = {};
  if (!isObject(raw)) return constraints;
  if (typeof raw.minimumSeats === "number" && Number.isFinite(raw.minimumSeats)) {
    constraints.minimumSeats = raw.minimumSeats;
  }
  const powertrains = strings(raw.allowedPowertrains).filter((p) => POWERTRAIN_SET.has(p)) as Powertrain[];
  if (powertrains.length > 0) constraints.allowedPowertrains = powertrains;
  if (typeof raw.transmission === "string" && TRANSMISSION_SET.has(raw.transmission)) {
    constraints.transmission = raw.transmission as Transmission;
  }
  return constraints;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
