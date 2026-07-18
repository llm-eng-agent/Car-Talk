import { describe, expect, it } from "vitest";
import { type EmbeddingProvider } from "./embedding";
import {
  BM25_MODEL,
  DENSE_VECTOR_NAME,
  HybridRetriever,
  type QdrantQueryClient,
  RetrievalError,
  SPARSE_VECTOR_NAME,
} from "./retriever";

const fakeEmbedder: EmbeddingProvider = {
  embedQuery: async () => [0.1, 0.2, 0.3],
};

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chunk_id: "mg_s6::b0::c0",
    document_id: "mg_s6",
    vehicle_id: "mg_s6",
    section_heading: "intro",
    content_type: "section",
    content: "טקסט",
    ...overrides,
  };
}

// Captures the last query body and returns scripted points.
function fakeClient(points: { payload?: Record<string, unknown> | null; score?: number }[]) {
  const calls: Parameters<QdrantQueryClient["query"]>[] = [];
  const client: QdrantQueryClient = {
    query: async (collection, body) => {
      calls.push([collection, body]);
      return { points };
    },
  };
  return { client, calls };
}

describe("HybridRetriever", () => {
  it("builds a hybrid dense+BM25 RRF query with the embedded vector", async () => {
    const { client, calls } = fakeClient([{ payload: payload(), score: 0.9 }]);
    const retriever = new HybridRetriever("col", fakeEmbedder, client);

    await retriever.search("מה הטווח?", { topK: 5 });

    const [collection, body] = calls[0];
    expect(collection).toBe("col");
    expect(body.limit).toBe(5);
    expect(body.query).toEqual({ fusion: "rrf" });
    expect(body.prefetch).toEqual([
      { query: [0.1, 0.2, 0.3], using: DENSE_VECTOR_NAME, limit: 20 },
      { query: { text: "מה הטווח?", model: BM25_MODEL }, using: SPARSE_VECTOR_NAME, limit: 20 },
    ]);
    expect(body.filter).toBeUndefined();
  });

  it("applies a vehicle_id filter when vehicleIds are given", async () => {
    const { client, calls } = fakeClient([]);
    const retriever = new HybridRetriever("col", fakeEmbedder, client);

    await retriever.search("q", { vehicleIds: ["mg_s6"] });

    expect(calls[0][1].filter).toEqual({
      must: [{ key: "vehicle_id", match: { any: ["mg_s6"] } }],
    });
  });

  it("projects payload fields and the fusion score into a RetrievedChunk", async () => {
    const { client } = fakeClient([{ payload: payload(), score: 0.42 }]);
    const retriever = new HybridRetriever("col", fakeEmbedder, client);

    const [chunk] = await retriever.search("q");

    expect(chunk).toEqual({
      chunkId: "mg_s6::b0::c0",
      documentId: "mg_s6",
      vehicleId: "mg_s6",
      score: 0.42,
      sectionHeading: "intro",
      contentType: "section",
      content: "טקסט",
    });
  });

  it("raises RetrievalError on a malformed payload", async () => {
    const { client } = fakeClient([{ payload: payload({ content: undefined }), score: 0.1 }]);
    const retriever = new HybridRetriever("col", fakeEmbedder, client);

    await expect(retriever.search("q")).rejects.toBeInstanceOf(RetrievalError);
  });
});
