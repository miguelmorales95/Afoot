"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { NearbyEvent } from "@/lib/types";
import { categoryMeta, formatShortDate, formatTime } from "@/lib/format";

// OpenFreeMap: free vector tiles, no key, no visitor tracking. The style's source
// carries the OpenFreeMap / OpenMapTiles / OpenStreetMap attribution.
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

interface VenueGroup {
  id: string;
  name: string;
  lat: number;
  lng: number;
  events: NearbyEvent[];
}

function groupByVenue(events: NearbyEvent[]): VenueGroup[] {
  const map = new Map<string, VenueGroup>();
  for (const e of events) {
    const g = map.get(e.venue_id);
    if (g) g.events.push(e);
    else
      map.set(e.venue_id, {
        id: e.venue_id,
        name: e.venue_name,
        lat: e.venue_lat,
        lng: e.venue_lng,
        events: [e],
      });
  }
  return [...map.values()];
}

function pinElement(g: VenueGroup): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `${g.name}: ${g.events.length} event${g.events.length === 1 ? "" : "s"}`);
  el.tabIndex = 0;
  el.style.cursor = "pointer";
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#c026d3;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff">
      <span style="transform:rotate(45deg);color:#fff;font-size:12px;font-weight:700">${g.events.length}</span>
    </div>`;
  return el;
}

// The rotated square's tip sits ~6px below its box, so lift the marker to put the tip on the venue.
const PIN_OFFSET: [number, number] = [0, -6];
const POPUP_OFFSET = {
  top: [0, 4], "top-left": [0, 4], "top-right": [0, 4],
  bottom: [0, -40], "bottom-left": [0, -40], "bottom-right": [0, -40],
  left: [16, -20], right: [-16, -20],
} as maplibregl.Offset;

function VenuePopup({ g }: { g: VenueGroup }) {
  return (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{g.name}</div>
      {g.events.slice(0, 5).map((e) => {
        const cat = categoryMeta(e.category);
        return (
          <div key={e.occurrence_id} style={{ fontSize: 12, marginBottom: 4 }}>
            {cat.emoji}{" "}
            {e.url ? (
              <a href={e.url} target="_blank" rel="noopener noreferrer">
                {e.title}
              </a>
            ) : (
              e.title
            )}
            <div style={{ color: "rgba(255,255,255,.5)" }}>
              {formatShortDate(e.starts_at)} · {formatTime(e.starts_at)}
              {e.price ? ` · ${e.price}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function EventsMap({
  events,
  center,
}: {
  events: NearbyEvent[];
  center: [number, number];
}) {
  const groups = useMemo(() => groupByVenue(events), [events]);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [popups, setPopups] = useState<{ g: VenueGroup; el: HTMLElement }[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE_URL,
        center: [center[1], center[0]],
        zoom: 12,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true); // no WebGL
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const nodes: { g: VenueGroup; el: HTMLElement }[] = [];
    const markers = groups.map((g) => {
      const content = document.createElement("div");
      nodes.push({ g, el: content });
      const popup = new maplibregl.Popup({ offset: POPUP_OFFSET, maxWidth: "280px" }).setDOMContent(content);
      const el = pinElement(g);
      const marker = new maplibregl.Marker({ element: el, anchor: "bottom", offset: PIN_OFFSET })
        .setLngLat([g.lng, g.lat])
        .setPopup(popup)
        .addTo(map);
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          marker.togglePopup();
        }
      });
      return marker;
    });
    setPopups(nodes);

    if (groups.length) {
      const bounds = new maplibregl.LngLatBounds([center[1], center[0]], [center[1], center[0]]);
      for (const g of groups) bounds.extend([g.lng, g.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 });
    } else {
      map.jumpTo({ center: [center[1], center[0]], zoom: 12 });
    }

    return () => markers.forEach((m) => m.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10" style={{ height: "70vh" }}>
      {failed ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-white/50">
          This browser can&apos;t draw the map. The list and table views still show every event.
        </div>
      ) : (
        <div ref={containerRef} className="events-map h-full w-full" style={{ background: "#0a0a0f" }} />
      )}
      {popups.map(({ g, el }) => createPortal(<VenuePopup g={g} />, el, g.id))}
    </div>
  );
}
