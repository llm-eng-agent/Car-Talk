import { describe, expect, it } from "vitest";
import { type Retriever } from "../retrieval/orchestrator";
import { type SearchOptions } from "../retrieval/retriever";
import { type RetrievedChunk } from "../retrieval/types";
import { answer } from "./answer";
import { type StructuredModel } from "./generate";
import { type GenerationOutput } from "./schema";
import { emptySession } from "./session";

function chunk(vehicleId: string, i = 0): RetrievedChunk {
  return {
    chunkId: `${vehicleId}::b0::c${i}`,
    documentId: vehicleId,
    vehicleId,
    score: 1 - i * 0.1,
    sectionHeading: "Range",
    contentType: "section",
    content: "טווח 500 קמ",
    articleTitle: `${vehicleId} review`,
    sourceUrl: `https://www.auto.co.il/${vehicleId}`,
  };
}

function retrieverReturning(handler: (o?: SearchOptions) => RetrievedChunk[]): Retriever {
  return { search: async (_q, o) => handler(o) };
}

function countingModel(output: GenerationOutput): { model: StructuredModel; calls: () => number } {
  let n = 0;
  return { model: async () => ((n += 1), output), calls: () => n };
}

const goodOutput: GenerationOutput = {
  status: "complete",
  mode: "single_vehicle",
  overview: { text: "טווח טוב", citation_ids: ["C1"] },
  aspect_assessments: [
    { aspect: "efficiency_range", assessment: "positive", winner_vehicle_id: null, explanation: "500 קמ", citation_ids: ["C1"] },
  ],
  constraint_assessments: [],
  missing_information: [],
  preference_updates: [],
  usage_pattern_updates: [],
  follow_up_question: null,
};

describe("answer pipeline", () => {
  it("short-circuits an out-of-corpus query to out_of_scope with no model call", async () => {
    const { model, calls } = countingModel(goodOutput);
    const retriever = retrieverReturning(() => [chunk("mg_s6")]);

    const res = await answer("האם כדאי לקנות טויוטה קורולה?", undefined, { retriever, model });

    expect(res.status).toBe("out_of_scope");
    expect(res.citations).toEqual([]);
    expect(res.unresolvedMention).toBe("Toyota");
    expect(calls()).toBe(0);
  });

  it("short-circuits a low-evidence query to insufficient_evidence with no model call", async () => {
    const { model, calls } = countingModel(goodOutput);
    const retriever = retrieverReturning(() => []); // nothing retrieved

    const res = await answer("ספר לי על MG S6", undefined, { retriever, model });

    expect(res.status).toBe("insufficient_evidence");
    expect(calls()).toBe(0);
  });

  it("runs generation for a single-vehicle query and returns resolved citations", async () => {
    const { model, calls } = countingModel(goodOutput);
    const retriever = retrieverReturning((o) => (o?.vehicleIds ? [chunk("mg_s6")] : []));

    const res = await answer("ספר לי על MG S6", undefined, { retriever, model });

    expect(res.status).toBe("complete");
    expect(res.mode).toBe("single_vehicle");
    expect(res.output).toEqual(goodOutput);
    expect(res.citations.map((c) => c.id)).toEqual(["C1"]);
    expect(res.recommendation).toBeUndefined(); // single vehicle → no recommendation
    expect(calls()).toBe(1);
  });

  it("attaches a deterministic recommendation for a multi-vehicle answer", async () => {
    const compOutput: GenerationOutput = {
      status: "complete",
      mode: "comparison",
      overview: { text: "השוואה", citation_ids: ["C1"] },
      aspect_assessments: [
        { aspect: "performance", assessment: "vehicle_advantage", winner_vehicle_id: "audi_rs3", explanation: "חזק יותר", citation_ids: ["C1"] },
      ],
      constraint_assessments: [],
      missing_information: [],
      preference_updates: [],
      usage_pattern_updates: [],
      follow_up_question: null,
    };
    const { model } = countingModel(compOutput);
    const retriever = retrieverReturning((o) => (o?.vehicleIds ? [chunk(o.vehicleIds[0])] : []));

    const res = await answer("אאודי מול קיה", undefined, { retriever, model });

    expect(res.mode).toBe("comparison");
    expect(res.recommendation?.decision).toBe("audi_rs3");
    expect(res.recommendation?.decisionRule).toBe("pareto");
  });

  it("returns only the source cards the answer actually cites", async () => {
    // Context gets two chunks (C1, C2) but the model cites only C1.
    const { model } = countingModel(goodOutput);
    const retriever = retrieverReturning((o) => (o?.vehicleIds ? [chunk("mg_s6", 0), chunk("mg_s6", 1)] : []));

    const res = await answer("ספר לי על MG S6", undefined, { retriever, model });

    expect(res.status).toBe("complete");
    expect(res.citations.map((c) => c.id)).toEqual(["C1"]);
  });

  it("does not surface a recommendation when the answer is insufficient_evidence", async () => {
    const insufficient: GenerationOutput = {
      status: "insufficient_evidence",
      mode: "comparison",
      overview: { text: "", citation_ids: [] },
      aspect_assessments: [],
      constraint_assessments: [
        { constraint: "minimum_seats", vehicle_id: "aion_ht", status: "not_satisfied", explanation: "", citation_ids: ["C1"] },
        { constraint: "minimum_seats", vehicle_id: "kia_ev9", status: "satisfied", explanation: "", citation_ids: ["C2"] },
      ],
      missing_information: [],
      preference_updates: [],
      usage_pattern_updates: [],
      follow_up_question: null,
    };
    const { model } = countingModel(insufficient);
    const retriever = retrieverReturning((o) => (o?.vehicleIds ? [chunk(o.vehicleIds[0])] : []));

    const res = await answer("איון מול קיה עם 7 מקומות", undefined, { retriever, model });

    expect(res.status).toBe("insufficient_evidence");
    expect(res.recommendation).toBeUndefined();
  });

  it("returns an updated session with the answered vehicle active", async () => {
    const { model } = countingModel(goodOutput);
    const retriever = retrieverReturning((o) => (o?.vehicleIds ? [chunk("mg_s6")] : []));

    const res = await answer("ספר לי על MG S6", undefined, { retriever, model });

    expect(res.session.activeVehicleIds).toEqual(["mg_s6"]);
  });

  it("uses the prior session's active vehicle for a follow-up that names none", async () => {
    const { model } = countingModel(goodOutput);
    const seen: string[][] = [];
    const retriever = retrieverReturning((o) => {
      if (o?.vehicleIds) seen.push(o.vehicleIds);
      return o?.vehicleIds ? [chunk(o.vehicleIds[0])] : [];
    });
    const prior = { ...emptySession(), activeVehicleIds: ["mg_s6"] };

    const res = await answer("ומה הטווח שלו?", prior, { retriever, model });

    expect(res.status).toBe("complete");
    expect(seen).toContainEqual(["mg_s6"]); // retrieval was filtered to the active vehicle
  });

  it("leaves the session unchanged on a terminal out_of_scope turn", async () => {
    const { model, calls } = countingModel(goodOutput);
    const retriever = retrieverReturning(() => [chunk("mg_s6")]);
    const prior = { ...emptySession(), activeVehicleIds: ["mg_s6"] };

    const res = await answer("האם כדאי לקנות טויוטה קורולה?", prior, { retriever, model });

    expect(res.status).toBe("out_of_scope");
    expect(res.session).toEqual(prior); // unchanged
    expect(calls()).toBe(0);
  });

  it("returns a safe error when retrieval throws (no model call)", async () => {
    const { model, calls } = countingModel(goodOutput);
    const retriever: Retriever = {
      search: async () => {
        throw new Error("qdrant down");
      },
    };

    const res = await answer("ספר לי על MG S6", undefined, { retriever, model });

    expect(res.status).toBe("error");
    expect(calls()).toBe(0);
  });
});
