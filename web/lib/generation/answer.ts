// End-to-end answer pipeline (spec §22): user query → retrieval orchestration → terminal
// short-circuit OR one grounded generation call → validated, cited answer. Retrieval and the model
// are injectable so the whole flow is unit-tested offline; production wires the live retriever and
// the real gpt-5.6-terra call.
import { loadRetrievalConfig } from "../retrieval/config";
import { createLiveRetriever } from "../retrieval/factory";
import { orchestrate, type Retriever } from "../retrieval/orchestrator";
import { type Citation } from "./citations";
import { mergeConstraints, parseConstraints } from "./constraints";
import { buildContext, type SessionContext } from "./context";
import { createDefaultModel, generateAnswer, type StructuredModel } from "./generate";
import { recommend, type Recommendation } from "./recommend";
import { modeForRoute, terminalResponse } from "./respond";
import { type GenerationMode, type GenerationOutput, type GenerationStatus } from "./schema";
import { emptySession, sanitizeSession, updateSession, type SessionState } from "./session";

export interface AnswerResult {
  status: GenerationStatus | "error";
  mode: GenerationMode | null;
  output?: GenerationOutput; // present for a generated answer
  citations: Citation[]; // resolved source cards (empty for terminal / error)
  recommendation?: Recommendation; // present for multi-vehicle answers (comparison / recommendation)
  message?: string; // for terminal (out_of_scope / insufficient) and error/fallback states
  unresolvedMention?: string;
  session: SessionState; // canonical updated session state (spec §16.6)
}

export interface AnswerDeps {
  retriever?: Retriever;
  model?: StructuredModel;
}

const RETRIEVAL_ERROR_MESSAGE = "אירעה שגיאה בשליפת המידע. נסו שוב מאוחר יותר.";
const GENERATION_FALLBACK_MESSAGE = "לא הצלחתי להפיק תשובה מבוססת-מקורות כעת. נסו שוב.";

export async function answer(
  userQuery: string,
  session?: SessionState,
  deps: AnswerDeps = {},
): Promise<AnswerResult> {
  const state = sanitizeSession(session ?? emptySession()); // validate client-sent state (§16.6)
  const retriever = deps.retriever ?? createLiveRetriever();

  let pkg;
  try {
    pkg = await orchestrate(userQuery, retriever, { activeVehicleIds: state.activeVehicleIds });
  } catch {
    // Retrieval unavailable → no LLM call, safe error (spec §22.3). State unchanged.
    return { status: "error", mode: null, citations: [], message: RETRIEVAL_ERROR_MESSAGE, session: state };
  }

  // out_of_scope / low-evidence → terminal status, no model call (spec §22.2). State unchanged.
  const terminal = terminalResponse(pkg);
  if (terminal) {
    return {
      status: terminal.status,
      mode: null,
      citations: [],
      message: terminal.message,
      unresolvedMention: terminal.unresolvedMention,
      session: state,
    };
  }

  // Remembered constraints carry forward, so the model assesses them even when this turn doesn't
  // restate them (spec §16). A newly-stated constraint overrides the remembered one.
  const currentConstraints = parseConstraints(userQuery);
  const effectiveConstraints = mergeConstraints(state.preferences.constraints, currentConstraints);
  const built = buildContext(userQuery, pkg, toContextView(state), effectiveConstraints);
  const mode = modeForRoute(pkg.route);
  const model = deps.model ?? createDefaultModel(loadRetrievalConfig());
  const result = await generateAnswer(
    built,
    { userMessage: userQuery, allowedVehicleIds: pkg.vehicles.map((v) => v.vehicleId) },
    model,
  );

  if (!result.ok) {
    // One retry already happened inside generateAnswer; return a safe fallback (spec §22.4/§22.5).
    return { status: "error", mode, citations: [], message: GENERATION_FALLBACK_MESSAGE, session: state };
  }
  // Expose only the source cards the answer actually cites, so the UI never shows a source that
  // backs no visible claim.
  const used = citedIds(result.output);
  const citations = built.citations.filter((c) => used.has(c.id));

  const updatedSession = updateSession(state, {
    userQuery,
    resolvedVehicleIds: pkg.vehicles.map((v) => v.vehicleId),
    route: pkg.route,
    output: result.output,
    constraints: currentConstraints,
  });

  // The application — not the model — makes the final pick, for multi-vehicle answers (spec §17.8).
  // Never surface a recommendation when evidence is insufficient (spec §14.6). The pick honors
  // remembered priorities/constraints, not just this turn's (this turn's focus leads the order).
  const canRecommend = result.output.status === "complete" || result.output.status === "partial";
  const recommendation =
    pkg.vehicles.length > 1 && canRecommend
      ? recommend(result.output, {
          candidateVehicleIds: pkg.vehicles.map((v) => v.vehicleId),
          priorityAspects: [...new Set([...pkg.aspects, ...updatedSession.preferences.priorities])],
          constraints: effectiveConstraints,
        })
      : undefined;

  return { status: result.output.status, mode, output: result.output, citations, recommendation, session: updatedSession };
}

// Render the session's preferences into the plain view the context builder consumes.
function toContextView(state: SessionState): SessionContext {
  const preferences: string[] = [];
  for (const aspect of state.preferences.priorities) preferences.push(`עדיפות: ${aspect}`);
  const c = state.preferences.constraints;
  if (c.minimumSeats !== undefined) preferences.push(`אילוץ: לפחות ${c.minimumSeats} מקומות`);
  if (c.allowedPowertrains?.length) preferences.push(`אילוץ: הנעה ${c.allowedPowertrains.join("/")}`);
  if (c.transmission) preferences.push(`אילוץ: תיבה ${c.transmission}`);
  for (const usage of state.preferences.usagePatterns) preferences.push(`שימוש: ${usage}`);
  return { activeVehicleIds: state.activeVehicleIds, preferences };
}

// The citation IDs referenced anywhere in the validated output.
function citedIds(output: GenerationOutput): Set<string> {
  return new Set([
    ...output.overview.citation_ids,
    ...output.aspect_assessments.flatMap((a) => a.citation_ids),
    ...output.constraint_assessments.flatMap((c) => c.citation_ids),
  ]);
}
