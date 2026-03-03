import { requireAdmin } from "@/lib/auth/server";
import {
  listOraclePersonasMissingImage,
  updateOraclePersonaImageUrl,
} from "@/lib/db/oracle";

interface WebProfileSource {
  url: string;
  title: string;
  imageUrl?: string;
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

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isUsableImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/logo|icon|favicon|sprite|banner|wordmark|podcast-cover|book-cover|album|thumbnail-default/i.test(url)) return false;
  return true;
}

function scoreHeadshotLikelihood(url: string): number {
  const value = url.toLowerCase();
  let score = 0;
  if (/portrait|headshot|profile|official|cropped|press|photo/i.test(value)) score += 8;
  if (/wikimedia|wikipedia|commons/i.test(value)) score += 4;
  if (/cover|podcast|channel|banner|logo|icon|book/i.test(value)) score -= 8;
  return score;
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

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMetaContent(html: string, key: string): string {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : "";
}

async function searchUrls(query: string, limit: number = 10): Promise<string[]> {
  const response = await fetch(
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
    const url = decodeHtmlEntities(match[1]);
    if (!seen.has(url) && /^https?:\/\//i.test(url)) {
      seen.add(url);
      urls.push(url);
    }
    if (urls.length >= limit) break;
    match = regex.exec(html);
  }
  return urls;
}

async function fetchWebProfileSource(url: string): Promise<WebProfileSource | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const html = await response.text();
  const title =
    parseMetaContent(html, "og:title") ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ? stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      : "") ||
    url;
  const imageUrl = parseMetaContent(html, "og:image");

  return {
    url,
    title: title.slice(0, 240),
    imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
  };
}

async function findProfileImageUrl(personaName: string): Promise<string | null> {
  const queryTokens = tokenize(personaName);

  const wikiImage = await findWikipediaImage(personaName);
  if (wikiImage) return wikiImage;

  const wikiDataImage = await findWikidataImage(personaName);
  if (wikiDataImage) return wikiDataImage;

  const podcastImage = await findITunesArtwork(personaName, queryTokens);
  if (podcastImage) return podcastImage;

  const searches = [
    `${personaName} official website`,
    `${personaName} profile`,
    `${personaName} wikipedia`,
    `${personaName} podcast`,
  ];
  const allUrls: string[] = [];
  const candidates: string[] = [];
  for (const q of searches) {
    const urls = await searchUrls(q, 8);
    allUrls.push(...urls);
  }
  const uniqueUrls = [...new Set(allUrls)].slice(0, 20);

  for (const url of uniqueUrls) {
    const source = await fetchWebProfileSource(url);
    if (!source?.imageUrl) continue;
    if (!isUsableImageUrl(source.imageUrl)) continue;
    candidates.push(source.imageUrl);
  }
  const ranked = candidates
    .filter(isUsableImageUrl)
    .map((url) => ({ url, score: scoreHeadshotLikelihood(url) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.url || null;
}

async function findWikipediaImage(personaName: string): Promise<string | null> {
  const queryTokens = tokenize(personaName);
  const searchUrl =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1` +
    `&srlimit=8&srsearch=${encodeURIComponent(personaName)}`;
  const searchResponse = await fetch(searchUrl, { cache: "no-store" });
  if (!searchResponse.ok) return null;
  const searchPayload = (await searchResponse.json()) as {
    query?: { search?: Array<{ title?: string; snippet?: string }> };
  };
  const rankedTitles = (searchPayload.query?.search || [])
    .map((item) => {
      const title = (item.title || "").trim();
      const snippet = stripHtml(item.snippet || "");
      if (!title) return null;
      const titleScore = overlapScore(queryTokens, tokenize(title));
      const snippetScore = overlapScore(queryTokens, tokenize(snippet));
      return { title, score: titleScore * 0.8 + snippetScore * 0.2 };
    })
    .filter((item): item is { title: string; score: number } => !!item)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const titles = rankedTitles.map((t) => t.title);
  if (titles.length === 0) return null;

  for (const pickedTitle of titles) {
    const summaryResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pickedTitle)}`,
      { cache: "no-store", headers: { Accept: "application/json" } }
    ).catch(() => null);
    if (summaryResponse?.ok) {
      const summary = (await summaryResponse.json()) as {
        thumbnail?: { source?: string };
        originalimage?: { source?: string };
        title?: string;
      };
      const summaryTitle = normalizeName(summary.title || pickedTitle);
      const nameMatch =
        overlapScore(queryTokens, tokenize(summaryTitle)) >= 0.6 ||
        summaryTitle.includes(normalizeName(personaName));
      if (!nameMatch) continue;
      const summaryCandidates = [summary.originalimage?.source, summary.thumbnail?.source]
        .filter((v): v is string => !!v)
        .filter(isUsableImageUrl)
        .sort((a, b) => scoreHeadshotLikelihood(b) - scoreHeadshotLikelihood(a));
      if (summaryCandidates[0]) return summaryCandidates[0];
    }
  }

  const pageUrl =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages` +
    `&pithumbsize=1000&titles=${encodeURIComponent(titles.join("|"))}`;
  const pageResponse = await fetch(pageUrl, { cache: "no-store" });
  if (!pageResponse.ok) return null;
  const pagePayload = (await pageResponse.json()) as {
    query?: { pages?: Record<string, { title?: string; thumbnail?: { source?: string } }> };
  };
  const pages = Object.values(pagePayload.query?.pages || {});
  const ranked = pages
    .map((page) => {
      const source = page.thumbnail?.source;
      if (!source || !isUsableImageUrl(source)) return null;
      const score =
        overlapScore(queryTokens, tokenize(page.title || "")) * 10 + scoreHeadshotLikelihood(source);
      return { source, score };
    })
    .filter((item): item is { source: string; score: number } => !!item)
    .sort((a, b) => b.score - a.score);
  if (ranked[0]) return ranked[0].source;
  return null;
}

async function findWikidataImage(personaName: string): Promise<string | null> {
  const queryTokens = tokenize(personaName);
  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en` +
    `&type=item&limit=10&search=${encodeURIComponent(personaName)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    search?: Array<{ id?: string; label?: string; description?: string }>;
  };
  const candidates = (payload.search || [])
    .map((item) => {
      const id = (item.id || "").trim();
      if (!id) return null;
      const labelScore = overlapScore(queryTokens, tokenize(item.label || ""));
      const descScore = overlapScore(queryTokens, tokenize(item.description || ""));
      return { id, score: labelScore * 0.8 + descScore * 0.2 };
    })
    .filter((item): item is { id: string; score: number } => !!item)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const candidate of candidates) {
    const entityResponse = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(candidate.id)}.json`,
      { cache: "no-store" }
    );
    if (!entityResponse.ok) continue;
    const entityPayload = (await entityResponse.json()) as {
      entities?: Record<
        string,
        {
          claims?: Record<
            string,
            Array<{ mainsnak?: { datavalue?: { value?: string | { id?: string } } } }>
          >;
        }
      >;
    };
    const entity = entityPayload.entities?.[candidate.id];
    const p31Claims = entity?.claims?.P31 || [];
    const isHuman = p31Claims.some((claim) => {
      const value = claim?.mainsnak?.datavalue?.value;
      return !!value && typeof value === "object" && value.id === "Q5";
    });
    if (!isHuman) continue;

    const fileName = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (!fileName || typeof fileName !== "string") continue;
    const commonsUrl =
      `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}`;
    if (isUsableImageUrl(commonsUrl)) return commonsUrl;
  }

  return null;
}

async function findITunesArtwork(personaName: string, queryTokens: string[]): Promise<string | null> {
  const response = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(personaName)}&media=podcast&limit=12`,
    { cache: "no-store" }
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    results?: Array<{
      artistName?: string;
      collectionName?: string;
      artworkUrl600?: string;
      artworkUrl100?: string;
    }>;
  };
  const ranked = (payload.results || [])
    .map((item) => {
      const artist = (item.artistName || "").trim();
      const collection = (item.collectionName || "").trim();
      const score = Math.max(
        overlapScore(queryTokens, tokenize(artist)),
        overlapScore(queryTokens, tokenize(collection))
      );
      const imageUrl = item.artworkUrl600 || item.artworkUrl100 || "";
      return { score, imageUrl };
    })
    .filter((item) => item.score >= 0.45 && isUsableImageUrl(item.imageUrl))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.imageUrl || null;
}

export async function POST() {
  try {
    await requireAdmin();
    const personas = await listOraclePersonasMissingImage();
    let updated = 0;
    const failures: string[] = [];

    for (const persona of personas) {
      try {
        const imageUrl = await findProfileImageUrl(persona.name);
        if (!imageUrl) continue;
        await updateOraclePersonaImageUrl(persona.id, imageUrl);
        updated += 1;
      } catch {
        failures.push(persona.name);
      }
    }

    return Response.json({
      success: true,
      scanned: personas.length,
      updated,
      failures,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh profile images";
    return Response.json({ error: message }, { status: 500 });
  }
}
