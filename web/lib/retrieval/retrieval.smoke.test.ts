// Live smoke check against the real Qdrant collection + OpenAI embeddings. SKIPPED unless the
// Qdrant/OpenAI secrets are present (same convention as the Python local-only test), so CI —
// which has no `.env` — never runs it. Run locally with the repo-root `.env` in place:
//   cd web && pnpm test retrieval.smoke
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { describe, expect, it } from "vitest";
import { createLiveRetriever } from "./factory";
import { orchestrate } from "./orchestrator";

// Load secrets from the repo-root .env (vitest runs with cwd = web/).
loadEnv({ path: path.resolve(process.cwd(), "../.env") });

const hasEnv = Boolean(
  process.env.OPENAI_API_KEY && process.env.QDRANT_URL && process.env.QDRANT_API_KEY,
);

describe.skipIf(!hasEnv)("live retrieval orchestrator", () => {
  const retriever = () => createLiveRetriever();

  it("single route returns top chunks for the named vehicle", async () => {
    const pkg = await orchestrate("כמה עולה ה-MG S6 ומה הטווח שלו?", retriever());

    expect(pkg.route).toBe("single");
    expect(pkg.sufficient).toBe(true);
    expect(pkg.vehicles).toHaveLength(1);
    expect(pkg.vehicles[0].vehicleId).toBe("mg_s6");
    expect(pkg.vehicles[0].chunks.length).toBeGreaterThan(0);
    expect(pkg.vehicles[0].chunks.every((c) => c.vehicleId === "mg_s6")).toBe(true);
  }, 30_000);

  it("comparison route returns balanced evidence for both vehicles", async () => {
    const pkg = await orchestrate("מה עדיף, אאודי RS3 או קיה EV9?", retriever());

    expect(pkg.route).toBe("comparison");
    expect(pkg.sufficient).toBe(true);
    expect(pkg.vehicles.map((v) => v.vehicleId).sort()).toEqual(["audi_rs3", "kia_ev9"]);
    expect(pkg.vehicles.every((v) => v.chunks.length > 0)).toBe(true);
  }, 30_000);

  it("discovery route surfaces candidate vehicles when none is named", async () => {
    const pkg = await orchestrate("איזה רכב משפחתי חשמלי הכי משתלם?", retriever());

    expect(pkg.route).toBe("discovery");
    expect(pkg.sufficient).toBe(true);
    expect(pkg.vehicles.length).toBeGreaterThan(0);
    expect(pkg.vehicles.length).toBeLessThanOrEqual(3);
  }, 30_000);

  it("abstains for an out-of-corpus vehicle without querying Qdrant", async () => {
    const pkg = await orchestrate("האם כדאי לקנות טויוטה קורולה 2026?", retriever());

    expect(pkg.route).toBe("out_of_scope");
    expect(pkg.sufficient).toBe(false);
    expect(pkg.vehicles).toEqual([]);
    expect(pkg.unresolvedMention).toBe("Toyota");
  }, 30_000);
});
