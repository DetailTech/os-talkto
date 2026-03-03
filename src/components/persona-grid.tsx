"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Heart,
  Search,
  MessageSquare,
  BookOpen,
  Mic,
  Plus,
  Trash2,
  Pencil,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Persona, PersonaIngestJob, PersonaSourceCandidate } from "@/types/database";

interface PersonaGridProps {
  personas: Persona[];
  initialFavorites: string[];
  initialIngestJobs: PersonaIngestJob[];
  initialChunkCounts: Record<string, number>;
}

export function PersonaGrid({
  personas,
  initialFavorites,
  initialIngestJobs,
  initialChunkCounts,
}: PersonaGridProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [personaList, setPersonaList] = useState<Persona[]>(personas);
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [ingestJobs, setIngestJobs] = useState<PersonaIngestJob[]>(initialIngestJobs);
  const [chunkCounts, setChunkCounts] = useState<Record<string, number>>(initialChunkCounts);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newPersonaName, setNewPersonaName] = useState("");
  const [sourceBooks, setSourceBooks] = useState(true);
  const [sourcePodcasts, setSourcePodcasts] = useState(true);
  const [sourceYoutube, setSourceYoutube] = useState(true);
  const [sourceBlogs, setSourceBlogs] = useState(true);
  const [sourceInterviews, setSourceInterviews] = useState(true);
  const [sourceSocial, setSourceSocial] = useState(true);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [candidates, setCandidates] = useState<PersonaSourceCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [deleteBusyPersonaId, setDeleteBusyPersonaId] = useState<string | null>(null);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [editingPersonaName, setEditingPersonaName] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    const timer = setInterval(async () => {
      const response = await fetch("/api/personas/ingest", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { jobs?: PersonaIngestJob[] };
      if (!payload.jobs) return;
      setIngestJobs(payload.jobs);

      const activePersonaIds = new Set(
        payload.jobs
          .filter((job) => job.status === "completed")
          .map((job) => job.persona_id)
      );
      if (activePersonaIds.size > 0) {
        const chunkRes = await fetch("/api/personas/chunk-counts", { cache: "no-store" });
        if (chunkRes.ok) {
          const chunkPayload = (await chunkRes.json()) as { counts?: Record<string, number> };
          if (chunkPayload.counts) setChunkCounts(chunkPayload.counts);
        }
      }
    }, 5000);

    return () => clearInterval(timer);
  }, []);

  const activeJobByPersona = useMemo(() => {
    const map = new Map<string, PersonaIngestJob>();
    for (const job of ingestJobs) {
      if (job.status === "queued" || job.status === "running") {
        map.set(job.persona_id, job);
      }
    }
    return map;
  }, [ingestJobs]);

  const filtered = personaList.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.bio.toLowerCase().includes(search.toLowerCase()) ||
      p.expertise.some((e) => e.toLowerCase().includes(search.toLowerCase()))
  );

  async function toggleFavorite(e: React.MouseEvent, personaId: string) {
    e.stopPropagation();
    const newFavorites = favorites.includes(personaId)
      ? favorites.filter((id) => id !== personaId)
      : [...favorites, personaId];
    setFavorites(newFavorites);

    await fetch("/api/settings/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorites: newFavorites }),
    });
  }

  function handlePersonaClick(persona: Persona) {
    router.push(`/chat/${persona.slug}`);
  }

  async function handleDiscoverySearch() {
    setCreateError("");
    setHasSearched(true);
    if (!newPersonaName.trim()) {
      setCreateError("Enter a person or podcast name");
      return;
    }
    if (
      !sourceBooks &&
      !sourcePodcasts &&
      !sourceYoutube &&
      !sourceBlogs &&
      !sourceInterviews &&
      !sourceSocial
    ) {
      setCreateError("Select at least one source type");
      return;
    }

    setDiscoveryLoading(true);
    try {
      const response = await fetch("/api/personas/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: newPersonaName.trim(),
          sources: {
            books: sourceBooks,
            podcasts: sourcePodcasts,
            youtube: sourceYoutube,
            blogs: sourceBlogs,
            interviews: sourceInterviews,
            social: sourceSocial,
          },
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        candidates?: PersonaSourceCandidate[];
      };
      if (!response.ok) throw new Error(payload.error || "Search failed");

      const discovered = payload.candidates || [];
      setCandidates(discovered);
      setSelectedCandidateIds(new Set(discovered.map((item) => item.id)));
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setDiscoveryLoading(false);
    }
  }

  function toggleCandidate(id: string) {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleStartPersonaIngest() {
    setCreateError("");
    if (!newPersonaName.trim()) {
      setCreateError("Enter a person or podcast name");
      return;
    }
    const selectedCandidates = candidates.filter((item) => selectedCandidateIds.has(item.id));
    if (selectedCandidates.length === 0) {
      setCreateError("Select at least one discovered source");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch("/api/personas/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPersonaName.trim(),
          sources: {
            books: sourceBooks,
            podcasts: sourcePodcasts,
            youtube: sourceYoutube,
            blogs: sourceBlogs,
            interviews: sourceInterviews,
            social: sourceSocial,
          },
          selectedCandidates,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        persona?: Persona;
        job?: PersonaIngestJob;
      };
      if (!response.ok || !payload.persona || !payload.job) {
        throw new Error(payload.error || "Failed to start persona ingestion");
      }

      setPersonaList((prev) => [payload.persona as Persona, ...prev]);
      setIngestJobs((prev) => [payload.job as PersonaIngestJob, ...prev]);
      setShowCreate(false);
      setHasSearched(false);
      setCandidates([]);
      setSelectedCandidateIds(new Set());
      setNewPersonaName("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to start ingestion");
    } finally {
      setCreating(false);
    }
  }

  async function handleDeletePersona(e: React.MouseEvent, personaId: string) {
    e.stopPropagation();
    if (!window.confirm("Delete this persona and all associated chats/RAG content?")) return;
    setDeleteBusyPersonaId(personaId);
    try {
      const response = await fetch(`/api/personas/${personaId}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Failed to delete persona");

      setPersonaList((prev) => prev.filter((p) => p.id !== personaId));
      setIngestJobs((prev) => prev.filter((job) => job.persona_id !== personaId));
      setFavorites((prev) => prev.filter((id) => id !== personaId));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to delete persona");
    } finally {
      setDeleteBusyPersonaId(null);
    }
  }

  function openPersonaEditor(e: React.MouseEvent, persona: Persona) {
    e.stopPropagation();
    setEditingPersonaId(persona.id);
    setEditingPersonaName(persona.name);
  }

  async function handleRegenerateProfile(e: React.MouseEvent, personaId: string) {
    e.stopPropagation();
    if (!editingPersonaName.trim()) return;
    setEditBusy(true);
    try {
      const response = await fetch(`/api/personas/${personaId}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingPersonaName.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; persona?: Persona };
      if (!response.ok || !payload.persona) {
        throw new Error(payload.error || "Failed to regenerate profile");
      }
      setPersonaList((prev) => prev.map((p) => (p.id === personaId ? payload.persona as Persona : p)));
      setEditingPersonaId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to regenerate profile");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleRegenerateRag(e: React.MouseEvent, personaId: string) {
    e.stopPropagation();
    setEditBusy(true);
    try {
      const response = await fetch(`/api/personas/${personaId}/reingest`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        job?: PersonaIngestJob;
      };
      if (!response.ok || !payload.job) {
        throw new Error(payload.error || "Failed to start re-ingest");
      }
      setIngestJobs((prev) => [payload.job as PersonaIngestJob, ...prev]);
      setEditingPersonaId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to start re-ingest");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search personas by name, bio, or expertise..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button type="button" onClick={() => setShowCreate((prev) => !prev)}>
          <Plus className="mr-2 h-4 w-4" />
          Add New Persona
        </Button>
      </div>

      {showCreate && (
        <Card className="p-4 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Step 1: Search for a person or podcast</p>
            <Input
              placeholder="e.g. Naval Ravikant, Lex Fridman"
              value={newPersonaName}
              onChange={(e) => setNewPersonaName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Source types</p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSourceBooks(true);
                  setSourcePodcasts(true);
                  setSourceYoutube(true);
                  setSourceBlogs(true);
                  setSourceInterviews(true);
                  setSourceSocial(true);
                }}
              >
                Select All
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSourceBooks(false);
                  setSourcePodcasts(false);
                  setSourceYoutube(false);
                  setSourceBlogs(false);
                  setSourceInterviews(false);
                  setSourceSocial(false);
                }}
              >
                Deselect All
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sourceBooks}
                  onChange={(e) => setSourceBooks(e.target.checked)}
                />
                Books
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sourcePodcasts}
                  onChange={(e) => setSourcePodcasts(e.target.checked)}
                />
                Podcasts
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sourceYoutube}
                  onChange={(e) => setSourceYoutube(e.target.checked)}
                />
                YouTube
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sourceBlogs}
                  onChange={(e) => setSourceBlogs(e.target.checked)}
                />
                Blogs
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sourceInterviews}
                  onChange={(e) => setSourceInterviews(e.target.checked)}
                />
                Interviews
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sourceSocial}
                  onChange={(e) => setSourceSocial(e.target.checked)}
                />
                Social Posts
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={handleDiscoverySearch} disabled={discoveryLoading}>
              {discoveryLoading ? "Searching..." : "Search"}
            </Button>
          </div>

          {hasSearched && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Step 2: Review and select sources</p>
                {candidates.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCandidateIds(new Set(candidates.map((c) => c.id)))}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCandidateIds(new Set())}
                    >
                      Deselect All
                    </Button>
                  </div>
                )}
              </div>
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sources found. Adjust search and try again.</p>
              ) : (
                <div className="max-h-64 overflow-auto border rounded p-2 space-y-1">
                  {candidates.map((candidate) => (
                    <label key={candidate.id} className="flex items-start gap-2 p-1.5 rounded hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={selectedCandidateIds.has(candidate.id)}
                        onChange={() => toggleCandidate(candidate.id)}
                      />
                      <div>
                        <p className="text-sm">{candidate.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {candidate.type.toUpperCase()}
                          {candidate.subtitle ? ` • ${candidate.subtitle}` : ""}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {createError && <p className="text-sm text-destructive">{createError}</p>}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleStartPersonaIngest}
              disabled={creating || candidates.length === 0}
            >
              {creating ? "Starting..." : "Start Import"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Step 3 runs asynchronously: transcript/text ingestion into RAG.
            </p>
          </div>
        </Card>
      )}

      {ingestJobs.some((job) => job.status === "queued" || job.status === "running") && (
        <Card className="p-3">
          <p className="text-sm font-medium mb-2">Persona ingestion in progress</p>
          <div className="space-y-2">
            {ingestJobs
              .filter((job) => job.status === "queued" || job.status === "running")
              .map((job) => (
                <div key={job.id}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span>{job.persona_name || job.query}</span>
                    <span>{Math.round(job.progress_percent)}%</span>
                  </div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, Math.max(0, job.progress_percent))}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {job.step || "Working..."}
                  </p>
                </div>
              ))}
          </div>
        </Card>
      )}

      {ingestJobs.some((job) => job.status === "failed") && (
        <Card className="p-3 border-destructive/30">
          <p className="text-sm font-medium mb-2">Recent ingest failures</p>
          <div className="space-y-1">
            {ingestJobs
              .filter((job) => job.status === "failed")
              .slice(0, 4)
              .map((job) => (
                <p key={job.id} className="text-xs text-muted-foreground">
                  {job.persona_name || job.query}: {job.error_message || "Unknown error"}
                </p>
              ))}
          </div>
        </Card>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium">No personas found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? "Try a different search term." : "No personas have been added yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((persona) => {
            const activeJob = activeJobByPersona.get(persona.id);
            return (
              <Card
                key={persona.id}
                className={cn(
                  "group relative overflow-hidden cursor-pointer transition-all hover:shadow-lg hover:border-primary/20 hover:-translate-y-0.5",
                  activeJob && "opacity-60"
                )}
                onClick={() => handlePersonaClick(persona)}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <Avatar className="h-14 w-14">
                      {persona.image_url && <AvatarImage src={persona.image_url} />}
                      <AvatarFallback className="text-lg font-semibold bg-primary/10 text-primary">
                        {persona.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 -mt-1"
                        onClick={(e) => openPersonaEditor(e, persona)}
                        title="Edit persona"
                      >
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 -mt-1"
                        disabled={deleteBusyPersonaId === persona.id}
                        onClick={(e) => handleDeletePersona(e, persona.id)}
                        title="Delete persona"
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 -mt-1 -mr-1"
                        onClick={(e) => toggleFavorite(e, persona.id)}
                      >
                        <Heart
                          className={cn(
                            "h-4 w-4 transition-colors",
                            favorites.includes(persona.id)
                              ? "fill-red-500 text-red-500"
                              : "text-muted-foreground"
                          )}
                        />
                      </Button>
                    </div>
                  </div>

                  <h3 className="font-semibold text-base mb-1">{persona.name}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{persona.bio}</p>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {persona.expertise.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs font-normal">
                        {tag}
                      </Badge>
                    ))}
                    {persona.expertise.length > 3 && (
                      <Badge variant="secondary" className="text-xs font-normal">
                        +{persona.expertise.length - 3}
                      </Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {persona.books_json?.length > 0 && (
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-3 w-3" />
                        {persona.books_json.length} book{persona.books_json.length !== 1 && "s"}
                      </span>
                    )}
                    {persona.podcasts_json?.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Mic className="h-3 w-3" />
                        {persona.podcasts_json.length} podcast
                        {persona.podcasts_json.length !== 1 && "s"}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                        RAG chunks: {chunkCounts[persona.id] || 0}
                      </Badge>
                    </span>
                  </div>

                  {activeJob && (
                    <div className="mt-3">
                      <div className="h-1.5 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, activeJob.progress_percent))}%` }}
                        />
                      </div>
                      <p className="text-[11px] mt-1 text-muted-foreground">
                        {activeJob.step || "Ingesting"}
                      </p>
                    </div>
                  )}

                  {editingPersonaId === persona.id && (
                    <div
                      className="mt-3 border rounded-md p-2 space-y-2 bg-background/95"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs font-medium">Edit persona</p>
                      <Input
                        value={editingPersonaName}
                        onChange={(e) => setEditingPersonaName(e.target.value)}
                        placeholder="Persona name"
                        className="h-8 text-xs"
                      />
                      <div className="flex flex-col items-stretch gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-xs w-full"
                          disabled={editBusy || !editingPersonaName.trim()}
                          onClick={(e) => void handleRegenerateProfile(e, persona.id)}
                        >
                          {editBusy ? "Working..." : "Save + Regenerate Profile"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs w-full"
                          disabled={editBusy}
                          onClick={(e) => void handleRegenerateRag(e, persona.id)}
                        >
                          <RefreshCcw className="h-3 w-3 mr-1" />
                          Regenerate RAG
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs px-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPersonaId(null);
                        }}
                      >
                        Close
                      </Button>
                    </div>
                  )}
                </div>

                <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
