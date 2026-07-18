// Server-side configuration and secret loading for the online retrieval orchestrator
// (spec §20.5). Values come from environment variables; API keys are never logged and never
// reach the browser. Mirrors the Python pipeline's `config.py` conventions so both stacks read
// the same variables.

export class ConfigError extends Error {}

export interface RetrievalConfig {
  openaiApiKey: string;
  embeddingModel: string;
  embeddingDimensions: number;
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
}

const DEFAULT_COLLECTION = "car_review_chunks_v1";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

function required(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new ConfigError(
      `${name} is not set. Add it to the repo-root .env (see .env.example).`,
    );
  }
  return value;
}

// Validated settings for the live retrieval path. Throws if any required secret is missing so
// a misconfiguration fails fast at startup rather than mid-request.
export function loadRetrievalConfig(): RetrievalConfig {
  return {
    openaiApiKey: required("OPENAI_API_KEY"),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    qdrantUrl: required("QDRANT_URL"),
    qdrantApiKey: required("QDRANT_API_KEY"),
    qdrantCollection: (process.env.QDRANT_COLLECTION ?? "").trim() || DEFAULT_COLLECTION,
  };
}
