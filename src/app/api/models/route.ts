import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/server";
import { getOracleUserSettings } from "@/lib/db/oracle";
import { decrypt } from "@/lib/encryption";
import type { AIProvider } from "@/types/database";

interface ModelOption {
  id: string;
  name: string;
}

class UpstreamError extends Error {
  status: number;
  publicMessage: string;
  constructor(message: string, status: number, publicMessage: string) {
    super(message);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function uniqueSorted(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  const deduped: ModelOption[] = [];
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue;
    seen.add(model.id);
    deduped.push(model);
  }
  return deduped.sort((a, b) => a.id.localeCompare(b.id));
}

async function listOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const details = await readErrorBody(response);
    throw new UpstreamError(
      `OpenAI model fetch failed: ${details || response.statusText}`,
      response.status,
      "Failed to fetch models from provider"
    );
  }
  const data = (await response.json()) as { data?: Array<{ id: string }> };
  const models = (data.data || [])
    .map((m) => ({ id: m.id, name: m.id }))
    .filter((m) => m.id.startsWith("gpt") || m.id.startsWith("o"));
  return uniqueSorted(models);
}

async function listGoogleModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    { cache: "no-store" }
  );
  if (!response.ok) {
    const details = await readErrorBody(response);
    throw new UpstreamError(
      `Google model fetch failed: ${details || response.statusText}`,
      response.status,
      "Failed to fetch models from provider"
    );
  }
  const data = (await response.json()) as {
    models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  };
  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      name: m.displayName || m.name.replace(/^models\//, ""),
    }));
  return uniqueSorted(models);
}

async function listOpenRouterModels(apiKey: string): Promise<ModelOption[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const details = await readErrorBody(response);
    throw new UpstreamError(
      `OpenRouter model fetch failed: ${details || response.statusText}`,
      response.status,
      "Failed to fetch models from provider"
    );
  }
  const data = (await response.json()) as {
    data?: Array<{ id: string; name?: string }>;
  };
  const models = (data.data || []).map((m) => ({ id: m.id, name: m.name || m.id }));
  return uniqueSorted(models);
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { provider?: AIProvider; apiKey?: string };
    const provider = body.provider;
    if (!provider) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    let apiKey = body.apiKey?.trim();
    if (!apiKey) {
      const settings = await getOracleUserSettings(user.id);
      if (!settings?.encrypted_api_key) {
        return NextResponse.json({ error: "No API key configured" }, { status: 400 });
      }
      apiKey = decrypt(settings.encrypted_api_key);
    }

    let models: ModelOption[] = [];
    switch (provider) {
      case "openai":
        models = await listOpenAIModels(apiKey);
        break;
      case "google":
        models = await listGoogleModels(apiKey);
        break;
      case "openrouter":
        models = await listOpenRouterModels(apiKey);
        break;
      default:
        return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
    }

    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof UpstreamError) {
      console.error("Models API upstream error:", error.message);
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }

    console.error("Models API error:", error);
    const status = error instanceof UpstreamError ? error.status : 500;
    return NextResponse.json({ error: "Failed to fetch models" }, { status });
  }
}
