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
};

export default nextConfig;
