"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Link as LinkIcon, CheckCircle, AlertCircle } from "lucide-react";
import type { Persona } from "@/types/database";

interface TranscriptPipelineFormProps {
  personas: Pick<Persona, "id" | "slug" | "name">[];
}

interface PipelineItem {
  podcast: string;
  episodeTitle: string;
  status: "ingested" | "skipped" | "failed";
  method?: "rss-transcript" | "episode-page" | "audio-transcription";
  chunksInserted?: number;
  note?: string;
  sourceUrl?: string;
}

interface PipelineResponse {
  podcastsConsidered: number;
  episodesConsidered: number;
  episodesIngested: number;
  chunksInserted: number;
  results: PipelineItem[];
}

export function TranscriptPipelineForm({ personas }: TranscriptPipelineFormProps) {
  const [personaId, setPersonaId] = useState(personas[0]?.id || "");
  const [query, setQuery] = useState("");
  const [appleEpisodeUrl, setAppleEpisodeUrl] = useState("");
  const [maxPodcasts, setMaxPodcasts] = useState("3");
  const [maxEpisodes, setMaxEpisodes] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResponse | null>(null);

  const selectedPersonaName = useMemo(
    () => personas.find((persona) => persona.id === personaId)?.name || "Selected persona",
    [personaId, personas]
  );

  async function handleRunPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!personaId) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/admin/transcript-pipeline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personaId,
          query: query.trim() || undefined,
          appleEpisodeUrl: appleEpisodeUrl.trim() || undefined,
          maxPodcasts: Number(maxPodcasts) || 3,
          maxEpisodes: Number(maxEpisodes) || 10,
          enableAudioTranscription: true,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Pipeline failed");
      }
      setResult(data as PipelineResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          <CardTitle>Automated Transcript Pipeline</CardTitle>
        </div>
        <CardDescription>
          Search by person or podcast, find source transcripts, fallback to audio transcription when
          needed, then chunk/embed/load into the selected persona.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleRunPipeline} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pipeline-persona">Persona</Label>
            <Select
              id="pipeline-persona"
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
            >
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pipeline-query">Person or Podcast Name</Label>
            <Input
              id="pipeline-query"
              placeholder="e.g. Rob Walling or Startups For the Rest of Us"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pipeline-apple-url">Apple Episode URL (Optional)</Label>
            <Input
              id="pipeline-apple-url"
              placeholder="https://podcasts.apple.com/.../?i=..."
              value={appleEpisodeUrl}
              onChange={(e) => setAppleEpisodeUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pipeline-max-podcasts">Max Podcasts</Label>
              <Input
                id="pipeline-max-podcasts"
                type="number"
                min={1}
                max={10}
                value={maxPodcasts}
                onChange={(e) => setMaxPodcasts(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pipeline-max-episodes">Max Episodes</Label>
              <Input
                id="pipeline-max-episodes"
                type="number"
                min={1}
                max={100}
                value={maxEpisodes}
                onChange={(e) => setMaxEpisodes(e.target.value)}
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading || !personaId || (!query.trim() && !appleEpisodeUrl.trim())}
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Running Pipeline...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Find + Load Transcripts
              </>
            )}
          </Button>
        </form>

        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-lg text-sm bg-red-500/10 text-red-700 dark:text-red-300">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="mt-5 space-y-3">
            <div className="rounded-lg border p-3 text-sm">
              <p>
                Loaded for <span className="font-medium">{selectedPersonaName}</span>
              </p>
              <p className="text-muted-foreground">
                Podcasts considered: {result.podcastsConsidered} | Episodes scanned:{" "}
                {result.episodesConsidered} | Episodes ingested: {result.episodesIngested} | Chunks
                inserted: {result.chunksInserted}
              </p>
            </div>

            <div className="space-y-2 max-h-80 overflow-auto pr-1">
              {result.results.map((item, i) => (
                <div key={`${item.episodeTitle}-${i}`} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{item.episodeTitle || "Feed item"}</p>
                    <Badge
                      variant={
                        item.status === "ingested"
                          ? "default"
                          : item.status === "skipped"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {item.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{item.podcast || "Unknown podcast"}</p>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {item.status === "ingested" ? (
                      <CheckCircle className="h-3.5 w-3.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" />
                    )}
                    {item.method ? `Method: ${item.method}` : null}
                    {item.chunksInserted ? `Chunks: ${item.chunksInserted}` : null}
                  </div>
                  {item.note && <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>}
                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      Episode source
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
