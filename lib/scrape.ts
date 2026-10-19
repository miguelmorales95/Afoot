// Fetch a page and reduce it to readable text for the extractor.
//
// This is the "simple" fetcher: a plain HTTP GET + HTML-to-text. It works for
// server-rendered sites (e.g. Smog City). JS-rendered sites (e.g. Zebulon's
// calendar, New Wave's /events) return little useful text here — those need a
// headless-browser fetcher. `fetchPageText` is written so you can swap in a
// Playwright-based `fetchRendered()` later without touching the extractor.

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/** Strip a raw HTML string down to visible text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface FetchResult {
  url: string;
  text: string;
  ok: boolean;
  status: number;
}

/**
 * Fetch a URL and return its visible text, truncated to `maxChars`.
 * Returns ok:false (rather than throwing) so one bad venue doesn't kill a run.
 */
export async function fetchPageText(
  url: string,
  maxChars = 24000,
): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      redirect: "follow",
      // Don't let a slow venue hang the whole ingest run.
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const text = htmlToText(html).slice(0, maxChars);
    return { url, text, ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`  fetch failed for ${url}:`, (err as Error).message);
    return { url, text: "", ok: false, status: 0 };
  }
}

/**
 * Render a JS-heavy page in a headless browser and return its text. Used as a
 * fallback for sites whose calendars load client-side (e.g. Zebulon).
 *
 * Playwright is imported dynamically so the rest of the app doesn't depend on
 * it — install it only where you run rendered ingestion:
 *   npm i -D playwright && npx playwright install chromium
 * (Best run locally or on a VM, not on Vercel's serverless functions.)
 */
export async function fetchRenderedText(
  url: string,
  maxChars = 24000,
): Promise<FetchResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw: any = await import("playwright").catch(() => null);
    if (!pw?.chromium) {
      console.error("  playwright not installed — run: npm i -D playwright && npx playwright install chromium");
      return { url, text: "", ok: false, status: 0 };
    }
    const browser = await pw.chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ userAgent: BROWSER_UA });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1500); // let late-loading widgets settle
      const html = await page.content();
      const text = htmlToText(html).slice(0, maxChars);
      return { url, text, ok: true, status: 200 };
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error(`  render failed for ${url}:`, (err as Error).message);
    return { url, text: "", ok: false, status: 0 };
  }
}
