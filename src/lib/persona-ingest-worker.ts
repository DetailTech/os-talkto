import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { createEmbedding, chunkText } from "@/lib/rag";
import { decrypt } from "@/lib/encryption";
import { getLanguageModel } from "@/lib/ai-providers";
import { safeFetch } from "@/lib/security/safe-fetch";
import {
  getOraclePersonaById,
  getOraclePersonaIngestJobById,
  getOracleUserSettings,
  hasOracleDocumentChunkBySourceKey,
  insertOracleDocumentChunk,
  listOraclePersonaIngestJobs,
  updateOraclePersonaIngestJob,
  updateOraclePersonaMetadata,
} from "@/lib/db/oracle";
import type { AIProvider, PersonaIngestJob, PersonaSourceCandidate } from "@/types/database";

const runningJobs = new Set<string>();
const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const GUTENDEX_URL = "https://gutendex.com/books";

type SourceFlags = PersonaIngestJob["sources"];

interface TextSourceDocument {
  sourceKey: string;
  sourceType: PersonaSourceCandidate["type"];
  title: string;
  content: string;
  url?: string;
}

interface WebProfileSource {
  url: string;
  title: string;
  snippet: string;
  imageUrl?: string;
}

function estimateEnglishConfidence(text: string): number {
  const sample = text.slice(0, 5000).toLowerCase();
  if (!sample.trim()) return 1;

  const asciiChars = (sample.match(/[a-z]/g) || []).length;
  const latinChars = (sample.match(/[a-z\u00c0-\u024f]/g) || []).length;
  const words = sample.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  const englishStopwords = new Set([
    "the", "and", "to", "of", "in", "for", "that", "with", "is", "on", "it", "as", "are",
    "be", "this", "from", "or", "by", "an", "at", "you", "we", "not", "have", "was",
  ]);
  const stopwordHits = words.reduce((count, word) => {
    const normalized = word.replace(/[^a-z]/g, "");
    return count + (englishStopwords.has(normalized) ? 1 : 0);
  }, 0);

  const asciiRatio = asciiChars / Math.max(1, sample.length);
  const latinRatio = latinChars / Math.max(1, sample.length);
  const stopwordRatio = stopwordHits / Math.max(1, words.length);

  return asciiRatio * 0.45 + latinRatio * 0.3 + stopwordRatio * 0.25;
}

function shouldTranslateToEnglish(text: string): boolean {
  return estimateEnglishConfidence(text) < 0.18;
}

async function translateChunkToEnglish(input: {
  text: string;
  provider: AIProvider;
  model: string;
  apiKey: string;
}): Promise<string> {
  const translationModel = getLanguageModel(input.provider, input.model, input.apiKey);
  const response = await generateText({
    model: translationModel,
    prompt: `Translate the following content to natural English. Preserve meaning, names, and factual detail. Return only the translated text with no commentary:\n\n${input.text}`,
    maxOutputTokens: 1400,
  });
  const translated = normalizeWhitespace(response.text || "");
  return translated || input.text;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  let hits = 0;
  for (const token of a) {
    if (bSet.has(token)) hits += 1;
  }
  return hits / Math.max(a.length, b.length);
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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await safeFetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Fetch failed (${response.status}) for ${url}`);
  return response.json() as Promise<T>;
}

function scoreBookMatch(queryTokens: string[], title: string, authors: string[]): number {
  const titleScore = overlapScore(queryTokens, tokenize(title));
  const authorScore = authors.reduce((best, author) => {
    return Math.max(best, overlapScore(queryTokens, tokenize(author)));
  }, 0);
  return authorScore * 60 + titleScore * 20;
}

async function fetchBookTextFromUrl(url: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await safeFetch(url, { cache: "no-store" });
  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") || "";
  if (
    /(application\/pdf|application\/zip|audio\/|video\/|application\/octet-stream)/i.test(
      contentType
    )
  ) {
    return null;
  }

  const body = await response.text();
  if (!body.trim()) return null;
  const normalized = /<html|<body/i.test(body) ? stripHtml(body) : normalizeWhitespace(body);
  return normalized.split(/\s+/).length >= 180 ? normalized : null;
}

async function fetchInternetArchiveBookText(identifier: string): Promise<string | null> {
  const metadata = await fetchJson<{
    files?: Array<{ name?: string; format?: string }>;
  }>(`https://archive.org/metadata/${encodeURIComponent(identifier)}`).catch(() => null);
  if (!metadata?.files || metadata.files.length === 0) return null;

  const scored = metadata.files
    .map((file) => {
      const name = (file.name || "").trim();
      const format = (file.format || "").trim().toLowerCase();
      if (!name) return null;
      if (/\.(jpg|jpeg|png|gif|svg|mp3|m4a|wav|mp4|avi|zip)$/i.test(name)) return null;

      let score = -1;
      if (/_djvu\.txt$/i.test(name)) score = 120;
      else if (/\.txt$/i.test(name)) score = 110;
      else if (format.includes("text")) score = 80;
      else if (/\.html?$/i.test(name)) score = 60;
      if (score < 0) return null;
      return { name, score };
    })
    .filter((item): item is { name: string; score: number } => !!item)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  for (const file of scored) {
    const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(file.name)}`;
    const text = await fetchBookTextFromUrl(url);
    if (text && text.split(/\s+/).length >= 180) return text;
  }

  return null;
}

function parseTranscriptSectionFromHtml(html: string): string | null {
  const transcriptContainerMatch = html.match(
    /<(section|div|article)[^>]+(?:id|class)="[^"]*transcript[^"]*"[^>]*>([\s\S]{500,300000})<\/\1>/i
  );
  if (transcriptContainerMatch?.[2]) {
    const text = normalizeWhitespace(decodeHtmlEntities(stripHtml(transcriptContainerMatch[2])));
    if (text.split(/\s+/).length > 120) return text;
  }

  const sectionMatch = html.match(
    /<h[1-4][^>]*>\s*transcript\s*<\/h[1-4]>([\s\S]{500,250000})/i
  );
  if (!sectionMatch?.[1]) return null;
  const text = normalizeWhitespace(decodeHtmlEntities(stripHtml(sectionMatch[1])));
  return text.split(/\s+/).length > 120 ? text : null;
}

function decodeEscapedUrl(value: string): string {
  return decodeHtmlEntities(value.replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
}

function normalizeSearchResultUrl(rawUrl: string): string {
  const decoded = decodeHtmlEntities(rawUrl);
  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("duckduckgo.com")) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return decodeURIComponent(uddg);
    }
  } catch {
    // ignore parse failures and return raw decoded url
  }
  return decoded;
}

function extractLinksFromHtml(baseUrl: string, html: string): string[] {
  const links = new Set<string>();

  const hrefRegex = /<a[^>]+href="([^"]+)"/gi;
  let hrefMatch: RegExpExecArray | null = hrefRegex.exec(html);
  while (hrefMatch) {
    try {
      const absolute = new URL(decodeEscapedUrl(hrefMatch[1]), baseUrl).toString();
      links.add(absolute);
    } catch {
      // ignore invalid urls
    }
    hrefMatch = hrefRegex.exec(html);
  }

  const jsonUrlRegex = /"(?:transcript|url|href)"\s*:\s*"([^"]+)"/gi;
  let jsonMatch: RegExpExecArray | null = jsonUrlRegex.exec(html);
  while (jsonMatch) {
    try {
      const absolute = new URL(decodeEscapedUrl(jsonMatch[1]), baseUrl).toString();
      links.add(absolute);
    } catch {
      // ignore invalid urls
    }
    jsonMatch = jsonUrlRegex.exec(html);
  }

  return [...links];
}

function isLikelyTranscriptUrl(url: string): boolean {
  return /(transcript|captions?|subtitles?|show-notes|episode|podcast)/i.test(url);
}

function isCrawlableLink(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  return !/\.(jpg|jpeg|png|gif|svg|webp|mp3|m4a|wav|mp4|mov|avi|pdf|zip)(\?|$)/i.test(url);
}

async function crawlForTranscript(
  seedUrl: string,
  options?: { maxPages?: number; maxDepth?: number }
): Promise<string | null> {
  if (!isCrawlableLink(seedUrl)) return null;
  const maxPages = options?.maxPages ?? 24;
  const maxDepth = options?.maxDepth ?? 2;
  const seedHost = new URL(seedUrl).hostname.replace(/^www\./, "");

  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
  const seen = new Set<string>();
  let visitedPages = 0;

  while (queue.length > 0 && visitedPages < maxPages) {
    const next = queue.shift();
    if (!next) break;
    if (seen.has(next.url)) continue;
    seen.add(next.url);
    visitedPages++;

    const pageText = await fetchTranscriptFromUrl(next.url);
    if (pageText && pageText.split(/\s+/).length > 120) return pageText;

    if (next.depth >= maxDepth) continue;

    const response = await safeFetch(next.url, { cache: "no-store" });
    if (!response.ok) continue;
    const html = await response.text();
    const links = extractLinksFromHtml(next.url, html);
    for (const link of links) {
      if (seen.has(link) || !isCrawlableLink(link)) continue;
      const linkHost = (() => {
        try {
          return new URL(link).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();

      const sameHost = linkHost === seedHost;
      const likely = isLikelyTranscriptUrl(link);

      // Prefer same-site traversal, but allow transcript-like cross-site hops.
      if (sameHost || likely) {
        queue.push({ url: link, depth: next.depth + 1 });
      }
    }
  }

  return null;
}

async function maybeFindTranscriptFromEpisodePage(url?: string): Promise<string | null> {
  if (!url) return null;
  const response = await safeFetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const html = await response.text();

  const transcriptLink = html.match(
    /<a[^>]+href="([^"]+)"[^>]*>\s*(?:full\s+)?transcript[\s\S]*?<\/a>/i
  );
  if (transcriptLink?.[1]) {
    try {
      const absoluteUrl = new URL(transcriptLink[1], url).toString();
      const text = await fetchTranscriptFromUrl(absoluteUrl);
      if (text && text.split(/\s+/).length > 120) return text;
    } catch {
      // continue to section parsing
    }
  }

  const linkedPages = extractLinksFromHtml(url, html).filter((candidate) =>
    /(transcript|caption|show-notes|subtitles)/i.test(candidate)
  );
  for (const link of linkedPages.slice(0, 20)) {
    const text = await crawlForTranscript(link, { maxPages: 16, maxDepth: 1 });
    if (text && text.split(/\s+/).length > 120) return text;
  }

  const deep = await crawlForTranscript(url, { maxPages: 20, maxDepth: 2 });
  if (deep && deep.split(/\s+/).length > 120) return deep;

  return parseTranscriptSectionFromHtml(html);
}

async function searchTranscriptUrls(query: string, limit: number = 6): Promise<string[]> {
  const response = await safeFetch(
    `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { cache: "no-store" }
  );
  if (!response.ok) return [];
  const html = await response.text();
  const urls: string[] = [];
  const seen = new Set<string>();
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/gi;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const url = normalizeSearchResultUrl(match[1]);
    if (!seen.has(url) && /^https?:\/\//i.test(url)) {
      seen.add(url);
      urls.push(url);
    }
    if (urls.length >= limit) break;
    match = regex.exec(html);
  }
  return urls;
}

async function findTranscriptViaWebSearch(query: string): Promise<string | null> {
  const urls = await searchTranscriptUrls(query, 8);
  for (const url of urls) {
    const fromPage = await maybeFindTranscriptFromEpisodePage(url);
    if (fromPage && fromPage.split(/\s+/).length > 120) return fromPage;

    const fromRaw = await fetchTranscriptFromUrl(url);
    if (fromRaw && fromRaw.split(/\s+/).length > 220) return fromRaw;
  }
  return null;
}

async function fetchTranscriptFromUrl(url: string): Promise<string | null> {
  const response = await safeFetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const text = await response.text();
  if (!text.trim()) return null;

  if (text.includes("WEBVTT")) {
    return normalizeWhitespace(
      text
        .replace(/^WEBVTT.*$/gim, " ")
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}.*/g, " ")
    );
  }

  if (/<html|<body/i.test(text)) {
    const transcriptSection = parseTranscriptSectionFromHtml(text);
    if (transcriptSection) return transcriptSection;
    return stripHtml(text);
  }

  return normalizeWhitespace(text);
}

function parseFeedItems(feedXml: string): Array<{
  title: string;
  link?: string;
  guid?: string;
  transcriptUrl?: string;
  description?: string;
  contentEncoded?: string;
}> {
  const items = feedXml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => ({
    title: parseTag(item, "title") || "Untitled episode",
    link: parseTag(item, "link"),
    guid: parseTag(item, "guid"),
    transcriptUrl: parseTagAttribute(item, "podcast:transcript", "url"),
    description: parseTag(item, "description"),
    contentEncoded: parseTag(item, "content:encoded"),
  }));
}

function extractYouTubeCandidates(html: string): Array<{ videoId: string; title: string; channel?: string }> {
  const candidates: Array<{ videoId: string; title: string; channel?: string }> = [];
  const seen = new Set<string>();
  const regex =
    /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"([^"]+)"\}\][\s\S]*?(?:"ownerText":\{"runs":\[\{"text":"([^"]+)")?/g;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const videoId = match[1];
    if (seen.has(videoId)) {
      match = regex.exec(html);
      continue;
    }
    seen.add(videoId);
    const title = decodeEscapedUrl(match[2] || "").trim();
    const channel = decodeEscapedUrl(match[3] || "").trim();
    candidates.push({
      videoId,
      title: title || `YouTube video ${videoId}`,
      channel: channel || undefined,
    });
    if (candidates.length >= 20) break;
    match = regex.exec(html);
  }
  return candidates;
}

function extractYouTubeIds(html: string): string[] {
  const ids = new Set<string>();
  const regex = /"videoId":"([A-Za-z0-9_-]{11})"/g;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    ids.add(match[1]);
    if (ids.size >= 30) break;
    match = regex.exec(html);
  }
  return [...ids];
}

function parseDuckDuckGoResults(html: string): PersonaSourceCandidate[] {
  const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const results: PersonaSourceCandidate[] = [];
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const url = decodeHtmlEntities(match[1]);
    const title = stripHtml(decodeHtmlEntities(match[2]));
    if (url && title) {
      results.push({
        id: `blog:${url}`,
        type: "blog",
        title,
        url,
      });
    }
    if (results.length >= 10) break;
    match = regex.exec(html);
  }
  return results;
}

function parseMetaContent(html: string, key: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : "";
}

async function fetchWebProfileSource(url: string): Promise<WebProfileSource | null> {
  if (!isCrawlableLink(url)) return null;
  const response = await safeFetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const html = await response.text();
  const title =
    parseMetaContent(html, "og:title") ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      : "") ||
    url;
  const description =
    parseMetaContent(html, "og:description") ||
    parseMetaContent(html, "description") ||
    stripHtml(html).slice(0, 450);
  const imageUrl = parseMetaContent(html, "og:image");
  return {
    url,
    title: normalizeWhitespace(title).slice(0, 240),
    snippet: normalizeWhitespace(description).slice(0, 600),
    imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
  };
}

async function collectWebProfileSources(query: string): Promise<WebProfileSource[]> {
  const searches = [
    `${query} official website`,
    `${query} podcast`,
    `${query} interviews`,
    `${query} books`,
  ];
  const urls: string[] = [];
  for (const term of searches) {
    const results = await searchTranscriptUrls(term, 8);
    urls.push(...results);
  }
  const unique = [...new Set(urls)].slice(0, 24);
  const output: WebProfileSource[] = [];
  for (const url of unique) {
    const source = await fetchWebProfileSource(url);
    if (source) output.push(source);
    if (output.length >= 12) break;
  }
  return output;
}

async function findWikipediaImageForName(name: string): Promise<string | null> {
  const response = await safeFetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`,
    { cache: "no-store", headers: { Accept: "application/json" } }
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    thumbnail?: { source?: string };
    originalimage?: { source?: string };
  };
  const url = payload.originalimage?.source || payload.thumbnail?.source || "";
  return /^https?:\/\//i.test(url) ? url : null;
}

async function pickBestImageCandidate(query: string): Promise<string | undefined> {
  const wiki = await findWikipediaImageForName(query).catch(() => null);
  if (wiki) return wiki;
  const sources = await collectWebProfileSources(query).catch(() => []);
  const image = sources
    .map((source) => source.imageUrl)
    .filter((v): v is string => !!v)
    .find((url) => !/logo|icon|favicon|sprite|banner|podcast-cover|book-cover/i.test(url));
  return image;
}

export function defaultSources(): SourceFlags {
  return {
    books: true,
    podcasts: true,
    youtube: true,
    blogs: true,
    interviews: true,
    social: true,
  };
}

export function slugifyPersonaName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || randomUUID().slice(0, 8);
}

export async function discoverPersonaSources(
  query: string,
  sources: SourceFlags
): Promise<PersonaSourceCandidate[]> {
  const candidates: PersonaSourceCandidate[] = [];
  const queryTokens = tokenize(query);

  if (sources.books) {
    const [openLibrary, gutenberg, archive] = await Promise.all([
      (async () => {
        const [payload, authorPayload] = await Promise.all([
          fetchJson<{
            docs?: Array<{
              key?: string;
              title?: string;
              first_publish_year?: number;
              author_name?: string[];
              first_sentence?: string | string[];
            }>;
          }>(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=40`),
          fetchJson<{
            docs?: Array<{
              key?: string;
              title?: string;
            }>;
          }>(`https://openlibrary.org/search.json?author=${encodeURIComponent(query)}&limit=40`),
        ]);

        const authorKeys = new Set(
          (authorPayload.docs || [])
            .map((doc) => doc.key || doc.title || "")
            .filter(Boolean)
        );

        return ((payload.docs || []).slice(0, 80))
          .map((doc) => {
            const authors = doc.author_name || [];
            const byAuthor = authorKeys.has(doc.key || "") || authorKeys.has(doc.title || "");
            const score = scoreBookMatch(queryTokens, doc.title || "", authors) + (byAuthor ? 100 : 0);
            return { doc, score, byAuthor };
          })
          .filter((entry) => entry.score >= 20 || entry.byAuthor)
          .sort((a, b) => b.score - a.score)
          .slice(0, 16)
          .map((entry) => entry.doc);
      })().catch(() => []),
      (async () => {
        const payload = await fetchJson<{
          results?: Array<{
            id?: number;
            title?: string;
            authors?: Array<{ name?: string }>;
            summaries?: string[];
            formats?: Record<string, string>;
          }>;
        }>(`${GUTENDEX_URL}?search=${encodeURIComponent(query)}`);
        return (payload.results || [])
          .map((book) => {
            const authors = (book.authors || [])
              .map((author) => (author.name || "").trim())
              .filter(Boolean);
            const score = scoreBookMatch(queryTokens, book.title || "", authors);
            return { book, score };
          })
          .filter((entry) => entry.score >= 16)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
          .map((entry) => entry.book);
      })().catch(() => []),
      (async () => {
        const q = `(${query}) AND mediatype:texts`;
        const payload = await fetchJson<{
          response?: {
            docs?: Array<{
              identifier?: string;
              title?: string;
              creator?: string | string[];
              description?: string | string[];
              year?: number;
            }>;
          };
        }>(
          `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=description&fl[]=year&rows=30&page=1&output=json`
        );
        return (payload.response?.docs || [])
          .map((doc) => {
            const creators = Array.isArray(doc.creator)
              ? doc.creator
              : typeof doc.creator === "string"
                ? [doc.creator]
                : [];
            const score = scoreBookMatch(queryTokens, doc.title || "", creators);
            return { doc, score };
          })
          .filter((entry) => entry.score >= 16)
          .sort((a, b) => b.score - a.score)
          .slice(0, 12)
          .map((entry) => entry.doc);
      })().catch(() => []),
    ]);

    for (const doc of openLibrary) {
      if (!doc.title) continue;
      candidates.push({
        id: `book:openlibrary:${doc.key || doc.title}`,
        type: "book",
        title: doc.title,
        subtitle: doc.author_name?.slice(0, 2).join(", "),
        url: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
        metadata: {
          provider: "openlibrary",
          key: doc.key || "",
          year: doc.first_publish_year || null,
          authors: doc.author_name || [],
          sentence:
            typeof doc.first_sentence === "string"
              ? doc.first_sentence
              : Array.isArray(doc.first_sentence)
                ? doc.first_sentence[0]
                : "",
        },
      });
    }

    for (const book of gutenberg) {
      if (!book.title) continue;
      const authors = (book.authors || [])
        .map((author) => (author.name || "").trim())
        .filter(Boolean);
      const formats = book.formats || {};
      const textUrl =
        formats["text/plain; charset=utf-8"] ||
        formats["text/plain"] ||
        formats["text/plain; charset=us-ascii"] ||
        formats["text/html; charset=utf-8"] ||
        formats["text/html"];
      candidates.push({
        id: `book:gutenberg:${book.id || book.title}`,
        type: "book",
        title: book.title,
        subtitle: authors.slice(0, 2).join(", "),
        url: book.id ? `https://www.gutenberg.org/ebooks/${book.id}` : undefined,
        metadata: {
          provider: "gutenberg",
          gutenbergId: book.id || null,
          authors,
          sentence: (book.summaries || []).find(Boolean) || "",
          textUrl: textUrl || "",
        },
      });
    }

    for (const doc of archive) {
      if (!doc.title || !doc.identifier) continue;
      const creators = Array.isArray(doc.creator)
        ? doc.creator
        : typeof doc.creator === "string"
          ? [doc.creator]
          : [];
      const description = Array.isArray(doc.description)
        ? doc.description.find(Boolean)
        : doc.description || "";
      candidates.push({
        id: `book:archive:${doc.identifier}`,
        type: "book",
        title: doc.title,
        subtitle: creators.slice(0, 2).join(", "),
        url: `https://archive.org/details/${doc.identifier}`,
        metadata: {
          provider: "archive",
          iaIdentifier: doc.identifier,
          year: typeof doc.year === "number" ? doc.year : null,
          authors: creators,
          sentence: typeof description === "string" ? normalizeWhitespace(stripHtml(description)) : "",
        },
      });
    }
  }

  if (sources.podcasts) {
    const payload = await fetchJson<{
      results?: Array<{ collectionName?: string; feedUrl?: string; artistName?: string }>;
    }>(`${ITUNES_SEARCH_URL}?term=${encodeURIComponent(query)}&media=podcast&limit=10`);
    for (const item of payload.results || []) {
      if (!item.collectionName || !item.feedUrl) continue;
      candidates.push({
        id: `podcast:${item.feedUrl}`,
        type: "podcast",
        title: item.collectionName,
        subtitle: item.artistName,
        url: item.feedUrl,
        metadata: {
          host: item.artistName || "",
        },
      });
    }
  }

  if (sources.youtube) {
    const response = await safeFetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      { cache: "no-store" }
    );
    if (response.ok) {
      const html = await response.text();
      const parsed = extractYouTubeCandidates(html);
      const items =
        parsed.length > 0
          ? parsed
          : extractYouTubeIds(html).map((videoId) => ({
              videoId,
              title: `YouTube video ${videoId}`,
              channel: undefined,
            }));
      for (const item of items.slice(0, 12)) {
        candidates.push({
          id: `youtube:${item.videoId}`,
          type: "youtube",
          title: item.title,
          subtitle: item.channel,
          url: `https://www.youtube.com/watch?v=${item.videoId}`,
          metadata: { videoId: item.videoId, channel: item.channel || "" },
        });
      }
    }
  }

  if (sources.blogs) {
    const response = await safeFetch(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(`${query} blog`)}`,
      { cache: "no-store" }
    );
    if (response.ok) {
      const html = await response.text();
      candidates.push(...parseDuckDuckGoResults(html));
    }
  }

  if (sources.interviews) {
    const directInterviewSeeds = [
      `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} joe rogan interview`)}`,
      `https://www.youtube.com/results?search_query=${encodeURIComponent(`${query} interview`)}`,
    ];
    for (const url of directInterviewSeeds) {
      candidates.push({
        id: `interview:${url}`,
        type: "interview",
        title: `Interview search: ${query}`,
        url,
      });
    }

    const queries = [
      `${query} interview transcript`,
      `${query} 60 minutes interview transcript`,
      `${query} joe rogan interview transcript`,
      `${query} podcast interview transcript`,
      `${query} interview joe rogan`,
      `${query} interview youtube`,
    ];
    for (const q of queries) {
      const urls = await searchTranscriptUrls(q, 10);
      for (const url of urls) {
        candidates.push({
          id: `interview:${url}`,
          type: "interview",
          title: `Interview source: ${url.replace(/^https?:\/\//, "").slice(0, 120)}`,
          url,
        });
      }
    }
  }

  if (sources.social) {
    const normalizedQuery = query.trim();
    const handleGuess = normalizedQuery.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (handleGuess) {
      candidates.push({
        id: `social:https://x.com/${handleGuess}`,
        type: "social",
        title: `X profile: @${handleGuess}`,
        url: `https://x.com/${handleGuess}`,
      });
    }

    const urls = await searchTranscriptUrls(`${query} x.com twitter profile linkedin`, 20);
    for (const url of urls) {
      if (!/(x\.com|twitter\.com|linkedin\.com|substack\.com|medium\.com|instagram\.com)/i.test(url)) {
        continue;
      }
      const host = (() => {
        try {
          return new URL(url).hostname.replace(/^www\./, "");
        } catch {
          return "";
        }
      })();
      candidates.push({
        id: `social:${url}`,
        type: "social",
        title: `Social source (${host || "web"}): ${url.replace(/^https?:\/\//, "").slice(0, 120)}`,
        url,
      });
    }
  }

  // Ensure every selectable source has a unique id.
  const unique = new Map<string, PersonaSourceCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.id)) {
      unique.set(candidate.id, candidate);
    }
  }
  return [...unique.values()];
}

export function inferPersonaFromCandidates(
  query: string,
  candidates: PersonaSourceCandidate[]
): { name: string; bio: string } {
  const score = new Map<string, number>();

  for (const candidate of candidates) {
    const host =
      typeof candidate.metadata?.host === "string" ? candidate.metadata.host.trim() : "";
    if (host) score.set(host, (score.get(host) || 0) + 3);

    const authors = Array.isArray(candidate.metadata?.authors)
      ? candidate.metadata?.authors
      : [];
    for (const rawAuthor of authors) {
      const author = typeof rawAuthor === "string" ? rawAuthor.trim() : "";
      if (!author) continue;
      score.set(author, (score.get(author) || 0) + 2);
    }
  }

  let inferredName = query.trim();
  let inferredScore = 0;
  for (const [name, value] of score.entries()) {
    if (value > inferredScore) {
      inferredName = name;
      inferredScore = value;
    }
  }

  const sourceTypes = new Set(candidates.map((c) => c.type));
  const sourceSummary = [...sourceTypes]
    .map((type) => type.toUpperCase())
    .join(", ");
  const bio =
    inferredName !== query.trim()
      ? `${inferredName} is the primary host/author inferred from selected sources for "${query}". RAG is built from discovered ${sourceSummary || "TEXT"} content and transcripts.`
      : `Auto-created persona for ${query}. RAG is built from discovered ${sourceSummary || "TEXT"} content and transcripts.`;

  return { name: inferredName, bio };
}

interface EnrichedPersonaProfile {
  name?: string;
  bio?: string;
  expertise?: string[];
  books?: Array<{ title: string; year?: number; description?: string }>;
  media?: Array<{ title: string; url?: string; platform?: string }>;
  interviews?: Array<{ title: string; url?: string; platform?: string }>;
  conversationStarters?: string[];
  imageUrl?: string;
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

function toMediaArray(value: unknown): Array<{ title: string; url?: string; platform?: string }> {
  if (!Array.isArray(value)) return [];
  const output: Array<{ title: string; url?: string; platform?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) continue;
    const url = typeof record.url === "string" ? record.url.trim() : undefined;
    const platform = typeof record.platform === "string" ? record.platform.trim() : undefined;
    output.push({ title, url, platform });
  }
  return output;
}

function toBooksArray(value: unknown): Array<{ title: string; year?: number; description?: string }> {
  if (!Array.isArray(value)) return [];
  const output: Array<{ title: string; year?: number; description?: string }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) continue;
    const year = typeof record.year === "number" ? record.year : undefined;
    const description = typeof record.description === "string" ? record.description.trim() : undefined;
    output.push({ title, year, description });
  }
  return output;
}

async function enrichPersonaProfileWithAI(input: {
  query: string;
  inferredName: string;
  provider: AIProvider;
  model: string;
  apiKey: string;
  selectedCandidates: PersonaSourceCandidate[];
}): Promise<EnrichedPersonaProfile | null> {
  const sources = await collectWebProfileSources(input.query);
  const imageCandidates = sources
    .map((s) => s.imageUrl)
    .filter((v): v is string => !!v)
    .slice(0, 20);

  const model = getLanguageModel(input.provider, input.model, input.apiKey);
  const prompt = `Create a factual persona profile JSON for "${input.query}".

Inferred person name: "${input.inferredName}".

Selected source candidates:
${JSON.stringify(input.selectedCandidates, null, 2)}

Web sources:
${JSON.stringify(sources, null, 2)}

Available profile image candidates:
${JSON.stringify(imageCandidates, null, 2)}

Return strict JSON only:
{
  "name": "person name only (not podcast title)",
  "bio": "2-4 sentence summary",
  "expertise": ["top","5","expertise","tags","max"],
  "books": [{"title":"", "year": 2020, "description":"short"}],
  "media": [{"title":"", "url":"https://...", "platform":"Podcast/YouTube/Website"}],
  "interviews": [{"title":"", "url":"https://...", "platform":"Interview/Article"}],
  "conversationStarters": ["3-5 specific questions based on profile"],
  "imageUrl": "https://..."
}

Rules:
- Keep books ONLY likely authored by this person.
- Media/interviews must include URLs when possible.
- Use only plausible public facts from provided sources.
- expertise max 5 items.
- conversationStarters should reference expertise/books/media concretely.
- imageUrl must be one of the provided image candidates when possible, otherwise empty string.
- Never return markdown or commentary; return JSON object only.`;

  const completion = await generateText({
    model,
    prompt,
    maxOutputTokens: 1800,
  });

  const parsed = parseJsonObjectFromText(completion.text);
  if (!parsed) return null;

  const media = toMediaArray(parsed.media);
  const interviews = toMediaArray(parsed.interviews);
  const mergedMedia = [...media, ...interviews]
    .filter((item, index, array) => array.findIndex((x) => x.title === item.title && x.url === item.url) === index)
    .slice(0, 16);

  const imageUrl = typeof parsed.imageUrl === "string" && /^https?:\/\//i.test(parsed.imageUrl)
    ? parsed.imageUrl
    : undefined;

  return {
    name: typeof parsed.name === "string" ? parsed.name.trim() : undefined,
    bio: typeof parsed.bio === "string" ? parsed.bio.trim() : undefined,
    expertise: toStringArray(parsed.expertise).slice(0, 5),
    books: toBooksArray(parsed.books).slice(0, 12),
    media: mergedMedia,
    conversationStarters: toStringArray(parsed.conversationStarters).slice(0, 5),
    imageUrl,
  };
}

async function candidateToDocuments(candidate: PersonaSourceCandidate): Promise<TextSourceDocument[]> {
  if (candidate.type === "book") {
    const preferredTextUrl =
      typeof candidate.metadata?.textUrl === "string" ? candidate.metadata.textUrl : "";
    const archiveIdentifier =
      typeof candidate.metadata?.iaIdentifier === "string" ? candidate.metadata.iaIdentifier : "";
    const gutenbergId =
      typeof candidate.metadata?.gutenbergId === "number"
        ? candidate.metadata.gutenbergId
        : null;
    const authors = Array.isArray(candidate.metadata?.authors)
      ? candidate.metadata.authors.filter((a): a is string => typeof a === "string")
      : [];

    let fullText: string | null = null;
    if (preferredTextUrl) {
      fullText = await fetchBookTextFromUrl(preferredTextUrl);
    }
    if (!fullText && gutenbergId) {
      const details = await fetchJson<{
        formats?: Record<string, string>;
      }>(`${GUTENDEX_URL}/${gutenbergId}`).catch(() => null);
      const formats = details?.formats || {};
      const textUrl =
        formats["text/plain; charset=utf-8"] ||
        formats["text/plain"] ||
        formats["text/plain; charset=us-ascii"] ||
        formats["text/html; charset=utf-8"] ||
        formats["text/html"];
      if (textUrl) {
        fullText = await fetchBookTextFromUrl(textUrl);
      }
    }
    if (!fullText && archiveIdentifier) {
      fullText = await fetchInternetArchiveBookText(archiveIdentifier);
    }

    const sentence =
      typeof candidate.metadata?.sentence === "string" ? candidate.metadata.sentence : "";
    const content = normalizeWhitespace(
      [
        `Book: ${candidate.title}`,
        authors.length > 0
          ? `Authors: ${authors.slice(0, 5).join(", ")}`
          : candidate.subtitle
            ? `Authors: ${candidate.subtitle}`
            : "",
        typeof candidate.metadata?.year === "number"
          ? `First published: ${candidate.metadata.year}`
          : "",
        sentence ? `Summary: ${sentence}` : "",
        fullText ? `Full text:\n${fullText}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );

    return content.split(/\s+/).length > 25
      ? [
          {
            sourceKey: candidate.id,
            sourceType: "book",
            title: candidate.title,
            content,
            url: candidate.url,
          },
        ]
      : [];
  }

  if (candidate.type === "podcast" && candidate.url) {
    const docs: TextSourceDocument[] = [];
    const feedResponse = await safeFetch(candidate.url, { cache: "no-store" });
    if (!feedResponse.ok) return docs;
    const feedXml = await feedResponse.text();
    const episodes = parseFeedItems(feedXml).slice(0, 80);
    for (const episode of episodes) {
      let transcript: string | null = null;
      let transcriptSource: string | undefined = episode.transcriptUrl || episode.link;

      if (episode.transcriptUrl) {
        transcript = await fetchTranscriptFromUrl(episode.transcriptUrl);
      }
      if ((!transcript || transcript.split(/\s+/).length < 120) && episode.contentEncoded) {
        const links = extractLinksFromHtml(episode.link || candidate.url || "", episode.contentEncoded);
        for (const link of links) {
          if (!/(transcript|caption|show-notes|episode)/i.test(link)) continue;
          transcript = await fetchTranscriptFromUrl(link);
          if (transcript && transcript.split(/\s+/).length >= 120) {
            transcriptSource = link;
            break;
          }
        }
      }
      if ((!transcript || transcript.split(/\s+/).length < 120) && episode.description) {
        const links = extractLinksFromHtml(episode.link || candidate.url || "", episode.description);
        for (const link of links) {
          if (!/(transcript|caption|show-notes|episode)/i.test(link)) continue;
          transcript = await fetchTranscriptFromUrl(link);
          if (transcript && transcript.split(/\s+/).length >= 120) {
            transcriptSource = link;
            break;
          }
        }
      }
      if ((!transcript || transcript.split(/\s+/).length < 120) && episode.link) {
        transcript = await maybeFindTranscriptFromEpisodePage(episode.link);
        transcriptSource = episode.link;
      }
      if (!transcript || transcript.split(/\s+/).length < 120) {
        transcript = await crawlForTranscript(episode.link || candidate.url, {
          maxPages: 28,
          maxDepth: 2,
        });
      }
      if (!transcript || transcript.split(/\s+/).length < 120) {
        transcript = await findTranscriptViaWebSearch(
          `${candidate.title} ${episode.title} transcript`
        );
        transcriptSource = transcriptSource || episode.link;
      }
      if (!transcript || transcript.split(/\s+/).length < 120) {
        try {
          const host = new URL(candidate.url).hostname;
          transcript = await findTranscriptViaWebSearch(
            `${candidate.title} ${episode.title} transcript site:${host}`
          );
        } catch {
          // ignore invalid host extraction
        }
      }

      if (!transcript || transcript.split(/\s+/).length < 120) continue;
      const key = episode.guid || episode.link || `${candidate.id}:${episode.title}`;
      docs.push({
        sourceKey: `podcast:${key}`,
        sourceType: "podcast",
        title: `${candidate.title} - ${episode.title}`,
        content: transcript,
        url: transcriptSource,
      });
      if (docs.length >= 120) break;
    }
    return docs;
  }

  if (candidate.type === "youtube") {
    const videoId =
      typeof candidate.metadata?.videoId === "string"
        ? candidate.metadata.videoId
        : candidate.id.replace(/^youtube:/, "");
    if (!videoId) return [];

    const listUrl = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
    const listResponse = await safeFetch(listUrl, { cache: "no-store" });
    let content = "";
    if (listResponse.ok) {
      const listXml = await listResponse.text();
      const langMatch = listXml.match(/lang_code="([^"]+)"/i);
      if (langMatch?.[1]) {
        const transcriptUrl =
          `https://video.google.com/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(langMatch[1])}`;
        const transcriptResponse = await safeFetch(transcriptUrl, { cache: "no-store" });
        if (transcriptResponse.ok) {
          const transcriptXml = await transcriptResponse.text();
          const lines = [...transcriptXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
            decodeHtmlEntities(m[1])
          );
          content = normalizeWhitespace(lines.join(" "));
        }
      }
    }

    if (content.split(/\s+/).length < 120) {
      const fallback = await findTranscriptViaWebSearch(`${candidate.title} transcript`);
      content = fallback || "";
    }
    if (content.split(/\s+/).length < 120) return [];

    return [
      {
        sourceKey: `youtube:${videoId}`,
        sourceType: "youtube",
        title: candidate.title,
        content,
        url: candidate.url,
      },
    ];
  }

  if (candidate.type === "blog" && candidate.url) {
    const response = await safeFetch(candidate.url, { cache: "no-store" });
    if (!response.ok) return [];
    const html = await response.text();
    const content = stripHtml(html);
    if (content.split(/\s+/).length < 150) return [];
    return [
      {
        sourceKey: candidate.id,
        sourceType: "blog",
        title: candidate.title,
        content,
        url: candidate.url,
      },
    ];
  }

  if ((candidate.type === "interview" || candidate.type === "social") && candidate.url) {
    const deep = await crawlForTranscript(candidate.url, { maxPages: 20, maxDepth: 2 });
    const content = deep || (await fetchTranscriptFromUrl(candidate.url)) || "";
    if (content.split(/\s+/).length < 120) return [];
    return [
      {
        sourceKey: candidate.id,
        sourceType: candidate.type,
        title: candidate.title,
        content,
        url: candidate.url,
      },
    ];
  }

  return [];
}

function nextConversationStarters(name: string): string[] {
  return [
    `What are your core principles, ${name}?`,
    `What mistakes should beginners avoid in your domain?`,
    `How should I apply your ideas this week?`,
  ];
}

function parseSelectedCandidates(job: PersonaIngestJob): PersonaSourceCandidate[] {
  const raw = (job.stats as Record<string, unknown>)?.selectedCandidates;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PersonaSourceCandidate => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.type === "string" &&
      typeof candidate.title === "string"
    );
  });
}

async function runJob(jobId: string): Promise<void> {
  const job = await getOraclePersonaIngestJobById(jobId);
  if (!job || job.status === "completed" || job.status === "failed") return;

  const userSettings = await getOracleUserSettings(job.user_id);
  if (!userSettings?.encrypted_api_key) {
    await updateOraclePersonaIngestJob({
      id: jobId,
      status: "failed",
      step: "Failed",
      progressPercent: 100,
      errorMessage: "No API key configured in Settings.",
      completed: true,
    });
    return;
  }

  const apiKey = decrypt(userSettings.encrypted_api_key);
  const persona = await getOraclePersonaById(job.persona_id);
  if (!persona) {
    await updateOraclePersonaIngestJob({
      id: jobId,
      status: "failed",
      step: "Failed",
      progressPercent: 100,
      errorMessage: "Persona not found.",
      completed: true,
    });
    return;
  }

  await updateOraclePersonaIngestJob({
    id: jobId,
    status: "running",
    step: "Preparing selected sources",
    progressPercent: 5,
    stats: { discovered: 0, ingested: 0, chunks: 0 },
    errorMessage: null,
    started: true,
  });

  let selected = parseSelectedCandidates(job);
  if (selected.length === 0) {
    await updateOraclePersonaIngestJob({
      id: jobId,
      step: "Discovering sources",
      progressPercent: 12,
    });
    selected = await discoverPersonaSources(job.query, job.sources);
  }

  const allDocs: TextSourceDocument[] = [];
  const books: Array<{ title: string; year?: number; description?: string }> = [];
  const podcasts: Array<{ title: string; url?: string; platform?: string }> = [];
  const expertise = new Set<string>();

  for (let i = 0; i < selected.length; i++) {
    const candidate = selected[i];
    if (candidate.type === "book") {
      books.push({
        title: candidate.title,
        year: typeof candidate.metadata?.year === "number" ? candidate.metadata.year : undefined,
        description:
          typeof candidate.metadata?.sentence === "string"
            ? candidate.metadata.sentence
            : undefined,
      });
      expertise.add("Books");
    }
    if (candidate.type === "podcast") {
      podcasts.push({ title: candidate.title, url: candidate.url, platform: "Podcast" });
      expertise.add("Podcasts");
    }
    if (candidate.type === "youtube") expertise.add("YouTube");
    if (candidate.type === "blog") expertise.add("Blogs");
    if (candidate.type === "interview") expertise.add("Interviews");
    if (candidate.type === "social") expertise.add("Social");

    const docs = await candidateToDocuments(candidate);
    allDocs.push(...docs);

    const percent = 12 + ((i + 1) / Math.max(1, selected.length)) * 20;
    await updateOraclePersonaIngestJob({
      id: jobId,
      step: `Collecting text ${i + 1}/${selected.length}`,
      progressPercent: percent,
      stats: {
        discovered: allDocs.length,
        ingested: 0,
        chunks: 0,
      },
    });
  }

  if (allDocs.length === 0) {
    const enriched = await enrichPersonaProfileWithAI({
      query: job.query,
      inferredName: persona.name,
      provider: userSettings.ai_provider,
      model: userSettings.ai_model,
      apiKey,
      selectedCandidates: selected,
    }).catch(() => null);

    await updateOraclePersonaMetadata({
      personaId: job.persona_id,
      name: enriched?.name || persona.name,
      bio:
        enriched?.bio ||
        `Auto-created persona for ${job.query}. No transcript-ready sources were found yet.`,
      expertise:
        (enriched?.expertise && enriched.expertise.length > 0
          ? enriched.expertise
          : [...expertise]).slice(0, 5),
      books: (enriched?.books && enriched.books.length > 0 ? enriched.books : books).slice(0, 12),
      podcasts:
        (enriched?.media && enriched.media.length > 0 ? enriched.media : podcasts).slice(0, 16),
      conversationStarters:
        (enriched?.conversationStarters && enriched.conversationStarters.length > 0
          ? enriched.conversationStarters
          : nextConversationStarters(persona.name)).slice(0, 5),
      imageUrl: enriched?.imageUrl,
    });
    await updateOraclePersonaIngestJob({
      id: jobId,
      status: "completed",
      step: "Completed",
      progressPercent: 100,
      stats: {
        discovered: 0,
        ingested: 0,
        chunks: 0,
      },
      completed: true,
      errorMessage: null,
    });
    return;
  }

  let ingested = 0;
  let chunks = 0;
  for (let i = 0; i < allDocs.length; i++) {
    const doc = allDocs[i];
    const exists = await hasOracleDocumentChunkBySourceKey(job.persona_id, doc.sourceKey);
    if (!exists) {
      const translateDoc = shouldTranslateToEnglish(doc.content);
      const splitChunks = chunkText(doc.content, 500, 60).slice(0, 60);
      for (const chunk of splitChunks) {
        let embeddingText = chunk;
        if (translateDoc) {
          try {
            embeddingText = await translateChunkToEnglish({
              text: chunk,
              provider: userSettings.ai_provider,
              model: userSettings.ai_model,
              apiKey,
            });
          } catch {
            embeddingText = chunk;
          }
        }

        const embedding = await createEmbedding(userSettings.ai_provider, apiKey, embeddingText);
        await insertOracleDocumentChunk({
          personaId: job.persona_id,
          content: embeddingText,
          embedding,
          metadata: {
            source_key: doc.sourceKey,
            source_type: doc.sourceType,
            source_title: doc.title,
            source_url: doc.url || "",
            translated_to_english: translateDoc,
            ingested_at: new Date().toISOString(),
          },
        });
        chunks += 1;
      }
      ingested += 1;
    }

    const percent = 35 + ((i + 1) / allDocs.length) * 60;
    if ((i + 1) % 2 === 0 || i === allDocs.length - 1) {
      await updateOraclePersonaIngestJob({
        id: jobId,
        step: `Ingested ${i + 1}/${allDocs.length} resources`,
        progressPercent: Math.min(99.5, percent),
        stats: {
          discovered: allDocs.length,
          ingested,
          chunks,
        },
      });
    }
  }

  const enriched = await enrichPersonaProfileWithAI({
    query: job.query,
    inferredName: persona.name,
    provider: userSettings.ai_provider,
    model: userSettings.ai_model,
    apiKey,
    selectedCandidates: selected,
  }).catch(() => null);

  await updateOraclePersonaMetadata({
    personaId: job.persona_id,
    name: enriched?.name || persona.name,
    bio:
      enriched?.bio ||
      persona.bio?.trim() ||
      `Auto-curated persona built from discovered books, podcasts, blogs, and transcripts for ${job.query}.`,
    expertise:
      (enriched?.expertise && enriched.expertise.length > 0
        ? enriched.expertise
        : [...expertise]).slice(0, 5),
    books: (enriched?.books && enriched.books.length > 0 ? enriched.books : books).slice(0, 12),
    podcasts:
      (enriched?.media && enriched.media.length > 0 ? enriched.media : podcasts).slice(0, 16),
    conversationStarters:
      (enriched?.conversationStarters && enriched.conversationStarters.length > 0
        ? enriched.conversationStarters
        : nextConversationStarters(persona.name)).slice(0, 5),
    imageUrl: enriched?.imageUrl,
  });

  await updateOraclePersonaIngestJob({
    id: jobId,
    status: "completed",
    step: "Completed",
    progressPercent: 100,
    stats: {
      discovered: allDocs.length,
      ingested,
      chunks,
    },
    completed: true,
    errorMessage: null,
  });
}

export function enqueuePersonaIngestJob(jobId: string): void {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  void runJob(jobId)
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "Unknown ingestion error";
      await updateOraclePersonaIngestJob({
        id: jobId,
        status: "failed",
        step: "Failed",
        progressPercent: 100,
        errorMessage: message,
        completed: true,
      });
    })
    .finally(() => {
      runningJobs.delete(jobId);
    });
}

export async function resumeActivePersonaIngestJobs(userId: string): Promise<void> {
  const jobs = await listOraclePersonaIngestJobs(userId);
  for (const job of jobs) {
    if (job.status === "queued" || job.status === "running") {
      enqueuePersonaIngestJob(job.id);
    }
  }
}

export async function regeneratePersonaProfile(input: {
  userId: string;
  personaId: string;
  nameOverride?: string;
  query?: string;
}): Promise<void> {
  const persona = await getOraclePersonaById(input.personaId);
  if (!persona) throw new Error("Persona not found");

  const userSettings = await getOracleUserSettings(input.userId);
  if (!userSettings?.encrypted_api_key) {
    throw new Error("No API key configured in Settings.");
  }

  const apiKey = decrypt(userSettings.encrypted_api_key);
  const personaName = input.nameOverride?.trim() || persona.name;
  const query = input.query?.trim() || personaName;
  const selectedCandidates = await discoverPersonaSources(query, defaultSources()).catch(() => []);
  const inferred = inferPersonaFromCandidates(query, selectedCandidates);
  const inferredName = personaName || inferred.name || persona.name;

  const enriched = await enrichPersonaProfileWithAI({
    query,
    inferredName,
    provider: userSettings.ai_provider,
    model: userSettings.ai_model,
    apiKey,
    selectedCandidates,
  }).catch(() => null);

  const fallbackExpertise = [...new Set(
    selectedCandidates.map((candidate) => {
      switch (candidate.type) {
        case "book":
          return "Books";
        case "podcast":
          return "Podcasts";
        case "youtube":
          return "YouTube";
        case "interview":
          return "Interviews";
        case "social":
          return "Social Media";
        default:
          return "Thought Leadership";
      }
    })
  )].slice(0, 5);

  const fallbackBooks = selectedCandidates
    .filter((candidate) => candidate.type === "book")
    .map((candidate) => ({
      title: candidate.title,
      year: typeof candidate.metadata?.year === "number" ? candidate.metadata.year : undefined,
      description:
        typeof candidate.metadata?.sentence === "string" ? candidate.metadata.sentence : undefined,
    }))
    .slice(0, 12);

  const fallbackMedia = selectedCandidates
    .filter((candidate) =>
      candidate.type === "podcast" ||
      candidate.type === "youtube" ||
      candidate.type === "interview" ||
      candidate.type === "social"
    )
    .map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
      platform: candidate.type === "youtube" ? "YouTube" : candidate.type === "podcast" ? "Podcast" : "Web",
    }))
    .slice(0, 16);

  const fallbackBio =
    selectedCandidates.length > 0
      ? `Auto-regenerated profile for ${personaName}. Sources include ${[...new Set(selectedCandidates.map((c) => c.type.toUpperCase()))].join(", ")} content discovered for this persona.`
      : persona.bio;

  const imageCandidate =
    enriched?.imageUrl ||
    (await pickBestImageCandidate(personaName).catch(() => undefined)) ||
    persona.image_url ||
    undefined;

  await updateOraclePersonaMetadata({
    personaId: persona.id,
    name: personaName || enriched?.name || persona.name,
    bio: enriched?.bio || fallbackBio,
    expertise:
      (enriched?.expertise && enriched.expertise.length > 0
        ? enriched.expertise
        : fallbackExpertise.length > 0
          ? fallbackExpertise
          : persona.expertise).slice(0, 5),
    books:
      (enriched?.books && enriched.books.length > 0
        ? enriched.books
        : fallbackBooks.length > 0
          ? fallbackBooks
          : persona.books_json).slice(0, 12),
    podcasts:
      (enriched?.media && enriched.media.length > 0
        ? enriched.media
        : fallbackMedia.length > 0
          ? fallbackMedia
          : persona.podcasts_json).slice(0, 16),
    conversationStarters:
      (enriched?.conversationStarters && enriched.conversationStarters.length > 0
        ? enriched.conversationStarters
        : nextConversationStarters(personaName || persona.name)).slice(0, 5),
    imageUrl: imageCandidate,
  });
}
