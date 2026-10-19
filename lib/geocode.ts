// Free geocoding via OpenStreetMap Nominatim (no API key).
// Usage policy: <= 1 request/second and a real contact in the User-Agent.
// https://operations.osmfoundation.org/policies/nominatim/

export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
}

const email = process.env.NOMINATIM_EMAIL || "";
const UA = `WhatsUp-LA-events/0.1 (${email || "contact-unset"})`;

export async function geocode(query: string): Promise<GeoResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "us",
    addressdetails: "0",
  });
  if (email) params.set("email", email);

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    label: data[0].display_name,
  };
}
