import { getCurrentUser } from "@/lib/auth/server";
import { getOraclePersonaById } from "@/lib/db/oracle";
import { regeneratePersonaProfile } from "@/lib/persona-ingest-worker";

interface RouteContext {
  params: Promise<{ personaId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

    const { personaId } = await context.params;
    if (!personaId) return Response.json({ error: "personaId is required" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      query?: string;
    };

    await regeneratePersonaProfile({
      userId: user.id,
      personaId,
      nameOverride: body.name,
      query: body.query,
    });

    const persona = await getOraclePersonaById(personaId);
    return Response.json({ success: true, persona });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate profile";
    return Response.json({ error: message }, { status: 500 });
  }
}
