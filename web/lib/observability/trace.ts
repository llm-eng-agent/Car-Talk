// Request-scoped trace fields (spec §21.2/§21.3) — a compact, safe summary of how one answer was
// produced. Deliberately excludes anything §21.4 forbids: no message text, no API keys, no raw
// chunks or prompts. The route merges this with a request id + latency into one structured log line.
export interface AnswerTrace {
  route: string | null; // retrieval route: single / comparison / discovery / out_of_scope
  vehicleCount: number; // resolved vehicles
  chunkCount: number; // evidence chunks retrieved
  retries: number; // generation retries used (0 or 1)
  recommendationRule: string | null; // deterministic decision rule, when a recommendation was made
  status: string; // final status (complete / partial / insufficient_evidence / out_of_scope / error)
}

export function emptyTrace(status: string): AnswerTrace {
  return { route: null, vehicleCount: 0, chunkCount: 0, retries: 0, recommendationRule: null, status };
}
