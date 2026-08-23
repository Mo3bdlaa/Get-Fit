/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` is required at runtime rather than bundled, which keeps its native
  // bits intact. PGlite is deliberately absent: listing it here marks it
  // external, and Next then traces it into the serverless output — but it is a
  // devDependency that Vercel prunes after the build. See src/lib/db/index.ts.
  serverExternalPackages: ["pg"],
  // `npm run verify` runs `tsc --noEmit` and `eslint` over the whole project —
  // including `tests/`, which Next's build-time check does not cover. Repeating
  // a narrower version of both inside the build costs seconds the Stop hook's
  // 45s budget does not have.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Migrations are read from disk at runtime, so they must be traced into the
  // deployment output alongside the server bundle.
  outputFileTracingIncludes: {
    "/**": ["./src/lib/db/migrations/**"],
  },
};

export default nextConfig;
