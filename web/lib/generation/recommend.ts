// Deterministic recommendation engine (spec §17, Phase 7). The application — not the LLM — makes
// the final pick (§17.8). It consumes the model's evidence assessments and applies: hard
// constraints first, then lexicographic priorities, then Pareto dominance, else an explicit
// trade-off. No numerical scores, no chunk-counting, missing evidence is never a failure (§17.1).
import { type Aspect } from "../retrieval/types";
import { type ParsedConstraints } from "./constraints";
import { type GenerationOutput } from "./schema";

export type DecisionRule = "constraint" | "lexicographic" | "pareto" | "none";

export interface Recommendation {
  decision: string | null; // recommended vehicle_id, or null (trade-off / none)
  decisionRule: DecisionRule;
  reason: string;
  eliminated: { vehicleId: string; constraint: string }[];
  tradeOff: boolean;
  followUpQuestion: string | null;
}

export interface RecommendParams {
  candidateVehicleIds: string[];
  priorityAspects: Aspect[]; // the user's stated order (empty → Pareto)
  constraints: ParsedConstraints;
}

export function recommend(output: GenerationOutput, params: RecommendParams): Recommendation {
  const eliminated: { vehicleId: string; constraint: string }[] = [];
  const blocked = new Set<string>(); // stated constraint unverifiable → no confident pick (§1855)

  const anyConstraintStated =
    params.constraints.minimumSeats !== undefined ||
    (params.constraints.allowedPowertrains?.length ?? 0) > 0 ||
    params.constraints.transmission !== undefined;

  for (const vehicleId of params.candidateVehicleIds) {
    for (const c of output.constraint_assessments.filter((a) => a.vehicle_id === vehicleId)) {
      if (c.status === "not_satisfied") eliminated.push({ vehicleId, constraint: c.constraint });
      else if (c.status === "insufficient_evidence") blocked.add(vehicleId);
    }
  }

  const eliminatedIds = new Set(eliminated.map((e) => e.vehicleId));
  const survivors = params.candidateVehicleIds.filter((id) => !eliminatedIds.has(id));

  if (survivors.length === 0) {
    return terminal("constraint", null, "כל הרכבים נפסלו על ידי האילוצים הקשיחים.", eliminated, output);
  }
  if (survivors.length === 1) {
    const only = survivors[0];
    // A sole survivor is the pick unless a stated constraint could not be verified for it.
    if (blocked.has(only)) {
      return terminal("constraint", null, "הרכב היחיד שנותר אינו עומד באופן מאומת באילוץ שנדרש.", eliminated, output);
    }
    const rule = anyConstraintStated ? "constraint" : "pareto";
    return { decision: only, decisionRule: rule, reason: "הרכב היחיד שעומד באילוצים.", eliminated, tradeOff: false, followUpQuestion: null };
  }

  // Lexicographic: the highest-priority aspect with a clear winner among survivors decides.
  if (params.priorityAspects.length > 0) {
    for (const aspect of params.priorityAspects) {
      const winner = clearAspectWinner(output, aspect, survivors);
      if (winner && !blocked.has(winner)) {
        return {
          decision: winner,
          decisionRule: "lexicographic",
          reason: `הוכרע לפי העדיפות העליונה: ${aspect}.`,
          eliminated,
          tradeOff: false,
          followUpQuestion: null,
        };
      }
    }
    // No priority aspect produced a winner → fall through to Pareto over the survivors.
  }

  return pareto(output, survivors, blocked, eliminated);
}

// The single survivor that holds a vehicle_advantage on this aspect, or null (tie/mixed/
// trade_off/insufficient/absent all count as "no winner on this aspect").
function clearAspectWinner(output: GenerationOutput, aspect: Aspect, survivors: string[]): string | null {
  const survivorSet = new Set(survivors);
  for (const a of output.aspect_assessments) {
    if (a.aspect !== aspect) continue;
    if (a.assessment === "vehicle_advantage" && a.winner_vehicle_id && survivorSet.has(a.winner_vehicle_id)) {
      return a.winner_vehicle_id;
    }
  }
  return null;
}

// Pareto dominance (§17.6): the sole survivor that wins ≥1 decided aspect and loses none is
// recommended; if two survivors each win an aspect it is a genuine trade-off.
function pareto(
  output: GenerationOutput,
  survivors: string[],
  blocked: Set<string>,
  eliminated: { vehicleId: string; constraint: string }[],
): Recommendation {
  const survivorSet = new Set(survivors);
  const winsByVehicle = new Map<string, number>();
  for (const a of output.aspect_assessments) {
    if (a.assessment === "vehicle_advantage" && a.winner_vehicle_id && survivorSet.has(a.winner_vehicle_id)) {
      winsByVehicle.set(a.winner_vehicle_id, (winsByVehicle.get(a.winner_vehicle_id) ?? 0) + 1);
    }
  }
  const winners = [...winsByVehicle.keys()];

  if (winners.length === 1 && !blocked.has(winners[0])) {
    return {
      decision: winners[0],
      decisionRule: "pareto",
      reason: "עדיף על פני האחרים לפחות בהיבט אחד ואינו נחות באף היבט.",
      eliminated,
      tradeOff: false,
      followUpQuestion: null,
    };
  }
  if (winners.length >= 2) {
    return terminal("pareto", null, "קיים trade-off: רכבים שונים עדיפים בהיבטים שונים, אין מנצח יחיד.", eliminated, output, true);
  }
  return terminal("none", null, "אין די ראיות מבדילות כדי להכריע בין הרכבים.", eliminated, output, true);
}

function terminal(
  rule: DecisionRule,
  decision: string | null,
  reason: string,
  eliminated: { vehicleId: string; constraint: string }[],
  output: GenerationOutput,
  tradeOff = false,
): Recommendation {
  return { decision, decisionRule: rule, reason, eliminated, tradeOff, followUpQuestion: output.follow_up_question };
}
