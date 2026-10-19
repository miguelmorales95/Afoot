"use client";

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { NearbyEvent } from "@/lib/types";
import { categoryMeta, formatShortDate, formatTime } from "@/lib/format";

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

// Emoji pin via divIcon (avoids Leaflet's bundler-broken default marker images).
function pinIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#c026d3;box-shadow:0 2px 6px rgba(0,0,0,.4);border:2px solid #fff">
      <span style="transform:rotate(45deg);color:#fff;font-size:12px;font-weight:700">${count}</span>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

function FitBounds({ groups, center }: { groups: VenueGroup[]; center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (groups.length) {
      const bounds = L.latLngBounds(groups.map((g) => [g.lat, g.lng] as [number, number]));
      bounds.extend(center);
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    } else {
      map.setView(center, 12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, map]);
  return null;
}

export default function EventsMap({
  events,
  center,
}: {
  events: NearbyEvent[];
  center: [number, number];
}) {
  const groups = useMemo(() => groupByVenue(events), [events]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10" style={{ height: "70vh" }}>
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        style={{ height: "100%", width: "100%", background: "#0a0a0f" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds groups={groups} center={center} />
        {groups.map((g) => (
          <Marker key={g.id} position={[g.lat, g.lng]} icon={pinIcon(g.events.length)}>
            <Popup>
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
                      <div style={{ color: "#666" }}>
                        {formatShortDate(e.starts_at)} · {formatTime(e.starts_at)}
                        {e.price ? ` · ${e.price}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
