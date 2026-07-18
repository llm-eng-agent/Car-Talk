import { describe, expect, it } from "vitest";
import { type Retriever } from "../retrieval/orchestrator";
import { type SearchOptions } from "../retrieval/retriever";
import { type RetrievedChunk } from "../retrieval/types";
import { answer } from "./answer";
import { type StructuredModel } from "./generate";
import { type GenerationOutput } from "./schema";

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
    expect(calls()).toBe(1);
  });

  it("returns only the source cards the answer actually cites", async () => {
    // Context gets two chunks (C1, C2) but the model cites only C1.
    const { model } = countingModel(goodOutput);
    const retriever = retrieverReturning((o) => (o?.vehicleIds ? [chunk("mg_s6", 0), chunk("mg_s6", 1)] : []));

    const res = await answer("ספר לי על MG S6", undefined, { retriever, model });

    expect(res.status).toBe("complete");
    expect(res.citations.map((c) => c.id)).toEqual(["C1"]);
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
