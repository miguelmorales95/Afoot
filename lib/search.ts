// Pluggable web search for the discovery crawler.
//
// Default backend is keyless DuckDuckGo HTML (good enough to leave running).
// If BRAVE_API_KEY is set, we use the Brave Search API instead — more reliable
// and higher quality (free tier ~2k queries/month). SerpAPI/Bing can be added
// the same way.

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

async function braveSearch(query: string, limit: number): Promise<SearchHit[]> {
  const url =
    "https://api.search.brave.com/res/v1/web/search?" +
    new URLSearchParams({ q: query, count: String(Math.min(limit, 20)), country: "us" });
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": process.env.BRAVE_API_KEY!,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}

async function duckDuckGoSearch(query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();

  const hits: SearchHit[] = [];
  // Result anchors look like: <a ... class="result__a" href="...uddg=ENCODED...">Title</a>
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < limit) {
    let href = m[1];
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (!href.startsWith("http")) href = "https:" + href;
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    hits.push({ title, url: href });
  }
  return hits;
}

export async function webSearch(query: string, limit = 10): Promise<SearchHit[]> {
  try {
    if (process.env.BRAVE_API_KEY) return await braveSearch(query, limit);
    return await duckDuckGoSearch(query, limit);
  } catch (err) {
    console.error(`  search failed for "${query}":`, (err as Error).message);
    return [];
  }
}

export function activeSearchBackend(): string {
  return process.env.BRAVE_API_KEY ? "brave" : "duckduckgo";
}
