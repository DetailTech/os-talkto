import { PersonaGrid } from "@/components/persona-grid";
import { requireUser } from "@/lib/auth/server";
import {
  getOracleChunkCountsByPersonaIds,
  getOracleUserSettings,
  listOraclePersonaIngestJobs,
  listOraclePersonas,
} from "@/lib/db/oracle";

export const dynamic = "force-dynamic";

export default async function PersonasPage() {
  const user = await requireUser();
  const personas = await listOraclePersonas();

  let favorites: string[] = [];
  const settings = await getOracleUserSettings(user.id);
  favorites = settings?.favorite_personas || [];
  const ingestJobs = await listOraclePersonaIngestJobs(user.id);
  const chunkCounts = await getOracleChunkCountsByPersonaIds(personas.map((p) => p.id));

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Personas</h1>
          <p className="text-muted-foreground mt-1">
            Chat with AI versions of your favorite authors, podcasters, and thought leaders.
          </p>
        </div>
        <PersonaGrid
          personas={personas}
          initialFavorites={favorites}
          initialIngestJobs={ingestJobs}
          initialChunkCounts={chunkCounts}
        />
      </div>
    </div>
  );
}
