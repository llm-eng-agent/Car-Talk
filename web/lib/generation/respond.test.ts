import { describe, expect, it } from "vitest";
import { type EvidencePackage } from "../retrieval/types";
import { modeForRoute, terminalResponse } from "./respond";

function pkg(overrides: Partial<EvidencePackage>): EvidencePackage {
  return { route: "single", vehicles: [], aspects: [], sufficient: true, ...overrides };
}

describe("terminalResponse", () => {
  it("short-circuits an out_of_scope package without generation", () => {
    const res = terminalResponse(pkg({ route: "out_of_scope", sufficient: false, unresolvedMention: "Toyota" }));
    expect(res?.status).toBe("out_of_scope");
    expect(res?.unresolvedMention).toBe("Toyota");
    // Every witty variant still names the make and states the corpus limit (spec §24.8).
    expect(res?.message).toContain("Toyota");
    expect(res?.message).toContain("שמונת הרכבים");
  });

  it("rotates the out_of_scope wording across calls", () => {
    const messages = new Set(
      Array.from({ length: 30 }, () =>
        terminalResponse(pkg({ route: "out_of_scope", sufficient: false, unresolvedMention: "Toyota" }))?.message,
      ),
    );
    expect(messages.size).toBeGreaterThan(1);
  });

  it("short-circuits a low-evidence package to insufficient_evidence", () => {
    const res = terminalResponse(pkg({ route: "single", sufficient: false }));
    expect(res?.status).toBe("insufficient_evidence");
  });

  it("returns null when the package is sufficient (proceed to generation)", () => {
    expect(terminalResponse(pkg({ route: "comparison", sufficient: true }))).toBeNull();
  });
});

describe("modeForRoute", () => {
  it("maps retrieval routes to generation modes", () => {
    expect(modeForRoute("single")).toBe("single_vehicle");
    expect(modeForRoute("comparison")).toBe("comparison");
    expect(modeForRoute("discovery")).toBe("recommendation");
    expect(modeForRoute("out_of_scope")).toBeNull();
  });
});
