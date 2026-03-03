"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  AlertCircle,
  X,
  ImagePlus,
} from "lucide-react";
import type { Persona } from "@/types/database";

interface UploadFormProps {
  personas: Pick<Persona, "id" | "slug" | "name">[];
}

export function UploadForm({ personas }: UploadFormProps) {
  const [personaId, setPersonaId] = useState(personas[0]?.id || "");
  const [source, setSource] = useState("");
  const [textContent, setTextContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshingImages, setRefreshingImages] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [imageResult, setImageResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);

    // Read text files automatically
    if (selectedFile.name.endsWith(".txt")) {
      const text = await selectedFile.text();
      setTextContent(text);
    } else if (selectedFile.name.endsWith(".pdf")) {
      setTextContent("[PDF file selected - content will be extracted on upload]");
    }
  }

  function clearFile() {
    setFile(null);
    setTextContent("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!personaId || !textContent.trim()) return;

    setUploading(true);
    setResult(null);

    try {
      const response = await fetch("/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textContent,
          personaId,
          metadata: {
            source: source || file?.name || "Manual input",
            uploadedAt: new Date().toISOString(),
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setResult({
        success: true,
        message: `Successfully created ${data.chunksCreated} of ${data.totalChunks} chunks.`,
      });

      // Clear form
      setTextContent("");
      setSource("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleRefreshProfileImages() {
    setRefreshingImages(true);
    setImageResult(null);
    try {
      const response = await fetch("/api/admin/personas/profile-images", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        scanned?: number;
        updated?: number;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to find profile images");
      }
      setImageResult({
        success: true,
        message: `Scanned ${payload.scanned || 0} personas missing images. Updated ${payload.updated || 0}.`,
      });
    } catch (error) {
      setImageResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to find profile images",
      });
    } finally {
      setRefreshingImages(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          <CardTitle>Upload Content</CardTitle>
        </div>
        <CardDescription>
          Upload text transcripts or paste content directly. The text will be chunked into ~500
          token segments, embedded, and stored for RAG retrieval.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-lg border p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Find profile pictures for personas that are missing images.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshProfileImages}
              disabled={refreshingImages}
            >
              {refreshingImages ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Finding...
                </>
              ) : (
                <>
                  <ImagePlus className="mr-2 h-4 w-4" />
                  Find Missing Profile Pictures
                </>
              )}
            </Button>
          </div>
          {imageResult && (
            <div
              className={`flex items-start gap-2 p-2 rounded-md text-xs ${
                imageResult.success
                  ? "bg-green-500/10 text-green-700 dark:text-green-300"
                  : "bg-red-500/10 text-red-700 dark:text-red-300"
              }`}
            >
              {imageResult.success ? (
                <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              )}
              {imageResult.message}
            </div>
          )}
        </div>

        <form onSubmit={handleUpload} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="persona">Persona</Label>
            <Select
              id="persona"
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source">Source Name</Label>
            <Input
              id="source"
              placeholder='e.g., "The SaaS Playbook - Chapter 3" or "SFRU Episode 642"'
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Upload File (.txt)</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={fileRef}
                type="file"
                accept=".txt"
                onChange={handleFileChange}
                className="file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
              />
              {file && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={clearFile}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {file && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {file.name}
                <Badge variant="secondary" className="text-xs">
                  {(file.size / 1024).toFixed(1)} KB
                </Badge>
              </div>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or paste text directly</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              placeholder="Paste transcript, book chapter, or other text content here..."
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              rows={12}
              className="font-mono text-xs"
            />
            {textContent && (
              <p className="text-xs text-muted-foreground">
                ~{Math.ceil(textContent.split(/\s+/).length * 1.3)} tokens,
                will create ~{Math.max(1, Math.ceil(textContent.split(/\s+/).length / 385))} chunks
              </p>
            )}
          </div>

          {result && (
            <div
              className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                result.success
                  ? "bg-green-500/10 text-green-700 dark:text-green-300"
                  : "bg-red-500/10 text-red-700 dark:text-red-300"
              }`}
            >
              {result.success ? (
                <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              {result.message}
            </div>
          )}

          <Button
            type="submit"
            disabled={uploading || !personaId || !textContent.trim()}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                Processing & Embedding...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload & Embed
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
