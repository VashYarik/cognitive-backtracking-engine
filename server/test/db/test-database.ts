// Shared by the global setup and the database tests: which database is the
// test database, and the guard that stops anything else from being emptied.
import { requireEnv } from "../../src/db/config.ts";

const ENV_FILE = new URL("../../../.env", import.meta.url);

// Tests do not start through "npm run migrate", so they load .env themselves.
export function loadTestEnv(): void {
  if (process.env.POSTGRES_USER === undefined) {
    process.loadEnvFile(ENV_FILE);
  }
}

// The development database name with "_test" added, for example "cbe_test".
export function testDatabaseName(): string {
  return `${requireEnv("POSTGRES_DB")}_test`;
}

// The test setup deletes every table in the database it connects to.
// This check makes sure that can only ever happen to a "_test" database.
export function assertTestDatabase(name: string): void {
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to empty database "${name}": its name does not end in "_test".`);
  }
}
