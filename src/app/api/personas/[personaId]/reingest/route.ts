import { getCurrentUser } from "@/lib/auth/server";
import {
  createOraclePersonaIngestJob,
  getOraclePersonaById,
  listOraclePersonaIngestJobs,
} from "@/lib/db/oracle";
import { defaultSources, enqueuePersonaIngestJob } from "@/lib/persona-ingest-worker";

interface RouteContext {
  params: Promise<{ personaId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const existingJobs = await listOraclePersonaIngestJobs(user.id);
    const activeCount = existingJobs.filter(
      (job) => job.status === "queued" || job.status === "running"
    ).length;
    const maxActiveJobs = Number(process.env.PERSONA_INGEST_MAX_ACTIVE_JOBS || "3");
    if (activeCount >= maxActiveJobs) {
      return Response.json(
        {
          error: `Too many active ingest jobs (${activeCount}). Wait for jobs to finish.`,
        },
        { status: 429 }
      );
    }

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
