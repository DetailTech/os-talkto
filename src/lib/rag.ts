import { embed } from "ai";
import { getEmbeddingModelCandidates } from "./ai-providers";
import { getOracleRelevantChunks } from "./db/oracle";
import type { Persona } from "@/types/database";
import type { AIProvider } from "@/types/database";

export async function createEmbedding(
  provider: AIProvider,
  apiKey: string,
  value: string,
  purpose: "query" | "document" = "document"
): Promise<number[]> {
  const models = getEmbeddingModelCandidates(provider, apiKey);
  let lastError: unknown;

  for (const model of models) {
    try {
      const providerOptions =
        provider === "google"
          ? {
              google: {
                outputDimensionality: 1536,
                taskType:
                  purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
              },
            }
          : undefined;
      const { embedding } = await embed({
        model,
        value,
        providerOptions,
      });
      return embedding;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Embedding failed");
}

export async function getRelevantChunks(
  query: string,
  personaId: string,
  provider: AIProvider,
  apiKey: string,
  count: number = 8
): Promise<{ content: string; metadata: Record<string, unknown>; similarity: number }[]> {
  const embedding = await createEmbedding(provider, apiKey, query, "query");

  return getOracleRelevantChunks(personaId, embedding, count);
}

export function buildSystemPrompt(persona: Persona, contextChunks: { content: string }[]): string {
  const contextText = contextChunks.length > 0
    ? contextChunks.map((chunk, i) => `[Source ${i + 1}]: ${chunk.content}`).join("\n\n")
    : "No specific source material available for this query.";

  return `You are ${persona.name}. ${persona.bio}

Your areas of expertise include: ${persona.expertise.join(", ")}.

Answer questions exactly as ${persona.name} would — using their voice, tone, perspective, and insights. Draw from the following context extracted from their books and podcasts. Be conversational, helpful, and authentic to their communication style.

If the context doesn't contain relevant information for a question, you may draw on your general knowledge of ${persona.name}'s publicly known views and work, but prioritize the provided context. Always be honest if you're unsure about something.

=== CONTEXT FROM BOOKS & PODCASTS ===
${contextText}
=== END CONTEXT ===

Important guidelines:
- Speak in first person as ${persona.name}
- Reference specific books, episodes, or experiences when relevant
- Be practical and actionable in your advice
- Maintain ${persona.name}'s authentic voice and communication style`;
}

export function chunkText(
  text: string,
  maxTokens: number = 500,
  overlapTokens: number = 50
): string[] {
  // Approximate tokens as words * 1.3
  const words = text.split(/\s+/);
  const wordsPerChunk = Math.floor(maxTokens / 1.3);
  const overlapWords = Math.floor(overlapTokens / 1.3);

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    const chunk = words.slice(start, end).join(" ").trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end - overlapWords;
    if (start >= words.length - overlapWords) break;
  }

  return chunks;
}
