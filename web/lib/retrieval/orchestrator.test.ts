import { describe, expect, it } from "vitest";
import { orchestrate, type Retriever } from "./orchestrator";
import { type SearchOptions } from "./retriever";
import { type RetrievedChunk } from "./types";

function chunk(vehicleId: string, i = 0): RetrievedChunk {
  return {
    chunkId: `${vehicleId}::b0::c${i}`,
    documentId: vehicleId,
    vehicleId,
    score: 1 - i * 0.1,
    sectionHeading: "s",
    contentType: "section",
    content: `c-${vehicleId}-${i}`,
  };
}

// A retriever whose results are driven by a handler; records every call for assertions.
function scripted(handler: (options?: SearchOptions) => RetrievedChunk[]): Retriever & {
  calls: { queryText: string; options?: SearchOptions }[];
} {
  const calls: { queryText: string; options?: SearchOptions }[] = [];
  return {
    calls,
    search: async (queryText, options) => {
      calls.push({ queryText, options });
      return handler(options);
    },
  };
}

describe("orchestrate", () => {
  it("routes one named vehicle to the single route (top 5, filtered) and resolves aspects", async () => {
    const retriever = scripted((o) => (o?.vehicleIds ? [chunk("aion_ht")] : []));

    const pkg = await orchestrate("מה הטווח של האיון?", retriever);

    expect(pkg.route).toBe("single");
    expect(pkg.vehicles).toEqual([{ vehicleId: "aion_ht", chunks: [chunk("aion_ht")] }]);
    expect(pkg.aspects).toEqual(["efficiency_range"]);
    expect(pkg.sufficient).toBe(true);
    expect(retriever.calls[0].options).toEqual({ topK: 5, vehicleIds: ["aion_ht"] });
  });

  it("marks a single route insufficient when no chunks are retrieved", async () => {
    const retriever = scripted(() => []);

    const pkg = await orchestrate("ספר לי על האיון", retriever);

    expect(pkg.route).toBe("single");
    expect(pkg.sufficient).toBe(false);
  });

  it("runs balanced per-vehicle retrieval for a comparison (top 3 each, both sides present)", async () => {
    const retriever = scripted((o) => [chunk(o!.vehicleIds![0])]);

    const pkg = await orchestrate("איון מול קיה", retriever);

    expect(pkg.route).toBe("comparison");
    expect(pkg.vehicles.map((v) => v.vehicleId)).toEqual(["aion_ht", "kia_ev9"]);
    expect(pkg.vehicles.every((v) => v.chunks.length === 1)).toBe(true);
    expect(pkg.sufficient).toBe(true);
    for (const call of retriever.calls) {
      expect(call.options?.topK).toBe(3);
      expect(call.options?.vehicleIds).toHaveLength(1);
    }
  });

  it("marks a comparison insufficient when only one side has evidence", async () => {
    const retriever = scripted((o) => (o!.vehicleIds![0] === "aion_ht" ? [chunk("aion_ht")] : []));

    const pkg = await orchestrate("איון מול קיה", retriever);

    expect(pkg.route).toBe("comparison");
    expect(pkg.sufficient).toBe(false);
  });

  it("uses active session vehicles for a follow-up that names no vehicle", async () => {
    const retriever = scripted((o) => (o?.vehicleIds ? [chunk(o.vehicleIds[0])] : []));

    const pkg = await orchestrate("מה עם הטווח שלו?", retriever, { activeVehicleIds: ["mg_s6"] });

    expect(pkg.route).toBe("single");
    expect(pkg.vehicles[0].vehicleId).toBe("mg_s6");
    expect(pkg.sufficient).toBe(true);
  });

  it("discovers the top three candidate vehicles when no vehicle is named", async () => {
    const retriever = scripted((o) => {
      if (!o?.vehicleIds) {
        return [
          chunk("mg_s6", 0),
          chunk("mg_s6", 1),
          chunk("kia_ev9", 0),
          chunk("aion_ht", 0),
          chunk("lynk_co_01", 0),
        ];
      }
      return [chunk(o.vehicleIds[0])];
    });

    const pkg = await orchestrate("מה הרכב הכי משתלם למשפחה?", retriever);

    expect(pkg.route).toBe("discovery");
    expect(retriever.calls[0].options).toEqual({ topK: 20 });
    expect(pkg.vehicles.map((v) => v.vehicleId)).toEqual(["mg_s6", "kia_ev9", "aion_ht"]);
    expect(pkg.sufficient).toBe(true);
  });

  it("marks discovery insufficient when the collection returns nothing", async () => {
    const retriever = scripted(() => []);

    const pkg = await orchestrate("מה הרכב הכי משתלם למשפחה?", retriever);

    expect(pkg.route).toBe("discovery");
    expect(pkg.vehicles).toEqual([]);
    expect(pkg.sufficient).toBe(false);
  });
});
