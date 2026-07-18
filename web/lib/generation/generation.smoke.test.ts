// Live end-to-end smoke: real gpt-5.6-terra generation over the real Qdrant collection. SKIPPED
// unless the secrets are present (CI has no .env). Run locally with the repo-root .env:
//   cd web && pnpm test generation.smoke
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";
import { answer } from "./answer";

loadEnv({ path: path.resolve(process.cwd(), "../.env") });

const hasEnv = Boolean(
  process.env.OPENAI_API_KEY && process.env.QDRANT_URL && process.env.QDRANT_API_KEY,
);

const GEN_TIMEOUT = 40_000; // spec: generation timeout is 35s

describe.skipIf(!hasEnv)("live generation pipeline", () => {
  it("answers a single-vehicle query with grounded, resolvable citations", async () => {
    const res = await answer("מה הטווח והטעינה של MG S6?");

    expect(["complete", "partial", "insufficient_evidence"]).toContain(res.status);
    if (res.status === "insufficient_evidence") return; // acceptable business outcome

    expect(res.mode).toBe("single_vehicle");
    const known = new Set(res.citations.map((c) => c.id));
    // Every citation the model emitted resolves to a real source card.
    const emitted = [
      ...res.output!.overview.citation_ids,
      ...res.output!.aspect_assessments.flatMap((a) => a.citation_ids),
    ];
    for (const id of emitted) expect(known.has(id)).toBe(true);
    // A non-empty overview must be cited (no ungrounded claims).
    if (res.output!.overview.text.trim()) {
      expect(res.output!.overview.citation_ids.length).toBeGreaterThan(0);
    }
    // Citations carry real Auto.co.il source URLs, never model-invented ones.
    for (const c of res.citations) expect(c.sourceUrl).toContain("auto.co.il");
  }, GEN_TIMEOUT);

  it("keeps evidence for both vehicles in a comparison", async () => {
    const res = await answer("מה עדיף, אאודי RS3 או יונדאי אלנטרה N?");

    expect(["complete", "partial", "insufficient_evidence"]).toContain(res.status);
    if (res.status !== "insufficient_evidence") {
      expect(res.mode).toBe("comparison");
      const vehicles = new Set(res.citations.map((c) => c.vehicleId));
      expect(vehicles.has("audi_rs3")).toBe(true);
      expect(vehicles.has("hyundai_elantra_n_manual")).toBe(true);
    }
  }, GEN_TIMEOUT);

  it("returns a deterministic recommendation for a constrained recommendation query", async () => {
    const res = await answer("אני מחפש SUV חשמלי משפחתי עם 7 מקומות. מה מומלץ?");

    expect(["complete", "partial", "insufficient_evidence"]).toContain(res.status);
    if (res.status === "insufficient_evidence") return;

    expect(res.mode).toBe("recommendation");
    expect(res.recommendation).toBeDefined();
    // The application made the call deterministically.
    expect(["constraint", "lexicographic", "pareto", "none"]).toContain(res.recommendation!.decisionRule);
    // Any decision must be one of the retrieved candidates (never invented).
    if (res.recommendation!.decision) {
      const candidates = new Set(res.citations.map((c) => c.vehicleId));
      expect(candidates.has(res.recommendation!.decision)).toBe(true);
    }
  }, GEN_TIMEOUT);

  it("abstains for an out-of-corpus vehicle without a generation call", async () => {
    const res = await answer("האם כדאי לקנות טויוטה קורולה 2026?");

    expect(res.status).toBe("out_of_scope");
    expect(res.citations).toEqual([]);
    expect(res.unresolvedMention).toBe("Toyota");
  }, GEN_TIMEOUT);
});
