import { getCurrentUser } from "@/lib/auth/server";
import {
  createOraclePersona,
  createOraclePersonaIngestJob,
  getOraclePersonaBySlug,
  listOraclePersonaIngestJobs,
} from "@/lib/db/oracle";
import {
  defaultSources,
  enqueuePersonaIngestJob,
  inferPersonaFromCandidates,
  resumeActivePersonaIngestJobs,
  slugifyPersonaName,
} from "@/lib/persona-ingest-worker";
import type { PersonaSourceCandidate } from "@/types/database";

export const runtime = "nodejs";

function normalizedSources(input: unknown): {
  books: boolean;
  podcasts: boolean;
  youtube: boolean;
  blogs: boolean;
  interviews: boolean;
  social: boolean;
} {
  if (!input || typeof input !== "object") return defaultSources();
  const sourceInput = input as Record<string, unknown>;
  return {
    books: sourceInput.books !== false,
    podcasts: sourceInput.podcasts !== false,
    youtube: sourceInput.youtube !== false,
    blogs: sourceInput.blogs !== false,
    interviews: sourceInput.interviews !== false,
    social: sourceInput.social !== false,
  };
}

async function uniquePersonaSlug(baseName: string): Promise<string> {
  const base = slugifyPersonaName(baseName);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await getOraclePersonaBySlug(candidate);
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString().slice(-6)}`;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  await resumeActivePersonaIngestJobs(user.id);
  const jobs = await listOraclePersonaIngestJobs(user.id);
  return Response.json({ jobs });
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as {
      name?: string;
      sources?: unknown;
      selectedCandidates?: PersonaSourceCandidate[];
    };
    const name = body.name?.trim();
    if (!name) {
      return Response.json({ error: "Persona name is required" }, { status: 400 });
    }

    const sources = normalizedSources(body.sources);
    if (
      !sources.books &&
      !sources.podcasts &&
      !sources.youtube &&
      !sources.blogs &&
      !sources.interviews &&
      !sources.social
    ) {
      return Response.json({ error: "Select at least one source type" }, { status: 400 });
    }

    const selectedCandidates = Array.isArray(body.selectedCandidates)
      ? body.selectedCandidates
      : [];
    const inferred = inferPersonaFromCandidates(name, selectedCandidates);

    const slug = await uniquePersonaSlug(inferred.name);
    const persona = await createOraclePersona({
      name: inferred.name,
      slug,
      bio: inferred.bio,
    });

    const job = await createOraclePersonaIngestJob({
      userId: user.id,
      personaId: persona.id,
      query: name,
      sources,
      stats: {
        selectedCandidates,
      },
    });

    enqueuePersonaIngestJob(job.id);

    return Response.json({ persona, job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start persona ingestion";
    return Response.json({ error: message }, { status: 500 });
  }
}
