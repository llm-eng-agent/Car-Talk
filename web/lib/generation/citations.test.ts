import { describe, expect, it } from "vitest";
import { type EvidencePackage, type RetrievedChunk } from "../retrieval/types";
import { buildCitations } from "./citations";

function chunk(vehicleId: string, i: number, content = `content-${vehicleId}-${i}`): RetrievedChunk {
  return {
    chunkId: `${vehicleId}::b0::c${i}`,
    documentId: vehicleId,
    vehicleId,
    score: 1,
    sectionHeading: `Section ${i}`,
    contentType: "section",
    content,
    articleTitle: `${vehicleId} review`,
    sourceUrl: `https://www.auto.co.il/${vehicleId}`,
  };
}

function pkg(vehicles: { vehicleId: string; chunks: RetrievedChunk[] }[]): EvidencePackage {
  return { route: "comparison", vehicles, aspects: [], sufficient: true };
}

describe("buildCitations", () => {
  it("assigns sequential C-ids across vehicles in grouped order", () => {
    const { citations, map } = buildCitations(
      pkg([
        { vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0), chunk("mg_s6", 1)] },
        { vehicleId: "kia_ev9", chunks: [chunk("kia_ev9", 0)] },
      ]),
    );

    expect(citations.map((c) => c.id)).toEqual(["C1", "C2", "C3"]);
    expect(map.get("C1")?.chunkId).toBe("mg_s6::b0::c0");
    expect(map.get("C3")?.vehicleId).toBe("kia_ev9");
    expect(map.get("C2")?.sourceUrl).toBe("https://www.auto.co.il/mg_s6");
  });

  it("truncates the excerpt to 700 characters with an ellipsis", () => {
    const long = "א".repeat(1000);
    const { map } = buildCitations(pkg([{ vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0, long)] }]));

    const excerpt = map.get("C1")!.excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(701); // 700 chars + ellipsis
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("keeps short content verbatim", () => {
    const { map } = buildCitations(pkg([{ vehicleId: "mg_s6", chunks: [chunk("mg_s6", 0, "קצר")] }]));
    expect(map.get("C1")!.excerpt).toBe("קצר");
  });
});
