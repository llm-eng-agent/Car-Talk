// Client-side dense query embeddings (spec §9-10). Qdrant Cloud hosts only BM25 server-side,
// NOT `text-embedding-3-small`, so dense query vectors are embedded here with OpenAI and passed
// to Qdrant as raw floats. The interface is injectable so the retriever's tests run offline.
import OpenAI from "openai";
import { type RetrievalConfig } from "./config";

export interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
}

const EMBED_TIMEOUT_MS = 10_000; // spec §: embedding timeout is 10 seconds

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: RetrievalConfig) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey, timeout: EMBED_TIMEOUT_MS });
    this.model = config.embeddingModel;
    this.dimensions = config.embeddingDimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({ model: this.model, input: text });
    const vector = response.data[0]?.embedding;
    if (!vector || vector.length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimensions}, got ${vector?.length ?? 0}.`,
      );
    }
    return vector;
  }
}
