import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "../../vitest.config";

/**
 * Brings the test database up to the latest migration (non-destructive).
 * Tests never truncate: each one creates its own organization, so data from
 * earlier runs doesn't interfere. Needs Postgres running (`npm run db:start`
 * creates the `liveserial_test` database).
 */
export default function setup() {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
