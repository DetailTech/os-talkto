import { getCurrentUser } from "@/lib/auth/server";
import { getOracleChunkCountsByPersonaIds, listOraclePersonasBasic } from "@/lib/db/oracle";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const personas = await listOraclePersonasBasic();
  const counts = await getOracleChunkCountsByPersonaIds(personas.map((p) => p.id));
  return Response.json({ counts });
}
