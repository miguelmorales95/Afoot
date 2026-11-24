"use client";

import { useId, useMemo, useState } from "react";
import { suggestPlaces, zipOf, type Place } from "@/lib/places";

export type PlacePick =
  | { kind: "place"; place: Place }
  | { kind: "all" }
  /** A ZIP or anything not in the list: geocoded by the page. */
  | { kind: "text"; text: string };

/**
 * One search box for a city, neighborhood or ZIP. Suggestions come from a local list as you
 * type (no network), so they appear instantly; a ZIP or free text falls back to geocoding.
 * With the box empty and focused it offers "All of LA".
 */
export default function PlaceSearch({ onPick, current }: { onPick: (p: PlacePick) => void; current?: string }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const options = useMemo(() => {
    const zip = zipOf(query);
    if (zip) return [{ key: `zip-${zip}`, label: zip, hint: "ZIP code", pick: { kind: "text", text: zip } as PlacePick }];
    if (!query.trim()) return [{ key: "all", label: "All of LA", hint: "Everything posted", pick: { kind: "all" } as PlacePick }];
    return suggestPlaces(query).map((p) => ({
      key: p.name,
      label: p.name,
      hint: p.kind === "city" ? "City" : "Neighborhood",
      pick: { kind: "place", place: p } as PlacePick,
    }));
  }, [query]);

  const choose = (p: PlacePick) => {
    setOpen(false);
    setQuery("");
    onPick(p);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = query.trim();
    const highlighted = open ? options[active] : undefined;
    if (highlighted && (typed || highlighted.pick.kind === "all")) return choose(highlighted.pick);
    if (typed) choose(options[0]?.pick ?? { kind: "text", text: typed });
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + d + options.length) % Math.max(options.length, 1));
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const showList = open && options.length > 0;
  return (
    <form onSubmit={submit} className="relative mx-auto w-full max-w-lg text-left">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Delay so a tap on a suggestion lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        placeholder={current ? `${current} · city, neighborhood, or ZIP` : "City, neighborhood, or ZIP"}
        aria-label="City, neighborhood, or ZIP"
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        enterKeyHint="search"
        className="w-full rounded-full border border-white/10 bg-white/5 py-3 pl-5 pr-24 text-sm outline-none placeholder:text-white/30 focus:border-[#ffe45c]/60"
      />
      <button
        type="submit"
        className="absolute right-1.5 top-1.5 rounded-full bg-[#ffe45c] px-4 py-2 text-sm font-semibold text-[#1a1a1a] hover:bg-[#fff08a]"
      >
        Search
      </button>
      {showList && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-2xl border border-white/10 bg-[#211a14] py-1 shadow-xl"
        >
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o.pick)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-5 py-2.5 text-sm ${
                i === active ? "bg-white/10 text-white" : "text-white/80"
              }`}
            >
              <span className="font-semibold">{o.label}</span>
              <span className="text-xs text-white/40">{o.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
