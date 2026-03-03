import { getCurrentUser } from "@/lib/auth/server";
import {
  createOraclePersonaIngestJob,
  getOraclePersonaById,
} from "@/lib/db/oracle";
import { defaultSources, enqueuePersonaIngestJob } from "@/lib/persona-ingest-worker";

interface RouteContext {
  params: Promise<{ personaId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { personaId } = await context.params;
    if (!personaId) return Response.json({ error: "personaId is required" }, { status: 400 });

    const persona = await getOraclePersonaById(personaId);
    if (!persona) return Response.json({ error: "Persona not found" }, { status: 404 });

    const job = await createOraclePersonaIngestJob({
      userId: user.id,
      personaId,
      query: persona.name,
      sources: defaultSources(),
      stats: {
        selectedCandidates: [],
        reason: "manual-reingest",
      },
    });

    enqueuePersonaIngestJob(job.id);
    return Response.json({ success: true, job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start re-ingest";
    return Response.json({ error: message }, { status: 500 });
  }
}
