import { describe, expect, it } from "vitest";
import { pendingMigrations } from "../src/db/migrations.ts";

describe("pendingMigrations", () => {
  it("returns files in number order, whatever order they are listed in", () => {
    expect(
      pendingMigrations(["002_b.sql", "010_c.sql", "001_a.sql"], new Set()),
    ).toEqual(["001_a.sql", "002_b.sql", "010_c.sql"]);
  });

  it("skips files that were already applied", () => {
    expect(
      pendingMigrations(["001_a.sql", "002_b.sql"], new Set(["001_a.sql"])),
    ).toEqual(["002_b.sql"]);
  });

  it("returns an empty list when every file was applied", () => {
    expect(
      pendingMigrations(["001_a.sql"], new Set(["001_a.sql"])),
    ).toEqual([]);
  });

  it("ignores files that are not .sql", () => {
    expect(
      pendingMigrations([".gitkeep", "notes.md", "001_a.sql"], new Set()),
    ).toEqual(["001_a.sql"]);
  });

  it("rejects a .sql file whose name is not NNN_name.sql", () => {
    for (const bad of ["1_a.sql", "001-a.sql", "001_.sql", "001_A.sql", "a_001.sql"]) {
      expect(() => pendingMigrations([bad], new Set())).toThrow(bad);
    }
  });

  it("rejects two files with the same number, because their order would be unclear", () => {
    expect(() =>
      pendingMigrations(["001_a.sql", "001_b.sql"], new Set()),
    ).toThrow("001");
  });
});
