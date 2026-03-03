export interface Persona {
  id: string;
  slug: string;
  name: string;
  bio: string;
  expertise: string[];
  books_json: Book[];
  podcasts_json: Podcast[];
  image_url: string | null;
  conversation_starters: string[];
  created_at: string;
}

export interface Book {
  title: string;
  year?: number;
  description?: string;
}

export interface Podcast {
  title: string;
  url?: string;
  platform?: string;
}

export interface DocumentChunk {
  id: string;
  persona_id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Chat {
  id: string;
  user_id: string;
  persona_id: string;
  title: string;
  created_at: string;
  persona?: Persona;
  participants?: Pick<Persona, "id" | "slug" | "name" | "image_url">[];
}

export interface Message {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface UserSettings {
  id: string;
  user_id: string;
  ai_provider: AIProvider;
  ai_model: string;
  encrypted_api_key: string | null;
  favorite_personas: string[];
  created_at: string;
  updated_at: string;
}

export interface PersonaIngestJob {
  id: string;
  user_id: string;
  persona_id: string;
  query: string;
  sources: {
    books: boolean;
    podcasts: boolean;
    youtube: boolean;
    blogs: boolean;
    interviews: boolean;
    social: boolean;
  };
  status: "queued" | "running" | "completed" | "failed";
  step: string | null;
  progress_percent: number;
  stats: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  persona_name?: string;
  persona_slug?: string;
}

export interface PersonaSourceCandidate {
  id: string;
  type: "book" | "podcast" | "youtube" | "blog" | "interview" | "social";
  title: string;
  url?: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
}

export type AIProvider = "openai" | "google" | "openrouter";

export interface AIProviderConfig {
  id: AIProvider;
  name: string;
  models: { id: string; name: string }[];
  requiresKey: boolean;
}

export const AI_PROVIDERS: AIProviderConfig[] = [
  {
    id: "openai",
    name: "OpenAI",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    ],
    requiresKey: true,
  },
  {
    id: "google",
    name: "Google Gemini",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    ],
    requiresKey: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4 (via OpenRouter)" },
      { id: "openai/gpt-4o", name: "GPT-4o (via OpenRouter)" },
      { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash (via OpenRouter)" },
      { id: "meta-llama/llama-3.1-405b-instruct", name: "Llama 3.1 405B (via OpenRouter)" },
    ],
    requiresKey: true,
  },
];
