// Fetching a page someone pasted into a public form. Only public web addresses: no local or
// private network hosts (so the form can't be used to reach servers inside Vercel's network),
// http(s) only, a size cap and a timeout.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\./, /^2[3-5]\d\./];
const isPrivate = (ip: string) =>
  isIP(ip) === 4 ? PRIVATE_V4.some((r) => r.test(ip)) : /^(::1?$|fe[89ab]|f[cd]|::ffff:)/i.test(ip);

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("That isn't a web address"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use an http(s) link");
  if (url.username || url.password) throw new Error("That link can't be read");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("That link can't be read");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("That link can't be read");
  return url;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

/** HTML of a public page, at most ~1.5 MB, following up to 3 redirects (each one checked). */
export async function fetchPublicHtml(raw: string): Promise<{ url: string; html: string; status: number }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    const reader = res.body?.getReader();
    let html = "", bytes = 0;
    const decoder = new TextDecoder();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
      if (bytes > 1_500_000) { await reader.cancel(); break; }
    }
    return { url: url.toString(), html, status: res.status };
  }
  throw new Error("Too many redirects");
}
