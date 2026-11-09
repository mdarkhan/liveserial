/**
 * Local Postgres for development and tests (no Docker / install needed).
 * Data lives in ./.pgdata (git-ignored). Keep this running in its own terminal:
 *   npm run db:start
 * Creates the databases `liveserial` (dev) and `liveserial_test` (integration/e2e tests).
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const dir = "./.pgdata";

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  port: PORT,
  user: "postgres",
  password: "postgres",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();

const client = pg.getPgClient("postgres");
await client.connect();
for (const name of ["liveserial", "liveserial_test"]) {
  const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (!rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();

console.log(`Postgres ready on postgresql://postgres:postgres@localhost:${PORT}/liveserial (Ctrl+C to stop)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
