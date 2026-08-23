import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

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
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Pixel 7"], // NFR3: the product is mobile-first
    launchOptions: {
      // Some sandboxes ship a pinned Chromium that does not match this
      // Playwright build. PLAYWRIGHT_CHROMIUM_EXECUTABLE points at it there;
      // everywhere else Playwright resolves its own download.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  webServer: {
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
