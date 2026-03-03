import { getCurrentUser } from "@/lib/auth/server";
import { deleteOraclePersona } from "@/lib/db/oracle";

interface RouteContext {
  params: Promise<{ personaId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });
    const { personaId } = await context.params;
    if (!personaId) return Response.json({ error: "personaId is required" }, { status: 400 });

    await deleteOraclePersona(personaId);
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete persona";
    return Response.json({ error: message }, { status: 500 });
  }
}
