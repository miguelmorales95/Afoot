/** @type {import('next').NextConfig} */
const nextConfig = {
  // Venue logos / images can come from anywhere; allow remote images if we add <Image> later.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
