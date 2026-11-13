import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS_DIR } from "../../src/db/apply-migrations.ts";
import { assertTestDatabase } from "./test-database.ts";
import { useTestDb } from "./test-db.ts";

const db = useTestDb();

describe("test database setup", () => {
  it("has every migration file recorded in schema_migrations", async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((name) => name.endsWith(".sql")).sort();
    const { rows } = await db().query<{ name: string }>(
      "SELECT name FROM schema_migrations ORDER BY name",
    );
    expect(rows.map((row) => row.name)).toEqual(files);
  });

  it("applies nothing when migrations run a second time", async () => {
    expect(await applyMigrations(db())).toEqual([]);
  });

  // These two tests run in order: the first creates a table, the second checks
  // it is gone, which shows each test's changes are rolled back.
  it("lets a test create a table", async () => {
    await db().query("CREATE TABLE rollback_probe (x int)");
    const { rows } = await db().query("SELECT to_regclass('rollback_probe') AS t");
    expect(rows[0].t).toBe("rollback_probe");
  });

  it("does not keep the previous test's table", async () => {
    const { rows } = await db().query("SELECT to_regclass('rollback_probe') AS t");
    expect(rows[0].t).toBeNull();
  });
});

describe("assertTestDatabase", () => {
  it("refuses a database whose name does not end in _test", () => {
    expect(() => assertTestDatabase("cbe")).toThrow("cbe");
    expect(() => assertTestDatabase("cbe_testing")).toThrow();
  });

  it("accepts a _test database", () => {
    expect(() => assertTestDatabase("cbe_test")).not.toThrow();
  });
});
