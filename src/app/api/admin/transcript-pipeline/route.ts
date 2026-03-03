import { decrypt } from "@/lib/encryption";
import { getCurrentUser } from "@/lib/auth/server";
import { runTranscriptPipeline } from "@/lib/transcript-pipeline";
import {
  getOracleUserSettings,
  hasOracleDocumentChunkBySourceKey,
  insertOracleDocumentChunk,
} from "@/lib/db/oracle";

export const runtime = "nodejs";

interface RequestBody {
  personaId?: string;
  query?: string;
  appleEpisodeUrl?: string;
  maxPodcasts?: number;
  maxEpisodes?: number;
  enableAudioTranscription?: boolean;
  apiKey?: string;
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const body = (await request.json()) as RequestBody;
    if (!body.personaId) {
      return Response.json({ error: "personaId is required" }, { status: 400 });
    }
    if (!body.query?.trim() && !body.appleEpisodeUrl?.trim()) {
      return Response.json(
        { error: "Provide at least one of query or appleEpisodeUrl." },
        { status: 400 }
      );
    }

    let apiKey = body.apiKey;
    if (!apiKey) {
      const settings = await getOracleUserSettings(user.id);

      if (!settings?.encrypted_api_key) {
        return Response.json(
          { error: "No API key available for embedding/transcription." },
          { status: 400 }
        );
      }
      apiKey = decrypt(settings.encrypted_api_key);
    }

    const result = await runTranscriptPipeline(
      {
        personaId: body.personaId,
        query: body.query,
        appleEpisodeUrl: body.appleEpisodeUrl,
        maxPodcasts: body.maxPodcasts,
        maxEpisodes: body.maxEpisodes,
        enableAudioTranscription: body.enableAudioTranscription,
        openaiApiKey: apiKey,
      },
      {
        hasChunkBySourceKey: hasOracleDocumentChunkBySourceKey,
        insertChunk: insertOracleDocumentChunk,
      }
    );

    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("Transcript pipeline error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
