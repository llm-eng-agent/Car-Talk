// Pre-generation short-circuit (spec §22.2, §22.3): terminal business statuses that must NOT call
// the model. An out-of-scope vehicle mention or a low-evidence package resolves to a status here
// without spending a generation call ("the system should not call the LLM with weak context solely
// to produce an answer"). The user-facing WORDING is a provisional placeholder — final phrasing is
// deferred to a later step per the owner.
import { type EvidencePackage, type Route } from "../retrieval/types";
import { type GenerationMode } from "./schema";

export interface TerminalResponse {
  status: "out_of_scope" | "insufficient_evidence";
  message: string;
  unresolvedMention?: string;
}

// Returns a terminal response when the package must not reach generation, or null when the caller
// should proceed to build context and generate.
export function terminalResponse(pkg: EvidencePackage): TerminalResponse | null {
  if (pkg.route === "out_of_scope") {
    return {
      status: "out_of_scope",
      message: outOfScopeMessage(pkg.unresolvedMention),
      unresolvedMention: pkg.unresolvedMention,
    };
  }
  if (!pkg.sufficient) {
    return { status: "insufficient_evidence", message: INSUFFICIENT_MESSAGE };
  }
  return null;
}

// The generation `mode` implied by the retrieval route (spec schema `mode`). out_of_scope never
// reaches generation, so it has no mode.
export function modeForRoute(route: Route): GenerationMode | null {
  switch (route) {
    case "single":
      return "single_vehicle";
    case "comparison":
      return "comparison";
    case "discovery":
      return "recommendation";
    case "out_of_scope":
      return null;
  }
}

// --- Provisional wording (deferred; to be refined) ---
function outOfScopeMessage(mention?: string): string {
  const subject = mention ? `«${mention}»` : "הרכב המבוקש";
  return `אין לי ביקורת על ${subject} במאגר. אני מוגבל לשמונה הרכבים שנסקרו ב-Auto.co.il.`;
}

const INSUFFICIENT_MESSAGE =
  "אין לי מספיק מידע במאגר הכתבות כדי לענות על השאלה הזו.";
