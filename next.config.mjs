/** @type {import('next').NextConfig} */
const nextConfig = {
  // Both database drivers are required at runtime rather than bundled. That
  // keeps `pg`'s native bits intact, and it means the PGlite branch — which a
  // production deployment never takes — does not have to resolve at build time.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
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
