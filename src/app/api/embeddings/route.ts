import { decrypt } from "@/lib/encryption";
import { chunkText, createEmbedding } from "@/lib/rag";
import { getCurrentUser } from "@/lib/auth/server";
import { getOracleUserSettings, insertOracleDocumentChunk } from "@/lib/db/oracle";
import type { AIProvider } from "@/types/database";

export async function POST(request: Request) {
  try {
    const { text, personaId, metadata, apiKey: directApiKey } = await request.json();

    if (!text || !personaId) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const user = await getCurrentUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "admin") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get API key/provider: either from direct input or user settings
    let apiKey = directApiKey;
    let provider: AIProvider = "openai";
    if (!apiKey) {
      const settings = await getOracleUserSettings(user.id);

      if (!settings?.encrypted_api_key) {
        return Response.json(
          { error: "No API key available for embeddings" },
          { status: 400 }
        );
      }
      apiKey = decrypt(settings.encrypted_api_key);
      provider = settings.ai_provider;
    }

    // Chunk the text
    const chunks = chunkText(text);

    // Generate embeddings and store
    let insertedCount = 0;

    for (const chunk of chunks) {
      const embedding = await createEmbedding(provider, apiKey, chunk);

      try {
        await insertOracleDocumentChunk({
          personaId,
          content: chunk,
          embedding,
          metadata: metadata || {},
        });
        insertedCount++;
      } catch (error) {
        console.error("Insert chunk error:", error);
      }
    }

    return Response.json({
      success: true,
      chunksCreated: insertedCount,
      totalChunks: chunks.length,
    });
  } catch (error) {
    console.error("Embeddings API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
