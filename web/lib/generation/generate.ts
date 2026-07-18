// The single structured generation call (spec §14.1, §22.4/§22.5). One Responses-API call over the
// built context, validated server-side; at most one retry on a transient error, unparsable/invalid
// schema, or a validation failure; a second failure yields a safe fallback. The model call is
// injectable (`StructuredModel`) so the retry + validation logic is unit-tested offline.
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, jsonSchema } from "ai";
import { type RetrievalConfig } from "../retrieval/config";
import { type BuiltContext } from "./context";
import { GENERATION_JSON_SCHEMA, type GenerationOutput } from "./schema";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { validateGenerationOutput } from "./validate";

const MAX_OUTPUT_TOKENS = 1200; // spec §14.1
const MAX_ATTEMPTS = 2; // one call + one retry (spec §22.4)

// A single structured model invocation. Returns the parsed object (schema-shaped) or throws.
export type StructuredModel = (req: { system: string; prompt: string }) => Promise<unknown>;

export interface GenerateParams {
  userMessage: string;
  allowedVehicleIds: string[];
}

export type GenerateResult =
  | { ok: true; output: GenerationOutput }
  | { ok: false; errors: string[] };

export async function generateAnswer(
  built: BuiltContext,
  params: GenerateParams,
  model: StructuredModel,
): Promise<GenerateResult> {
  let errors: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = await model({ system: SYSTEM_PROMPT, prompt: built.contextText });
      const output = raw as GenerationOutput;
      const validation = validateGenerationOutput(output, {
        citationMap: built.citationMap,
        userMessage: params.userMessage,
        allowedVehicleIds: params.allowedVehicleIds,
      });
      if (validation.ok) return { ok: true, output };
      errors = validation.errors;
    } catch (error) {
      errors = [error instanceof Error ? error.message : String(error)];
    }
  }
  return { ok: false, errors };
}

// Default model: a real Responses-API structured call via the direct OpenAI provider (spec §14 —
// no AI Gateway), reasoning effort low, no tools, no temperature.
export function createDefaultModel(config: RetrievalConfig): StructuredModel {
  const provider = createOpenAI({ apiKey: config.openaiApiKey });
  const model = provider.responses(config.generationModel);
  return async ({ system, prompt }) => {
    const { object } = await generateObject({
      model,
      schema: jsonSchema(GENERATION_JSON_SCHEMA),
      system,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    return object;
  };
}
