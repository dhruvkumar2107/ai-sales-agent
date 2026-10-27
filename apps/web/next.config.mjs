/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@axo/shared"],
  // Standalone output keeps the Docker image small; Vercel ignores it.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
