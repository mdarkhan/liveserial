import path from "node:path";
import { defineConfig } from "vitest/config";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/liveserial_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          // Unit tests never touch the DB; this only satisfies db.ts at import time.
          env: { DATABASE_URL: "postgresql://unit-tests@127.0.0.1:1/never-connects" },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/global-setup.ts"],
          env: { DATABASE_URL: TEST_DATABASE_URL },
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
