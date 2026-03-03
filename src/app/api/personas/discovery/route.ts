import { getCurrentUser } from "@/lib/auth/server";
import { defaultSources, discoverPersonaSources } from "@/lib/persona-ingest-worker";

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

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { query?: string; sources?: unknown };
    const query = body.query?.trim();
    if (!query) return Response.json({ error: "query is required" }, { status: 400 });

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

    const candidates = await discoverPersonaSources(query, sources);
    return Response.json({ candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
