import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

/**
 * Set `E2E_BASE_URL` to run the same specs against a deployed environment
 * instead of a locally built one — the R0 exit criterion asks for the flow on
 * the real URL, not only on localhost. Note that it registers a real account in
 * whatever database that deployment is pointed at.
 */
const deployedUrl = process.env.E2E_BASE_URL;

/**
 * End-to-end proof of the R0 slice. Kept out of `npm run verify` because the
 * production build plus browser run exceeds the Stop hook's 45s budget — run it
 * with `npm run test:e2e`, and in CI.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: deployedUrl ?? `http://127.0.0.1:${PORT}`,
    // Sandboxed environments reach the internet through an egress proxy that
    // Chromium does not pick up from the environment on its own. Only relevant
    // when the target is remote; a local run never leaves the loopback.
    proxy:
      deployedUrl && process.env.HTTPS_PROXY
        ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }
        : undefined,
    ...devices["Pixel 7"], // NFR3: the product is mobile-first
    launchOptions: {
      // Some sandboxes ship a pinned Chromium that does not match this
      // Playwright build. PLAYWRIGHT_CHROMIUM_EXECUTABLE points at it there;
      // everywhere else Playwright resolves its own download.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  // Nothing to start when the target is already running somewhere else.
  webServer: deployedUrl
    ? undefined
    : {
        command: `npm run build && npx tsx scripts/e2e-server.ts`,
        url: `http://127.0.0.1:${PORT}/login`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          PORT: String(PORT),
          SESSION_SECRET: "e2e-secret",
        },
      },
});
