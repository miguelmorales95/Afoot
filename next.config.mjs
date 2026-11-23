/** @type {import('next').NextConfig} */
const nextConfig = {
  // Venue logos / images can come from anywhere; allow remote images if we add <Image> later.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  // LOCAL_EVENTS_FILE is read at runtime, so ship the data folder with the events API.
  outputFileTracingIncludes: {
    "/api/events": ["./data/**/*.csv"],
  },
  // Browsers never keep pages or API data, so every visit gets the latest deploy.
  // /_next/static files are left alone: their names change on every deploy anyway.
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image).*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
