"use client";

// Admin: sponsors and their campaigns (area sponsor cards, featured events), with the
// counts sponsors get in their monthly report. Writes go through /api/admin/sponsors
// (service role on the server, behind ADMIN_TOKEN).
import { useCallback, useEffect, useState } from "react";
import { CAMPAIGN_STATUSES, type CampaignProduct, type CampaignStatus } from "@/lib/ads";
import SponsorCard from "./SponsorCard";

const TOKEN_KEY = "afoot_admin_token";
const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };

interface Sponsor {
  id?: string;
  business_name: string;
  contact_name: string | null;
  contact_email: string | null;
  stripe_customer_id: string | null;
  notes: string | null;
}

interface Counts { views: number; clicks: number; views30: number; clicks30: number }

interface Campaign {
  id?: string;
  sponsor_id: string;
  product: CampaignProduct;
  area: string;
  event_id: string | null;
  event_title?: string | null;
  starts_on: string;
  ends_on: string;
  badge: string | null;
  title: string;
  body: string | null;
  cta: string | null;
  href: string;
  status: CampaignStatus;
  price_cents: number | null;
  counts?: Counts;
}

interface Data {
  ready: boolean;
  note?: string;
  sponsors?: (Sponsor & { id: string })[];
  campaigns?: (Campaign & { id: string; counts: Counts })[];
  areas?: string[];
  today?: string;
}

const PRODUCTS: Record<CampaignProduct, string> = {
  area_sponsor: "Area sponsor card",
  featured_event: "Featured event",
};

const STATUS_STYLE: Record<CampaignStatus, string> = {
  draft: "bg-white/10 text-white/60",
  approved: "bg-sky-500/15 text-sky-300",
  live: "bg-emerald-500/15 text-emerald-300",
  paused: "bg-amber-500/15 text-amber-300",
  ended: "bg-white/5 text-white/40",
};

const rate = (clicks: number, views: number) => (views ? `${((clicks / views) * 100).toFixed(1)}%` : "–");
const input = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-fuchsia-500/50";

export default function SponsorAdmin() {
  const [token] = useState(savedToken);
  const [data, setData] = useState<Data | null>(null);
  const [sponsorForm, setSponsorForm] = useState<Sponsor | null>(null);
  const [campaignForm, setCampaignForm] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const headers = useCallback(
    (json = false): Record<string, string> => ({
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-admin-token": token } : {}),
    }),
    [token],
  );

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/sponsors", { headers: headers() });
    const d = await res.json().catch(() => ({}));
    setData(res.ok ? d : { ready: false, note: d.error || "Couldn't load sponsors." });
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const post = async (payload: object): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/sponsors", { method: "POST", headers: headers(true), body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Couldn't save that.");
      return false;
    }
    await load();
    return true;
  };

  if (!data) return null;

  const newCampaign = (sponsorId: string): Campaign => ({
    sponsor_id: sponsorId, product: "area_sponsor", area: "all", event_id: null,
    starts_on: data.today ?? "", ends_on: "", badge: "", title: "", body: "", cta: "See what's on →",
    href: "https://", status: "draft", price_cents: null,
  });

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Sponsors</h2>
        {data.ready && (
          <button
            onClick={() => { setCampaignForm(null); setSponsorForm({ business_name: "", contact_name: "", contact_email: "", stripe_customer_id: "", notes: "" }); }}
            className="rounded-full bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold hover:bg-fuchsia-500"
          >
            + New sponsor
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-white/50">
        Live campaigns (status “live”, today within their dates) replace the house promos in their area within
        about a minute. Counts are views and clicks per day, nothing about visitors.
      </p>

      {!data.ready && (
        <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          {data.note}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>
      )}

      {sponsorForm && (
        <SponsorForm
          value={sponsorForm}
          busy={busy}
          onChange={setSponsorForm}
          onCancel={() => setSponsorForm(null)}
          onSave={async () => { if (await post({ kind: "sponsor", sponsor: sponsorForm })) setSponsorForm(null); }}
        />
      )}

      <div className="mt-4 space-y-4">
        {data.ready && data.sponsors?.length === 0 && !sponsorForm && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-10 text-center text-sm text-white/50">
            No sponsors yet. Add one, then give it a campaign.
          </div>
        )}
        {data.sponsors?.map((s) => {
          const campaigns = (data.campaigns ?? []).filter((c) => c.sponsor_id === s.id);
          return (
            <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{s.business_name}</h3>
                  <p className="text-sm text-white/50">
                    {[s.contact_name, s.contact_email].filter(Boolean).join(" · ") || "No contact yet"}
                    {s.stripe_customer_id ? ` · ${s.stripe_customer_id}` : ""}
                  </p>
                  {s.notes && <p className="mt-1 whitespace-pre-line text-xs text-white/40">{s.notes}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setCampaignForm(null); setSponsorForm({ ...s }); }}
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5">
                    Edit
                  </button>
                  <button onClick={() => { setSponsorForm(null); setCampaignForm(newCampaign(s.id)); }}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">
                    + Campaign
                  </button>
                </div>
              </div>

              {campaignForm && campaignForm.sponsor_id === s.id && (
                <CampaignForm
                  value={campaignForm}
                  areas={data.areas ?? ["all"]}
                  sponsors={data.sponsors ?? []}
                  busy={busy}
                  headers={headers}
                  onChange={setCampaignForm}
                  onCancel={() => setCampaignForm(null)}
                  onSave={async () => { if (await post({ kind: "campaign", campaign: campaignForm })) setCampaignForm(null); }}
                />
              )}

              <div className="mt-3 space-y-3">
                {campaigns.map((c) => (
                  <div key={c.id} className="grid gap-3 border-t border-white/5 pt-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                    <SponsorCard campaign={{ ...c, id: c.id }} preview />
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                        <span className="text-white/70">{PRODUCTS[c.product]}</span>
                        <span className="text-white/40">· {c.area === "all" ? "All areas" : c.area}</span>
                      </div>
                      <p className="mt-1 text-white/50">
                        {c.starts_on} → {c.ends_on}
                        {c.price_cents != null ? ` · $${(c.price_cents / 100).toFixed(2)}` : ""}
                      </p>
                      {c.product === "featured_event" && (
                        <p className="text-white/50">Features: {c.event_title ?? (c.event_id ? "an event that's no longer listed" : "no event")}</p>
                      )}
                      <p className="truncate text-xs text-white/35">{c.href}</p>
                      <table className="mt-2 text-xs">
                        <thead className="text-white/40">
                          <tr><th className="pr-4 text-left font-normal" /><th className="pr-4 text-right font-normal">Views</th><th className="pr-4 text-right font-normal">Clicks</th><th className="text-right font-normal">Click rate</th></tr>
                        </thead>
                        <tbody className="tabular-nums">
                          <tr><td className="pr-4 text-white/50">Last 30 days</td><td className="pr-4 text-right">{c.counts.views30}</td><td className="pr-4 text-right">{c.counts.clicks30}</td><td className="text-right">{rate(c.counts.clicks30, c.counts.views30)}</td></tr>
                          <tr><td className="pr-4 text-white/50">Total</td><td className="pr-4 text-right">{c.counts.views}</td><td className="pr-4 text-right">{c.counts.clicks}</td><td className="text-right">{rate(c.counts.clicks, c.counts.views)}</td></tr>
                        </tbody>
                      </table>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Status"
                          value={c.status}
                          disabled={busy}
                          onChange={(e) => void post({ kind: "status", id: c.id, status: e.target.value })}
                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs"
                        >
                          {CAMPAIGN_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                        <button onClick={() => { setSponsorForm(null); setCampaignForm({ ...c }); }}
                          className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/5">
                          Edit
                        </button>
                        {c.status === "live" && data.today && (c.starts_on > data.today || c.ends_on < data.today) && (
                          <span className="text-xs text-amber-300">Live, but today is outside its dates, so it isn&apos;t showing.</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-white/50">
      <span className="mb-1 block">{label}{hint && <span className="text-white/30"> · {hint}</span>}</span>
      {children}
    </label>
  );
}

function SponsorForm({ value, busy, onChange, onCancel, onSave }: {
  value: Sponsor; busy: boolean; onChange: (s: Sponsor) => void; onCancel: () => void; onSave: () => void;
}) {
  const set = (k: keyof Sponsor) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-4">
      <h3 className="text-sm font-semibold">{value.id ? "Edit sponsor" : "New sponsor"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name"><input className={input} value={value.business_name} onChange={set("business_name")} maxLength={120} /></Field>
        <Field label="Contact name"><input className={input} value={value.contact_name ?? ""} onChange={set("contact_name")} maxLength={120} /></Field>
        <Field label="Contact email" hint="monthly report goes here"><input className={input} type="email" value={value.contact_email ?? ""} onChange={set("contact_email")} maxLength={200} /></Field>
        <Field label="Stripe customer id" hint="optional, cus_…"><input className={input} value={value.stripe_customer_id ?? ""} onChange={set("stripe_customer_id")} maxLength={100} /></Field>
      </div>
      <Field label="Notes" hint="promo phrase, what they said at check-in…"><textarea className={input} rows={2} value={value.notes ?? ""} onChange={set("notes")} maxLength={2000} /></Field>
      <FormButtons busy={busy} onCancel={onCancel} onSave={onSave} />
    </div>
  );
}

function CampaignForm({ value, areas, sponsors, busy, headers, onChange, onCancel, onSave }: {
  value: Campaign; areas: string[]; sponsors: { id: string; business_name: string }[]; busy: boolean;
  headers: () => Record<string, string>; onChange: (c: Campaign) => void; onCancel: () => void; onSave: () => void;
}) {
  const set = (k: keyof Campaign) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; title: string; venue: string | null }[]>([]);

  const searchEvents = async () => {
    if (!q.trim()) return;
    const res = await fetch(`/api/admin/sponsors?eventSearch=${encodeURIComponent(q)}`, { headers: headers() });
    const d = await res.json().catch(() => ({}));
    setFound(d.events ?? []);
  };

  const chars = (s: string | null, soft: number) => `${(s ?? "").length}/${soft}`;

  return (
    <div className="mt-3 grid gap-4 rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{value.id ? "Edit campaign" : "New campaign"}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sponsor">
            <select className={input} value={value.sponsor_id} onChange={set("sponsor_id")}>
              {sponsors.map((s) => <option key={s.id} value={s.id}>{s.business_name}</option>)}
            </select>
          </Field>
          <Field label="Product">
            <select className={input} value={value.product} onChange={set("product")}>
              {Object.entries(PRODUCTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Area">
            <select className={input} value={value.area} onChange={set("area")}>
              {areas.map((a) => <option key={a} value={a}>{a === "all" ? "All areas" : a}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className={input} value={value.status} onChange={set("status")}>
              {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Starts on"><input className={input} type="date" value={value.starts_on} onChange={set("starts_on")} /></Field>
          <Field label="Ends on" hint="inclusive"><input className={input} type="date" value={value.ends_on} onChange={set("ends_on")} /></Field>
        </div>

        {value.product === "featured_event" && (
          <Field label="Featured event" hint={value.event_title ?? (value.event_id ? value.event_id : "search by title")}>
            <div className="flex gap-2">
              <input className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. trivia"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchEvents(); } }} />
              <button type="button" onClick={() => void searchEvents()} className="rounded-full bg-white/10 px-3 text-xs hover:bg-white/20">Search</button>
            </div>
            {found.length > 0 && (
              <ul className="mt-2 space-y-1">
                {found.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => { onChange({ ...value, event_id: e.id, event_title: e.title }); setFound([]); }}
                      className={`w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-white/10 ${value.event_id === e.id ? "bg-white/10" : ""}`}>
                      {e.title} <span className="text-white/40">{e.venue ? `· ${e.venue}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-[80px_minmax(0,1fr)]">
          <Field label="Badge"><input className={input} value={value.badge ?? ""} onChange={set("badge")} maxLength={16} placeholder="🍺" /></Field>
          <Field label="Title" hint={`~30 characters (${chars(value.title, 30)})`}><input className={input} value={value.title} onChange={set("title")} maxLength={60} /></Field>
        </div>
        <Field label="Line" hint={`~90 characters (${chars(value.body, 90)})`}><textarea className={input} rows={2} value={value.body ?? ""} onChange={set("body")} maxLength={160} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Button" hint={`~20 characters (${chars(value.cta, 20)})`}><input className={input} value={value.cta ?? ""} onChange={set("cta")} maxLength={40} /></Field>
          <Field label="Price" hint="USD, for your records">
            <input className={input} type="number" min={0} step="0.01"
              value={value.price_cents == null ? "" : value.price_cents / 100}
              onChange={(e) => onChange({ ...value, price_cents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100) })} />
          </Field>
        </div>
        <Field label="Link" hint="their site, event page or Instagram; UTM tags are added on click">
          <input className={input} value={value.href} onChange={set("href")} maxLength={1000} />
        </Field>
        <FormButtons busy={busy} onCancel={onCancel} onSave={onSave} />
      </div>
      <div>
        <p className="mb-2 text-xs text-white/40">Preview</p>
        <SponsorCard campaign={{ id: value.id ?? "preview", badge: value.badge, title: value.title || "Business name", body: value.body, cta: value.cta }} preview />
        {value.product === "featured_event" && (
          <p className="mt-2 text-xs text-white/40">Featured events show as the event&apos;s own card, labeled “Featured”, pinned above the list in its area. The card text above is used in reports.</p>
        )}
      </div>
    </div>
  );
}

function FormButtons({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5">Cancel</button>
      <button type="button" disabled={busy} onClick={onSave} className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold hover:bg-emerald-500 disabled:opacity-40">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
