import { describe, expect, it } from "vitest";
import { type EvidencePackage, type RetrievedChunk, type Route } from "../retrieval/types";
import { buildContext } from "./context";

function chunk(vehicleId: string, i: number): RetrievedChunk {
  return {
    chunkId: `${vehicleId}::b0::c${i}`,
    documentId: vehicleId,
    vehicleId,
    score: 1,
    sectionHeading: `Section ${i}`,
    contentType: "section",
    content: `content-${vehicleId}-${i}`,
    articleTitle: `${vehicleId} review`,
    sourceUrl: `https://www.auto.co.il/${vehicleId}`,
  };
}

function pkg(route: Route, vehicles: { vehicleId: string; chunks: RetrievedChunk[] }[]): EvidencePackage {
  return { route, vehicles, aspects: [], sufficient: true };
}

function manyChunks(vehicleId: string, n: number): RetrievedChunk[] {
  return Array.from({ length: n }, (_, i) => chunk(vehicleId, i));
}

describe("buildContext", () => {
  it("caps a single-vehicle package at 5 chunks", () => {
    const { citations } = buildContext("שאלה", pkg("single", [{ vehicleId: "mg_s6", chunks: manyChunks("mg_s6", 8) }]));
    expect(citations).toHaveLength(5);
  });

  it("caps each vehicle at 3 chunks for a comparison (≤6 total)", () => {
    const { citations, contextText } = buildContext(
      "השוואה",
      pkg("comparison", [
        { vehicleId: "mg_s6", chunks: manyChunks("mg_s6", 5) },
        { vehicleId: "kia_ev9", chunks: manyChunks("kia_ev9", 5) },
      ]),
    );
    expect(citations).toHaveLength(6);
    expect(contextText).toContain("Vehicle: MG S6");
    expect(contextText).toContain("Vehicle: Kia EV9");
  });

  it("labels the evidence untrusted and renders the fixed section layout", () => {
    const { contextText } = buildContext("מה הטווח?", pkg("single", [{ vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0)] }]));

    expect(contextText).toContain("USER REQUEST\nמה הטווח?");
    expect(contextText).toContain("UNTRUSTED REVIEW EVIDENCE");
    expect(contextText).toContain("[C1]\nSection: Section 0\nContent: content-mg_s6-0");
  });

  it("renders session sections only when provided, else None", () => {
    const withNone = buildContext("q", pkg("single", [{ vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0)] }]));
    expect(withNone.contextText).toContain("SESSION PREFERENCES\nNone");
    expect(withNone.contextText).toContain("ACTIVE VEHICLES\nNone");

    const withSession = buildContext(
      "q",
      pkg("single", [{ vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0)] }]),
      { activeVehicleIds: ["mg_s6"], preferences: ["טווח חשוב לי"] },
    );
    expect(withSession.contextText).toContain("SESSION PREFERENCES\nטווח חשוב לי");
    expect(withSession.contextText).toContain("ACTIVE VEHICLES\nMG S6");
  });
});
