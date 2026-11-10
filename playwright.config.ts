import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests. Run with `npm run test:e2e` (builds first).
 * - Needs Postgres running (`npm run db:start`); uses the liveserial_test database.
 * - Uses the locally installed Microsoft Edge, so no browser download is needed
 *   (set E2E_BROWSER_CHANNEL=chrome to use Chrome instead).
 * - Starts `next start` on port 3100; tests run one after another at 360px.
 */
const PORT = 3100;
export const E2E_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/liveserial_test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.E2E_BROWSER_CHANNEL ?? "msedge",
    viewport: { width: 360, height: 780 },
    locale: "bn-BD",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      APP_BASE_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-not-for-production-use-0000",
      SMS_PROVIDER: "console",
    },
  },
});
