// Call useTestDb() at the top of a database test file. It connects to the test
// database and runs every test inside BEGIN ... ROLLBACK, so nothing a test
// inserts or creates is left behind for the next test.
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { dbConfig } from "../../src/db/config.ts";
import { loadTestEnv, testDatabaseName } from "./test-database.ts";

export function useTestDb(): () => pg.Client {
  let client: pg.Client | undefined;

  function db(): pg.Client {
    if (client === undefined) {
      throw new Error("useTestDb: not connected. Use the database only inside a test.");
    }
    return client;
  }

  beforeAll(async () => {
    loadTestEnv();
    client = new pg.Client(dbConfig(testDatabaseName()));
    await client.connect();
  });
  beforeEach(async () => {
    await db().query("BEGIN");
  });
  afterEach(async () => {
    await db().query("ROLLBACK");
  });
  afterAll(async () => {
    await client?.end();
  });

  return db;
}
