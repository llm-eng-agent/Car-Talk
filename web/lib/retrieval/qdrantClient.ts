// Thin factory for a configured Qdrant Cloud client (spec §20.4). Kept separate so the
// retriever depends only on the client interface and tests can inject a fake.
import { QdrantClient } from "@qdrant/js-client-rest";
import { type RetrievalConfig } from "./config";

const QDRANT_TIMEOUT_MS = 10_000; // spec §: Qdrant timeout is 10 seconds

export function createQdrantClient(config: RetrievalConfig): QdrantClient {
  return new QdrantClient({
    url: config.qdrantUrl,
    apiKey: config.qdrantApiKey,
    timeout: QDRANT_TIMEOUT_MS,
  });
}
