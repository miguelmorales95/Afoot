// Small static street maps for event cards, drawn server-side as SVG from
// OpenFreeMap vector tiles (OpenMapTiles schema, no key). Rendering here instead
// of in the browser keeps a long list from spinning up one WebGL map per row and
// means visitors' browsers never contact a third party for the thumbnails.

import { VectorTile, type VectorTileFeature } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";

export const MINIMAP_ATTRIBUTION = "© OpenStreetMap contributors, © OpenMapTiles, OpenFreeMap";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const Z = 14; // OpenFreeMap's max zoom; the only level that carries every street name
const W = 120;
const H = 96;
const SPAN_M = 900; // ground distance across the image; tight enough that street names fit

const C = {
  bg: "#13131b",
  park: "#18241d",
  water: "#172238",
  minor: "#34343f",
  tertiary: "#3c3c4a",
  secondary: "#4a4a5a",
  primary: "#6e6e80",
  motorwayCase: "#0a0a0f",
  motorway: "#b08d57",
  label: "#e4e4ec",
  pin: "#d946ef",
};

type Pt = [number, number];
type RoadTier = "motorway" | "primary" | "secondary" | "tertiary" | "minor";

const TIER: Record<string, RoadTier> = {
  motorway: "motorway",
  trunk: "primary",
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  minor: "minor",
};
const TIER_RANK: Record<RoadTier, number> = { motorway: 0, primary: 1, secondary: 2, tertiary: 3, minor: 4 };
// Main roads always draw. Smaller streets draw only when their name fits on the map, so
// every side street shown can be told apart (an unnamed grey line doesn't help anyone).
const ALWAYS_DRAWN = new Set<RoadTier>(["motorway", "primary", "secondary"]);
const MAX_STREET_LABELS = 3; // the venue's street and a cross street or two is plenty

// The planet URL is versioned per weekly build, so read it from TileJSON rather than hardcoding.
let tileUrl: { url: string; at: number } | null = null;
async function tileTemplate(): Promise<string> {
  if (tileUrl && Date.now() - tileUrl.at < 6 * 3600_000) return tileUrl.url;
  const res = await fetch(TILEJSON_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`tilejson ${res.status}`);
  const tj = (await res.json()) as { tiles?: string[] };
  if (!tj.tiles?.[0]) throw new Error("tilejson has no tiles");
  tileUrl = { url: tj.tiles[0], at: Date.now() };
  return tileUrl.url;
}

// Neighbouring venues share tiles (~250 KB each in dense LA), so keep recent ones in memory.
const tileCache = new Map<string, Promise<VectorTile | null>>();
const TILE_CACHE_MAX = 48;

function loadTile(template: string, x: number, y: number): Promise<VectorTile | null> {
  const url = template.replace("{z}", String(Z)).replace("{x}", String(x)).replace("{y}", String(y));
  const hit = tileCache.get(url);
  if (hit) {
    tileCache.delete(url);
    tileCache.set(url, hit);
    return hit;
  }
  const p = fetch(url, { signal: AbortSignal.timeout(15_000) }).then(async (res) => {
    if (res.status === 404) return null; // open ocean
    if (!res.ok) throw new Error(`tile ${res.status}`);
    return new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
  });
  p.catch(() => tileCache.delete(url));
  tileCache.set(url, p);
  if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value!);
  return p;
}

// ---------- geometry ----------

interface Box { x0: number; y0: number; x1: number; y1: number }

function segHitsBox(a: Pt, b: Pt, box: Box): boolean {
  return !(
    Math.max(a[0], b[0]) < box.x0 || Math.min(a[0], b[0]) > box.x1 ||
    Math.max(a[1], b[1]) < box.y0 || Math.min(a[1], b[1]) > box.y1
  );
}

/** Split a line into the runs that pass near the box. */
function clipLine(line: Pt[], box: Box): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 1; i < line.length; i++) {
    if (segHitsBox(line[i - 1], line[i], box)) {
      if (!run.length) run.push(line[i - 1]);
      run.push(line[i]);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Sutherland–Hodgman against an axis-aligned box. */
function clipRing(ring: Pt[], box: Box): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= box.x0, (a, b) => lerpAt(a, b, 0, box.x0)],
    [(p) => p[0] <= box.x1, (a, b) => lerpAt(a, b, 0, box.x1)],
    [(p) => p[1] >= box.y0, (a, b) => lerpAt(a, b, 1, box.y0)],
    [(p) => p[1] <= box.y1, (a, b) => lerpAt(a, b, 1, box.y1)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) {
        out.push(cut(prev, cur));
      }
    }
    if (!out.length) break;
  }
  return out;
}

function lerpAt(a: Pt, b: Pt, axis: 0 | 1, v: number): Pt {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Path data with near-duplicate points dropped to keep the SVG small. */
function pathData(lines: Pt[][], close = false): string {
  let d = "";
  for (const line of lines) {
    let last: Pt | null = null;
    let n = 0;
    for (const p of line) {
      if (last && Math.abs(p[0] - last[0]) < 0.4 && Math.abs(p[1] - last[1]) < 0.4) continue;
      d += `${n ? "L" : "M"}${r1(p[0])} ${r1(p[1])}`;
      last = p;
      n++;
    }
    if (close && n) d += "Z";
  }
  return d;
}

// ---------- labels ----------

const ABBR: [RegExp, string][] = [
  [/\bBoulevard\b/g, "Blvd"], [/\bAvenue\b/g, "Ave"], [/\bStreet\b/g, "St"],
  [/\bDrive\b/g, "Dr"], [/\bRoad\b/g, "Rd"], [/\bPlace\b/g, "Pl"],
  [/\bFreeway\b/g, "Fwy"], [/\bHighway\b/g, "Hwy"], [/\bParkway\b/g, "Pkwy"],
  [/\bMartin Luther King,? (Junior|Jr\.?)/g, "MLK Jr"], [/\bJunior\b/g, "Jr"], [/\bSaint\b/g, "St"],
  [/\bTerrace\b/g, "Ter"], [/\bCourt\b/g, "Ct"], [/\bLane\b/g, "Ln"],
  [/^(North|South|East|West) /, ""],
];

function shortName(name: string): string {
  return ABBR.reduce((s, [re, to]) => s.replace(re, to), name).trim();
}

function freewayRef(p: Record<string, unknown>): string | null {
  const ref = typeof p.ref === "string" ? p.ref.split(";")[0].trim() : "";
  return /^\d{1,3}$/.test(ref) ? ref : null;
}

interface NamedLine { label: string; tier: RoadTier; line: Pt[] }

type Quad = [Pt, Pt, Pt, Pt];

function quad(cx: number, cy: number, w: number, h: number, angle: number): Quad {
  const c = Math.cos(angle), s = Math.sin(angle);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map(
    ([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Pt,
  ) as Quad;
}

function overlaps(a: Quad, b: Quad): boolean {
  for (const q of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4];
      const nx = y2 - y1, ny = x1 - x2;
      const pa = a.map(([x, y]) => x * nx + y * ny);
      const pb = b.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

function lineLength(line: Pt[]): number {
  let l = 0;
  for (let i = 1; i < line.length; i++) l += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return l;
}

/** The part of a polyline between arc lengths a and b. */
function slice(line: Pt[], a: number, b: number): Pt[] {
  const out: Pt[] = [];
  let s = 0;
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1], q = line[i];
    const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const at = (d: number): Pt => {
      const t = seg ? (d - s) / seg : 0;
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    if (s + seg >= a && s <= b) {
      if (!out.length) out.push(at(Math.max(a, s)));
      out.push(at(Math.min(b, s + seg)));
    }
    s += seg;
    if (s > b) break;
  }
  return out;
}


/** Join pieces that meet end to end. Tiles split a street at every intersection, and
 *  each piece alone is usually too short to carry the street's name. */
function mergeLines(lines: Pt[][]): Pt[][] {
  const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 0.75 && Math.abs(a[1] - b[1]) < 0.75;
  const rest = lines.filter((l) => l.length > 1).map((l) => [...l]);
  const out: Pt[][] = [];
  while (rest.length) {
    let cur = rest.pop()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const o = rest[i];
        const head = cur[0], tail = cur[cur.length - 1];
        let joined: Pt[] | null = null;
        if (near(tail, o[0])) joined = [...cur, ...o.slice(1)];
        else if (near(tail, o[o.length - 1])) joined = [...cur, ...o.slice(0, -1).reverse()];
        else if (near(head, o[o.length - 1])) joined = [...o, ...cur.slice(1)];
        else if (near(head, o[0])) joined = [...o.slice(1).reverse(), ...cur];
        if (joined) {
          cur = joined;
          rest.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

/** Shortest distance from a point to a polyline. */
function distanceTo(p: Pt, line: Pt[]): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return d;
}

// Every street first tries its full name along a straight stretch. Main roads may also
// use curvier stretches, alongside the road rather than on it (the
// venue's own street often runs under the pin), and finally without the suffix.
const STRICT = [
  { font: 10.5, straight: 0.88, bare: false, offset: 0 },
  { font: 9, straight: 0.88, bare: false, offset: 0 },
];
const RELAXED = [
  { font: 9, straight: 0.75, bare: false, offset: 0 },
  { font: 9, straight: 0.75, bare: false, offset: 7 },
  { font: 9, straight: 0.75, bare: false, offset: -7 },
  { font: 9, straight: 0.75, bare: true, offset: 0 },
  { font: 9, straight: 0.75, bare: true, offset: 7 },
  { font: 9, straight: 0.75, bare: true, offset: -7 },
  { font: 9, straight: 0.75, bare: true, offset: 11 },
  { font: 9, straight: 0.75, bare: true, offset: -11 },
];
const SHIELD = [{ font: 8.5, straight: 0.6, bare: false, offset: 0 }];
const SUFFIX = / (St|Ave|Blvd|Dr|Rd|Pl|Way|Ln|Ct|Ter|Pkwy)$/;

type Attempt = (typeof STRICT)[number];
interface Spot { path: Pt[]; boxes: Quad[]; mid: Pt; score: number; font: number; w: number; shown: string }

/** The same polyline shifted sideways by d (positive = left of travel direction). */
function offsetLine(line: Pt[], d: number): Pt[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] + ((b[1] - a[1]) / len) * d, p[1] - ((b[0] - a[0]) / len) * d] as Pt;
  });
}

function placeLabels(named: NamedLine[]): { defs: string; text: string; labeled: Set<string> } {
  const pin: Quad = quad(W / 2, H / 2 - 7, 16, 20, 0);
  const placed: Quad[] = [pin];
  const inView = (q: Quad) => q.every(([x, y]) => x >= 1 && x <= W - 1 && y >= 1 && y <= H - 1);
  const fits = (qs: Quad[]) => qs.every((q) => inView(q) && !placed.some((o) => overlaps(o, q)));

  // Rank names by how close the street passes to the venue, nudged toward bigger roads:
  // with only three names, the venue's own street and nearest cross streets matter most.
  const venue: Pt = [W / 2, H / 2];
  const byLabel = new Map<string, { tier: RoadTier; lines: Pt[][]; dist: number }>();
  for (const n of named) {
    const g = byLabel.get(n.label) ?? { tier: n.tier, lines: [], dist: Infinity };
    g.lines.push(n.line);
    g.dist = Math.min(g.dist, distanceTo(venue, n.line));
    if (TIER_RANK[n.tier] < TIER_RANK[g.tier]) g.tier = n.tier;
    byLabel.set(n.label, g);
  }
  const ranked = [...byLabel.entries()]
    .sort(([, a], [, b]) => a.dist + TIER_RANK[a.tier] * 6 - (b.dist + TIER_RANK[b.tier] * 6))
    .map(([label, g]) => ({ label, ...g, lines: mergeLines(g.lines), shield: g.tier === "motorway" && /^\d+$/.test(label) }));

  let defs = "";
  let text = "";
  let streets = 0;
  let shields = 0;
  const labeled = new Set<string>();

  const tryPlace = (r: (typeof ranked)[number], attempts: Attempt[]) => {
    if (labeled.has(r.label) || (r.shield ? shields >= 2 : streets >= MAX_STREET_LABELS)) return;
    let best: Spot | null = null;
    for (const a of attempts) {
      const shown = a.bare ? r.label.replace(SUFFIX, "") : r.label;
      if (a.bare && shown === r.label) continue;
      const w = r.shield ? shown.length * 6 + 7 : shown.length * 0.58 * a.font + 4;
      if (w > W * 0.9) continue;
      best = bestSpot(r.lines, w, shown, a, r.shield);
      if (best) break;
    }
    if (!best) return;
    const { w, font, shown } = best;
    labeled.add(r.label);
    placed.push(...best.boxes);
    if (r.shield) {
      shields++;
      const [x, y] = best.mid;
      text += `<rect x="${r1(x - w / 2)}" y="${r1(y - 5.5)}" width="${r1(w)}" height="11" rx="2.5" fill="${C.label}" stroke="${C.bg}" stroke-width="1"/>`;
      text += `<text x="${r1(x)}" y="${r1(y + 3.1)}" font-size="8.5" font-weight="700" fill="${C.bg}" text-anchor="middle">${esc(shown)}</text>`;
    } else {
      const id = `l${streets++}`;
      defs += `<path id="${id}" d="${pathData([best.path])}"/>`;
      text += `<text dy="${r1(font * 0.35)}" font-size="${font}" font-weight="600" fill="${C.label}" stroke="${C.bg}" stroke-width="2.6" stroke-linejoin="round" paint-order="stroke"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(shown)}</textPath></text>`;
    }
  };

  for (const r of ranked) tryPlace(r, r.shield ? SHIELD : ALWAYS_DRAWN.has(r.tier) ? [...STRICT, ...RELAXED] : STRICT);
  return { defs, text, labeled };

  // Prefer spots a little way from the pin: close enough to read as "the venue's
  // street", far enough not to sit under it.
  function bestSpot(lines: Pt[][], w: number, shown: string, a: Attempt, shield: boolean): Spot | null {
    let best: Spot | null = null;
    for (const line of lines) {
      const len = lineLength(line);
      for (let s = w / 2; s <= len - w / 2; s += 3) {
        let path = slice(line, s - w / 2, s + w / 2);
        const p0 = path[0], p1 = path[path.length - 1];
        // Gentle curves are fine (text follows the street); hairpins are not.
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < w * a.straight) continue;
        if (p1[0] < p0[0]) path = path.reverse(); // keep text upright
        if (a.offset) path = offsetLine(path, a.offset);
        const mid = slice(path, w / 2, w / 2)[0];
        let boxes: Quad[];
        if (shield) {
          boxes = [quad(mid[0], mid[1], w, 11, 0)];
        } else {
          // Approximate the curved label with three short boxes along it.
          boxes = [0, 1, 2].map((k) => {
            const piece = slice(path, (k * w) / 3, ((k + 1) * w) / 3);
            const q0 = piece[0], q1 = piece[piece.length - 1];
            return quad((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, w / 3 + 1, a.font + 2, Math.atan2(q1[1] - q0[1], q1[0] - q0[0]));
          });
        }
        if (!fits(boxes)) continue;
        const score = Math.abs(Math.hypot(mid[0] - W / 2, mid[1] - H / 2) - 26);
        if (!best || score < best.score) best = { path, boxes, mid, score, font: a.font, w, shown };
      }
    }
    return best;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------- render ----------

export async function renderMiniMap(lat: number, lng: number): Promise<string> {
  const n = 2 ** Z;
  const rad = (lat * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n; // fractional tile coords
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const tileMeters = (40075016.686 * Math.cos(rad)) / n;
  const tilesPerUnit = SPAN_M / tileMeters / W; // tile widths per SVG unit

  const vx0 = fx - (W / 2) * tilesPerUnit;
  const vy0 = fy - (H / 2) * tilesPerUnit;
  const vx1 = fx + (W / 2) * tilesPerUnit;
  const vy1 = fy + (H / 2) * tilesPerUnit;

  const template = await tileTemplate();
  const jobs: Promise<{ tx: number; ty: number; tile: VectorTile | null }>[] = [];
  for (let tx = Math.floor(vx0); tx <= Math.floor(vx1); tx++) {
    for (let ty = Math.floor(vy0); ty <= Math.floor(vy1); ty++) {
      jobs.push(loadTile(template, tx, ty).then((tile) => ({ tx, ty, tile })));
    }
  }
  const tiles = await Promise.all(jobs);

  const pad: Box = { x0: -6, y0: -6, x1: W + 6, y1: H + 6 };
  const roads: Record<RoadTier, Pt[][]> = { motorway: [], primary: [], secondary: [], tertiary: [], minor: [] };
  const sideStreets = new Map<string, { tier: RoadTier; lines: Pt[][] }>(); // drawn only if labeled
  const parks: Pt[][] = [];
  const water: Pt[][] = [];
  const named: NamedLine[] = [];

  for (const { tx, ty, tile } of tiles) {
    if (!tile) continue;
    const geom = (f: VectorTileFeature): Pt[][] =>
      f.loadGeometry().map((ring) =>
        ring.map((p) => [
          (tx + p.x / f.extent - vx0) / tilesPerUnit,
          (ty + p.y / f.extent - vy0) / tilesPerUnit,
        ] as Pt),
      );
    const each = (layer: string, fn: (f: VectorTileFeature) => void) => {
      const l = tile.layers[layer];
      if (l) for (let i = 0; i < l.length; i++) fn(l.feature(i));
    };

    each("water", (f) => {
      if (f.type !== 3 || f.properties.brunnel === "tunnel") return;
      for (const ring of geom(f)) {
        const c = clipRing(ring, pad);
        if (c.length > 2) water.push(c);
      }
    });
    each("park", (f) => {
      if (f.type !== 3) return;
      for (const ring of geom(f)) {
        const c = clipRing(ring, pad);
        if (c.length > 2) parks.push(c);
      }
    });
    each("transportation", (f) => {
      const tier = TIER[String(f.properties.class)];
      if (f.type !== 2 || !tier || !ALWAYS_DRAWN.has(tier) || f.properties.brunnel === "tunnel") return;
      // Ramps add clutter without helping anyone find the venue.
      if (f.properties.ramp === 1 && tier !== "motorway") return;
      for (const line of geom(f)) roads[tier].push(...clipLine(line, pad));
    });
    each("transportation_name", (f) => {
      const tier = TIER[String(f.properties.class)];
      if (f.type !== 2 || !tier || f.properties.subclass === "junction") return;
      const name = String(f.properties.name_en || f.properties.name || "");
      const label = tier === "motorway" ? freewayRef(f.properties) ?? shortName(name) : shortName(name);
      if (!label) return;
      for (const line of geom(f)) {
        for (const run of clipLine(line, { x0: 0, y0: 0, x1: W, y1: H })) named.push({ label, tier, line: run });
        if (!ALWAYS_DRAWN.has(tier) && f.properties.brunnel !== "tunnel") {
          const g = sideStreets.get(label) ?? { tier, lines: [] };
          g.lines.push(...clipLine(line, pad));
          sideStreets.set(label, g);
        }
      }
    });
  }

  const line = (lines: Pt[][], color: string, width: number) =>
    lines.length
      ? `<path d="${pathData(lines)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
      : "";
  const fill = (rings: Pt[][], color: string) =>
    rings.length ? `<path d="${pathData(rings, true)}" fill="${color}" fill-rule="evenodd"/>` : "";

  const labels = placeLabels(named);
  for (const [label, g] of sideStreets) if (labels.labeled.has(label)) roads[g.tier].push(...g.lines);
  const cx = W / 2, cy = H / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">`,
    `<!-- ${MINIMAP_ATTRIBUTION} -->`,
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`,
    fill(parks, C.park),
    fill(water, C.water),
    line(roads.minor, C.minor, 1.2),
    line(roads.tertiary, C.tertiary, 1.5),
    line(roads.secondary, C.secondary, 1.8),
    line(roads.primary, C.primary, 2.4),
    line(roads.motorway, C.motorwayCase, 4.6),
    line(roads.motorway, C.motorway, 3),
    labels.defs ? `<defs>${labels.defs}</defs>` : "",
    labels.text,
    // Teardrop pin whose tip sits exactly on the venue.
    `<path d="M${cx} ${cy}C${cx - 3} ${cy - 5} ${cx - 6} ${cy - 8} ${cx - 6} ${cy - 11.5}A6 6 0 1 1 ${cx + 6} ${cy - 11.5}C${cx + 6} ${cy - 8} ${cx + 3} ${cy - 5} ${cx} ${cy}Z" fill="${C.pin}" stroke="#fff" stroke-width="1.5"/>`,
    `<circle cx="${cx}" cy="${cy - 11.5}" r="2.2" fill="#fff"/>`,
    `</svg>`,
  ].join("");
}
