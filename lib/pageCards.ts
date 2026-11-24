// In the browser: a pasted or saved events page → short text "cards" with their links, so only a
// little text goes to the server (a saved Facebook page is ~8 MB; its cards are ~100 KB).
//   Facebook: one card per event link (facebook.com/events/<id>), holding the text around it:
//             "Sat, Dec 12 at 10 AM | King Harbor Boat Parade | Redondo Beach | 497 interested · 72 going".
//   Anything else: the page's text in chunks, links kept inline as ⟦url⟧, for Claude to split up.

export interface PageCard { text: string; url: string | null }
export interface PageCards { kind: "facebook" | "page"; cards: PageCard[]; chars: number }

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "TEMPLATE", "IFRAME", "HEAD"]);
const FB_EVENT = /(?:^|facebook\.com)\/events\/(\d{6,})/;

/** Text of the page with " | " between elements and ⟦url⟧ where each link starts. */
function flatten(html: string, base: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { const t = n.textContent?.replace(/\s+/g, " "); if (t && t.trim()) out.push(t.trim()); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    if (SKIP.has(el.tagName.toUpperCase()) || el.getAttribute("aria-hidden") === "true") return;
    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
        let url = href;
        try { url = new URL(href, base).href; } catch { /* keep as is */ }
        const fb = url.match(FB_EVENT);
        out.push(`⟦${fb ? `https://www.facebook.com/events/${fb[1]}/` : url.slice(0, 300)}⟧`);
      }
    }
    out.push("|");
    el.childNodes.forEach(walk);
    out.push("|");
  };
  walk(doc.body ?? doc.documentElement);
  return out.join(" ").replace(/(\s*\|\s*)+/g, " | ").replace(/\s+/g, " ");
}

export function pageCards(html: string, plainText = ""): PageCards {
  const isFb = /facebook\.com/i.test(html) || /\/events\/\d{6,}/.test(html);
  const text = html ? flatten(html, isFb ? "https://www.facebook.com/" : "https://example.com/") : plainText;
  const fbIds = [...text.matchAll(/⟦https:\/\/www\.facebook\.com\/events\/(\d+)\/⟧/g)];
  if (fbIds.length >= 3) {
    // Each event's text runs from its link to the next event link; an event linked twice (the date,
    // then the title) gets both pieces. Notifications ("X invited you…") come along and Claude drops them.
    const byId = new Map<string, string[]>();
    const parts = text.split(/⟦https:\/\/www\.facebook\.com\/events\/(\d+)\/⟧/);
    for (let i = 1; i < parts.length; i += 2) {
      const piece = parts[i + 1].replace(/⟦[^⟧]*⟧/g, " ").replace(/(\s*\|\s*)+/g, " | ").trim().slice(0, 260);
      if (!byId.has(parts[i])) byId.set(parts[i], []);
      if (piece && piece !== "|") byId.get(parts[i])!.push(piece);
    }
    const cards = [...byId].map(([id, ps]) => ({ text: [...new Set(ps)].join(" | ").slice(0, 400), url: `https://www.facebook.com/events/${id}/` }))
      .filter((c) => c.text.replace(/[|\s]/g, "").length > 8);
    return { kind: "facebook", cards, chars: cards.reduce((n, c) => n + c.text.length, 0) };
  }
  // Any other page: ~6,000-character chunks, cut at a separator.
  const cards: PageCard[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(text.length, i + 6000);
    if (end < text.length) { const cut = text.lastIndexOf(" | ", end); if (cut > i + 3000) end = cut; }
    cards.push({ text: text.slice(i, end), url: null });
    i = end;
  }
  return { kind: "page", cards, chars: text.length };
}
