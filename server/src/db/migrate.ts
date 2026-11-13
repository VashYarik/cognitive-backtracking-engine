// Applies new SQL files from server/migrations to the database, in number order.
// Run with: npm run migrate   (reads the database login from the root .env)
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { pendingMigrations } from "./migrations.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run "npm run migrate", which loads ../.env.`);
  }
  return value;
}

async function main(): Promise<void> {
  const client = new pg.Client({
    // Same host and port that compose.yaml publishes.
    host: "127.0.0.1",
    port: 5432,
    user: requireEnv("POSTGRES_USER"),
    password: requireEnv("POSTGRES_PASSWORD"),
    database: requireEnv("POSTGRES_DB"),
  });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const applied = new Set(rows.map((row) => row.name));
    const pending = pendingMigrations(await readdir(MIGRATIONS_DIR), applied);

    for (const file of pending) {
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      // One transaction per file: the file's changes and its record in
      // schema_migrations are saved together, or neither is.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed; nothing from it was applied.`, {
          cause: error,
        });
      }
      console.log(`Applied ${file}`);
    }

    console.log(
      pending.length === 0 ? "No new migrations." : `Applied ${pending.length} migration(s).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
