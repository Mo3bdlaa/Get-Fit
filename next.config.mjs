/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module; keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // Migrations are read from disk at runtime, so they must be traced into the
  // deployment output alongside the server bundle.
  outputFileTracingIncludes: {
    "/**": ["./src/lib/db/migrations/**"],
  },
};

export default nextConfig;
