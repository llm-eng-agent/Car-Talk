// Composition root for the live retrieval path — wires config → OpenAI embedder + Qdrant client
// → HybridRetriever. Server-side only (loads secrets). This is the single place the Next.js
// chat route (Phase 6) and the live smoke test build a real retriever, so the wiring lives once.
import { loadRetrievalConfig } from "./config";
import { OpenAIEmbeddingProvider } from "./embedding";
import { createQdrantClient } from "./qdrantClient";
import { HybridRetriever, type QdrantQueryClient } from "./retriever";

export function createLiveRetriever(): HybridRetriever {
  const config = loadRetrievalConfig();
  // The real QdrantClient's query() is a superset of QdrantQueryClient; narrow it to the subset
  // the retriever uses (the generated OpenAPI types are too wide to assign structurally).
  const client = createQdrantClient(config) as unknown as QdrantQueryClient;
  return new HybridRetriever(config.qdrantCollection, new OpenAIEmbeddingProvider(config), client);
}
