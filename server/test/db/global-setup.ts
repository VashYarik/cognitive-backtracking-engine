// Runs once before all test files (configured in vitest.config.ts).
// Creates the test database if it is missing, empties it, and applies all migrations,
// so every test run starts from exactly the structure the migrations define.
import pg from "pg";
import { applyMigrations } from "../../src/db/apply-migrations.ts";
import { dbConfig, requireEnv } from "../../src/db/config.ts";
import { assertTestDatabase, loadTestEnv, testDatabaseName } from "./test-database.ts";

async function connect(database: string): Promise<pg.Client> {
  const client = new pg.Client(dbConfig(database));
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      "Cannot reach PostgreSQL at 127.0.0.1:5432. Start it with: docker compose up -d",
      { cause: error },
    );
  }
  return client;
}

// Builds "message, caused by: message, ..." without reading error.stack.
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as { code?: unknown }).code;
    parts.push(typeof code === "string" ? `${current.message} [${code}]` : current.message);
    current = current.cause;
  }
  if (current !== undefined) {
    parts.push(String(current));
  }
  return parts.join("\n  caused by: ");
}

export async function setup(): Promise<void> {
  try {
    await prepareTestDatabase();
  } catch (error) {
    // Why: when Vitest prints an error thrown from global setup, Vite 8.3.5
    // crashes while mapping its stack trace ("code.charCodeAt is not a
    // function") and the real message is never shown. So the message is
    // printed here, without the stack trace, and the run stops.
    console.error(`Test database setup failed:\n  ${describeError(error)}`);
    process.exit(1);
  }
}

async function prepareTestDatabase(): Promise<void> {
  loadTestEnv();
  const testDb = testDatabaseName();
  assertTestDatabase(testDb);

  // CREATE DATABASE must be run while connected to a different database.
  const admin = await connect(requireEnv("POSTGRES_DB"));
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      testDb,
    ]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(testDb)}`);
    }
  } finally {
    await admin.end();
  }

  const client = await connect(testDb);
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await applyMigrations(client);
  } finally {
    await client.end();
  }
}
