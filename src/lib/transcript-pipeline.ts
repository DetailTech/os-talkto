import { chunkText, createEmbedding } from "@/lib/rag";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export interface PipelineInput {
  personaId: string;
  query?: string;
  appleEpisodeUrl?: string;
  openaiApiKey: string;
  maxPodcasts?: number;
  maxEpisodes?: number;
  enableAudioTranscription?: boolean;
}

export interface PipelineEpisodeResult {
  podcast: string;
  episodeTitle: string;
  status: "ingested" | "skipped" | "failed";
  method?: "rss-transcript" | "episode-page" | "audio-transcription";
  chunksInserted?: number;
  note?: string;
  sourceUrl?: string;
}

export interface PipelineResult {
  podcastsConsidered: number;
  episodesConsidered: number;
  episodesIngested: number;
  chunksInserted: number;
  results: PipelineEpisodeResult[];
}

interface PodcastCandidate {
  collectionName: string;
  feedUrl: string;
}

interface EpisodeCandidate {
  title: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  description?: string;
  transcriptUrl?: string;
  audioUrl?: string;
}

interface TranscriptPayload {
  text: string;
  method: "rss-transcript" | "episode-page" | "audio-transcription";
  transcriptUrl?: string;
  note?: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function parseTag(item: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = item.match(pattern);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function parseTagAttribute(item: string, tagName: string, attribute: string): string | undefined {
  const pattern = new RegExp(`<${tagName}[^>]*\\s${attribute}="([^"]+)"[^>]*>`, "i");
  const match = item.match(pattern);
  return match?.[1]?.trim();
}

function parseItems(feedXml: string): EpisodeCandidate[] {
  const items = feedXml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const transcriptUrl = parseTagAttribute(item, "podcast:transcript", "url");
    const audioUrl = parseTagAttribute(item, "enclosure", "url");
    return {
      title: parseTag(item, "title") || "Untitled episode",
      link: parseTag(item, "link"),
      guid: parseTag(item, "guid"),
      pubDate: parseTag(item, "pubDate"),
      description: parseTag(item, "description"),
      transcriptUrl,
      audioUrl,
    };
  });
}

function parseAppleEpisodeId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("i") || undefined;
  } catch {
    return undefined;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }
  return response.json() as Promise<T>;
}

async function searchPodcastsByQuery(query: string, limit: number): Promise<PodcastCandidate[]> {
  const searchUrl =
    `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(query)}&media=podcast&limit=${limit}`;
  const payload = await fetchJson<{ results: Array<{ collectionName?: string; feedUrl?: string }> }>(
    searchUrl
  );

  return payload.results
    .filter((item) => item.collectionName && item.feedUrl)
    .map((item) => ({
      collectionName: item.collectionName as string,
      feedUrl: item.feedUrl as string,
    }));
}

async function lookupPodcastFromAppleEpisode(episodeId: string): Promise<PodcastCandidate[]> {
  const lookupUrl =
    `${ITUNES_LOOKUP_URL}?id=${encodeURIComponent(episodeId)}&entity=podcastEpisode`;
  const payload = await fetchJson<{
    results: Array<{ wrapperType?: string; collectionName?: string; feedUrl?: string }>;
  }>(lookupUrl);

  return payload.results
    .filter((item) => item.wrapperType === "track" && item.collectionName && item.feedUrl)
    .map((item) => ({
      collectionName: item.collectionName as string,
      feedUrl: item.feedUrl as string,
    }));
}

async function fetchFeedEpisodes(feedUrl: string): Promise<EpisodeCandidate[]> {
  const response = await fetch(feedUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Feed fetch failed (${response.status})`);
  }
  const feedXml = await response.text();

  return parseItems(feedXml).sort((a, b) => {
    const aTime = a.pubDate ? Date.parse(a.pubDate) : 0;
    const bTime = b.pubDate ? Date.parse(b.pubDate) : 0;
    return bTime - aTime;
  });
}

function parseWebVtt(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/^WEBVTT.*$/gim, " ")
      .replace(/^NOTE.*$/gim, " ")
      .replace(
        /\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}.*/g,
        " "
      )
      .replace(/\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}\.\d{3}.*/g, " ")
  );
}

function parseSrt(text: string): string {
  return normalizeWhitespace(
    text
      .replace(/^\d+$/gm, " ")
      .replace(
        /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}.*/g,
        " "
      )
  );
}

function flattenJsonText(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenJsonText(entry, output));
    return output;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const textCandidate = record.text;
    if (typeof textCandidate === "string") {
      output.push(textCandidate);
    }
    Object.values(record).forEach((entry) => flattenJsonText(entry, output));
  }
  return output;
}

async function fetchTranscriptFromUrl(url: string): Promise<string | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const bodyText = await response.text();
  const normalizedUrl = url.toLowerCase();

  if (normalizedUrl.endsWith(".vtt") || contentType.includes("text/vtt")) {
    return parseWebVtt(bodyText);
  }
  if (normalizedUrl.endsWith(".srt") || contentType.includes("application/x-subrip")) {
    return parseSrt(bodyText);
  }
  if (normalizedUrl.endsWith(".json") || contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      return normalizeWhitespace(flattenJsonText(parsed).join(" "));
    } catch {
      return null;
    }
  }
  if (contentType.includes("text/html") || /<html[\s>]/i.test(bodyText)) {
    return normalizeWhitespace(decodeHtmlEntities(stripHtml(bodyText)));
  }
  return normalizeWhitespace(bodyText);
}

async function maybeFindTranscriptFromEpisodePage(url?: string): Promise<string | null> {
  if (!url) return null;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const html = await response.text();
  const transcriptLink = html.match(
    /<a[^>]+href="([^"]+)"[^>]*>\s*(?:full\s+)?transcript\s*<\/a>/i
  );
  if (transcriptLink?.[1]) {
    try {
      const absoluteUrl = new URL(transcriptLink[1], url).toString();
      const text = await fetchTranscriptFromUrl(absoluteUrl);
      if (text && text.split(/\s+/).length > 120) return text;
    } catch {
      // continue with section extraction
    }
  }

  const sectionMatch = html.match(
    /<h[1-4][^>]*>\s*transcript\s*<\/h[1-4]>([\s\S]{500,200000})/i
  );
  if (!sectionMatch?.[1]) return null;

  const plain = normalizeWhitespace(decodeHtmlEntities(stripHtml(sectionMatch[1])));
  return plain.split(/\s+/).length > 120 ? plain : null;
}

async function transcribeAudioEpisode(audioUrl: string, apiKey: string): Promise<string | null> {
  const head = await fetch(audioUrl, { method: "HEAD", cache: "no-store" });
  const contentLength = Number(head.headers.get("content-length") || "0");
  if (contentLength > MAX_AUDIO_BYTES) {
    return null;
  }

  const audioResponse = await fetch(audioUrl, { cache: "no-store" });
  if (!audioResponse.ok) return null;

  const audioBuffer = await audioResponse.arrayBuffer();
  if (audioBuffer.byteLength > MAX_AUDIO_BYTES) return null;

  const form = new FormData();
  const contentType = audioResponse.headers.get("content-type") || "audio/mpeg";
  const extension = contentType.split("/")[1]?.split(";")[0] || "mp3";
  const blob = new Blob([audioBuffer], { type: contentType });
  form.append("file", blob, `episode.${extension}`);
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "text");

  const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    cache: "no-store",
  });

  if (!transcriptionResponse.ok) {
    return null;
  }

  const text = await transcriptionResponse.text();
  return normalizeWhitespace(text);
}

async function resolveTranscript(
  episode: EpisodeCandidate,
  openaiApiKey: string,
  enableAudioTranscription: boolean
): Promise<TranscriptPayload | null> {
  if (episode.transcriptUrl) {
    const transcript = await fetchTranscriptFromUrl(episode.transcriptUrl);
    if (transcript && transcript.split(/\s+/).length > 120) {
      return {
        text: transcript,
        method: "rss-transcript",
        transcriptUrl: episode.transcriptUrl,
      };
    }
  }

  const fromPage = await maybeFindTranscriptFromEpisodePage(episode.link);
  if (fromPage && fromPage.split(/\s+/).length > 120) {
    return {
      text: fromPage,
      method: "episode-page",
    };
  }

  if (enableAudioTranscription && episode.audioUrl) {
    const transcribed = await transcribeAudioEpisode(episode.audioUrl, openaiApiKey);
    if (transcribed && transcribed.split(/\s+/).length > 120) {
      return {
        text: transcribed,
        method: "audio-transcription",
        note: "Generated with OpenAI transcription because no source transcript was found.",
      };
    }
  }

  return null;
}

export async function runTranscriptPipeline(
  input: PipelineInput,
  deps: {
    hasChunkBySourceKey: (personaId: string, sourceKey: string) => Promise<boolean>;
    insertChunk: (input: {
      personaId: string;
      content: string;
      embedding: number[];
      metadata: Record<string, unknown>;
    }) => Promise<void>;
  }
): Promise<PipelineResult> {
  const maxPodcasts = Math.max(1, input.maxPodcasts || 3);
  const maxEpisodes = Math.max(1, input.maxEpisodes || 10);
  const enableAudioTranscription = input.enableAudioTranscription ?? true;
  const podcastMap = new Map<string, PodcastCandidate>();

  if (input.appleEpisodeUrl) {
    const episodeId = parseAppleEpisodeId(input.appleEpisodeUrl);
    if (episodeId) {
      const found = await lookupPodcastFromAppleEpisode(episodeId);
      for (const podcast of found) {
        podcastMap.set(podcast.feedUrl, podcast);
      }
    }
  }

  if (input.query?.trim()) {
    const found = await searchPodcastsByQuery(input.query.trim(), maxPodcasts);
    for (const podcast of found) {
      podcastMap.set(podcast.feedUrl, podcast);
    }
  }

  const selectedPodcasts = [...podcastMap.values()].slice(0, maxPodcasts);
  const results: PipelineEpisodeResult[] = [];
  let episodesConsidered = 0;
  let episodesIngested = 0;
  let chunksInserted = 0;

  if (selectedPodcasts.length === 0) {
    return {
      podcastsConsidered: 0,
      episodesConsidered: 0,
      episodesIngested: 0,
      chunksInserted: 0,
      results: [
        {
          podcast: "",
          episodeTitle: "",
          status: "failed",
          note: "No podcast feeds found for the provided input.",
        },
      ],
    };
  }

  const episodesPerPodcast = Math.max(1, Math.ceil(maxEpisodes / selectedPodcasts.length));

  for (const podcast of selectedPodcasts) {
    let episodes: EpisodeCandidate[] = [];
    try {
      episodes = await fetchFeedEpisodes(podcast.feedUrl);
    } catch (error) {
      results.push({
        podcast: podcast.collectionName,
        episodeTitle: "",
        status: "failed",
        note: error instanceof Error ? error.message : "Failed to fetch podcast feed",
      });
      continue;
    }

    for (const episode of episodes.slice(0, episodesPerPodcast)) {
      if (episodesConsidered >= maxEpisodes) break;
      episodesConsidered++;

      const sourceKey = `${podcast.feedUrl}::${episode.guid || episode.link || episode.title}`;
      const alreadyExists = await deps.hasChunkBySourceKey(input.personaId, sourceKey);
      if (alreadyExists) {
        results.push({
          podcast: podcast.collectionName,
          episodeTitle: episode.title,
          status: "skipped",
          note: "Already ingested for this persona.",
          sourceUrl: episode.link,
        });
        continue;
      }

      const transcript = await resolveTranscript(
        episode,
        input.openaiApiKey,
        enableAudioTranscription
      );

      if (!transcript) {
        results.push({
          podcast: podcast.collectionName,
          episodeTitle: episode.title,
          status: "failed",
          note: "No transcript found and transcription could not be generated.",
          sourceUrl: episode.link,
        });
        continue;
      }

      const chunks = chunkText(transcript.text);
      let insertedForEpisode = 0;

      for (const chunk of chunks) {
        const embedding = await createEmbedding("openai", input.openaiApiKey, chunk);

        try {
          await deps.insertChunk({
            personaId: input.personaId,
            content: chunk,
            embedding,
            metadata: {
              source_type: "podcast_episode",
              source_key: sourceKey,
              source_name: `${podcast.collectionName} - ${episode.title}`,
              podcast_name: podcast.collectionName,
              podcast_feed_url: podcast.feedUrl,
              episode_title: episode.title,
              episode_url: episode.link || null,
              episode_guid: episode.guid || null,
              published_at: episode.pubDate || null,
              description: episode.description || null,
              transcript_url: transcript.transcriptUrl || null,
              transcript_method: transcript.method,
              ingest_note: transcript.note || null,
              ingested_at: new Date().toISOString(),
            },
          });
          insertedForEpisode++;
          chunksInserted++;
        } catch {
          // Continue with remaining chunks.
        }
      }

      if (insertedForEpisode > 0) {
        episodesIngested++;
        results.push({
          podcast: podcast.collectionName,
          episodeTitle: episode.title,
          status: "ingested",
          method: transcript.method,
          chunksInserted: insertedForEpisode,
          sourceUrl: episode.link,
        });
      } else {
        results.push({
          podcast: podcast.collectionName,
          episodeTitle: episode.title,
          status: "failed",
          note: "Transcript was found but no chunks were inserted.",
          sourceUrl: episode.link,
        });
      }
    }
  }

  return {
    podcastsConsidered: selectedPodcasts.length,
    episodesConsidered,
    episodesIngested,
    chunksInserted,
    results,
  };
}
