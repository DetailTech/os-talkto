import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { AIProvider } from "@/types/database";

export function getLanguageModel(provider: AIProvider, model: string, apiKey: string) {
  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(model);
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return openrouter(model);
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function getEmbeddingModelCandidates(provider: AIProvider, apiKey: string) {
  switch (provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return [openai.embedding("text-embedding-3-small")];
    }
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey });
      return [
        google.embedding("gemini-embedding-001"),
        google.embedding("text-embedding-004"),
      ];
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return [openrouter.embedding("text-embedding-3-small")];
    }
    default:
      throw new Error(`Provider ${provider} does not support embeddings in this app`);
  }
}
