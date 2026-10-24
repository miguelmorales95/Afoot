"use client";

import { useState } from "react";

// Static street thumbnail from our own /api/minimap (an <img>, not a live map), so a
// long list costs one cached request per venue and no WebGL contexts.
export default function VenueMiniMap({
  lat,
  lng,
  venue,
}: {
  lat: number;
  lng: number;
  venue: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;

  // Round so nearby events at one venue share a cached URL. Bump v when the drawing
  // changes: browsers keep these images for 30 days.
  const src = `/api/minimap?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&v=2`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`Map near ${venue}`}
      width={120}
      height={96}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-auto w-full rounded-lg bg-[#13131b] ring-1 ring-white/10"
    />
  );
}
