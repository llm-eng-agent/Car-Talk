// Query-side hybrid retrieval over the `car_review_chunks_v1` collection (spec §9-10). Port of
// the Python `HybridRetriever` (pipeline/src/car_talk_pipeline/retrieval.py): RRF fusion of a
// dense prefetch (cosine over the OpenAI query embedding, embedded client-side) and a BM25
// prefetch (server-side `qdrant/bm25`), equal weights (weights are not tuned on the eval set).
// The Qdrant client and embedding provider are injectable so the orchestrator tests run offline.
import { type EmbeddingProvider } from "./embedding";
import { type RetrievedChunk } from "./types";

export const DENSE_VECTOR_NAME = "dense";
export const SPARSE_VECTOR_NAME = "bm25";
export const BM25_MODEL = "qdrant/bm25";
const DENSE_PREFETCH = 20;
const BM25_PREFETCH = 20;
export const DEFAULT_TOP_K = 5;

// A payload filter restricting results to a set of vehicles (spec §11.4).
interface QueryFilter {
  must: { key: string; match: { any: string[] } }[];
}

interface Prefetch {
  query: number[] | { text: string; model: string };
  using: string;
  limit: number;
}

// The subset of the Qdrant `query` API the retriever uses. The real `@qdrant/js-client-rest`
// `QdrantClient` satisfies this; tests provide a fake.
export interface QdrantQueryClient {
  query(
    collection: string,
    body: {
      prefetch?: Prefetch[];
      query: { fusion: string };
      filter?: QueryFilter;
      limit: number;
      with_payload: boolean;
    },
  ): Promise<{ points: { payload?: Record<string, unknown> | null; score?: number }[] }>;
}

export class RetrievalError extends Error {}

export interface SearchOptions {
  topK?: number;
  vehicleIds?: string[];
}

export class HybridRetriever {
  constructor(
    private readonly collection: string,
    private readonly provider: EmbeddingProvider,
    private readonly client: QdrantQueryClient,
  ) {}

  // Return the top-`topK` chunks for `queryText` via hybrid (dense + BM25, RRF) retrieval.
  // `vehicleIds`, when given, restricts results to those vehicles via a payload filter.
  async search(queryText: string, options: SearchOptions = {}): Promise<RetrievedChunk[]> {
    const topK = options.topK ?? DEFAULT_TOP_K;
    const dense = await this.provider.embedQuery(queryText);
    const response = await this.client.query(this.collection, {
      prefetch: [
        { query: dense, using: DENSE_VECTOR_NAME, limit: DENSE_PREFETCH },
        {
          query: { text: queryText, model: BM25_MODEL },
          using: SPARSE_VECTOR_NAME,
          limit: BM25_PREFETCH,
        },
      ],
      query: { fusion: "rrf" },
      filter: vehicleFilter(options.vehicleIds),
      limit: topK,
      with_payload: true,
    });
    return response.points.map((point) => toChunk(point.payload, point.score ?? 0));
  }
}

function vehicleFilter(vehicleIds?: string[]): QueryFilter | undefined {
  if (!vehicleIds || vehicleIds.length === 0) return undefined;
  return { must: [{ key: "vehicle_id", match: { any: vehicleIds } }] };
}

function toChunk(payload: Record<string, unknown> | null | undefined, score: number): RetrievedChunk {
  const p = payload ?? {};
  const field = (key: string): string => {
    const value = p[key];
    if (typeof value !== "string") {
      throw new RetrievalError(`Result point missing payload field '${key}'`);
    }
    return value;
  };
  return {
    chunkId: field("chunk_id"),
    documentId: field("document_id"),
    vehicleId: field("vehicle_id"),
    score,
    sectionHeading: field("section_heading"),
    contentType: field("content_type"),
    content: field("content"),
  };
}
