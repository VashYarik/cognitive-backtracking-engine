// Applies new SQL files from server/migrations to the connected database, in number order.
// Used by the migrate script (development database) and the test setup (test database).
import { readdir, readFile } from "node:fs/promises";
import type { Client } from "pg";
import { pendingMigrations } from "./migrations.ts";

export const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

// Returns the names of the files it applied, in the order applied.
export async function applyMigrations(client: Client): Promise<string[]> {
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
  }

  return pending;
}
