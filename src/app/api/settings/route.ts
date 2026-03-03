import { encrypt } from "@/lib/encryption";
import { AI_PROVIDERS, type AIProvider } from "@/types/database";
import { getCurrentUser } from "@/lib/auth/server";
import { saveOracleUserSettings } from "@/lib/db/oracle";

export async function POST(request: Request) {
  try {
    const { provider, model, apiKey } = await request.json();
    const providerIds = new Set<string>(AI_PROVIDERS.map((p) => p.id));

    if (!provider || !providerIds.has(provider)) {
      return Response.json({ error: "Unsupported provider" }, { status: 400 });
    }
    if (!model || typeof model !== "string") {
      return Response.json({ error: "Model is required" }, { status: 400 });
    }

    const user = await getCurrentUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await saveOracleUserSettings({
      userId: user.id,
      provider: provider as AIProvider,
      model,
      encryptedApiKey: apiKey ? encrypt(apiKey) : undefined,
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Settings API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
