// Rules of migration 001: professor, course, concept, prerequisite.
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  insertConcept,
  insertCourse,
  insertPrerequisite,
  queryError,
  UNIQUE_VIOLATION,
} from "./fixtures.ts";
import { useTestDb } from "./test-db.ts";

const db = useTestDb();

describe("professor", () => {
  it("rejects a second professor with the same email", async () => {
    await db().query("INSERT INTO professor (email, password_hash) VALUES ('a@example.test', 'x')");
    const error = await queryError(
      db(),
      "INSERT INTO professor (email, password_hash) VALUES ('a@example.test', 'y')",
    );
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("professor_email_unique");
  });
});

describe("course", () => {
  it("starts with the default settings and an unapproved tree", async () => {
    const courseId = await insertCourse(db());
    const { rows } = await db().query("SELECT * FROM course WHERE id = $1", [courseId]);
    expect(rows[0]).toMatchObject({
      window_seconds: 25,
      lost_cutoff_ordinary: 3,
      lost_cutoff_critical: 5,
      alert_bar_percent: 25,
      min_group_size: 3,
      live_update_seconds: 5,
      tree_approved: false,
    });
  });

  it("accepts an answer window of 15 and of 60 seconds", async () => {
    const courseId = await insertCourse(db());
    await db().query("UPDATE course SET window_seconds = 15 WHERE id = $1", [courseId]);
    await db().query("UPDATE course SET window_seconds = 60 WHERE id = $1", [courseId]);
  });

  const outOfRange: [column: string, value: number, constraint: string][] = [
    ["window_seconds", 14, "course_window_range"],
    ["window_seconds", 61, "course_window_range"],
    ["lost_cutoff_ordinary", 0, "course_lost_cutoff_ordinary_range"],
    ["lost_cutoff_ordinary", 8, "course_lost_cutoff_ordinary_range"],
    ["lost_cutoff_critical", 0, "course_lost_cutoff_critical_range"],
    ["lost_cutoff_critical", 8, "course_lost_cutoff_critical_range"],
    ["alert_bar_percent", 0, "course_alert_bar_range"],
    ["alert_bar_percent", 101, "course_alert_bar_range"],
    ["min_group_size", 0, "course_min_group_size_positive"],
    ["live_update_seconds", 0, "course_live_update_positive"],
  ];
  it.each(outOfRange)("rejects %s = %i", async (column, value, constraint) => {
    const courseId = await insertCourse(db());
    // The column name comes from the fixed list above, never from outside input.
    const error = await queryError(db(), `UPDATE course SET ${column} = $1 WHERE id = $2`, [
      value,
      courseId,
    ]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe(constraint);
  });

  it("cannot be deleted while it still has concepts", async () => {
    const courseId = await insertCourse(db());
    await insertConcept(db(), courseId);
    const error = await queryError(db(), "DELETE FROM course WHERE id = $1", [courseId]);
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("concept", () => {
  it("counts as ordinary and not the root unless marked", async () => {
    const courseId = await insertCourse(db());
    await db().query("INSERT INTO concept (course_id, title) VALUES ($1, 'Limits')", [courseId]);
    const { rows } = await db().query(
      "SELECT is_critical, is_root FROM concept WHERE course_id = $1",
      [courseId],
    );
    expect(rows[0]).toEqual({ is_critical: false, is_root: false });
  });

  it("allows only one root per course", async () => {
    const courseId = await insertCourse(db());
    await insertConcept(db(), courseId, { isRoot: true });
    const error = await queryError(
      db(),
      "INSERT INTO concept (course_id, title, is_root) VALUES ($1, 'Second root', true)",
      [courseId],
    );
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("concept_one_root_per_course");
  });

  it("allows each course its own root", async () => {
    await insertConcept(db(), await insertCourse(db()), { isRoot: true });
    await insertConcept(db(), await insertCourse(db()), { isRoot: true });
  });
});

describe("prerequisite", () => {
  it("accepts a link between two concepts of the same course", async () => {
    const courseId = await insertCourse(db());
    const root = await insertConcept(db(), courseId, { isRoot: true });
    const child = await insertConcept(db(), courseId);
    await insertPrerequisite(db(), courseId, child, root);
  });

  it("rejects a concept that is its own prerequisite", async () => {
    const courseId = await insertCourse(db());
    const concept = await insertConcept(db(), courseId);
    const error = await queryError(
      db(),
      "INSERT INTO prerequisite (course_id, concept_id, prerequisite_id) VALUES ($1, $2, $2)",
      [courseId, concept],
    );
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("prerequisite_not_self");
  });

  it("rejects a link to a concept of another course", async () => {
    const courseA = await insertCourse(db());
    const courseB = await insertCourse(db());
    const inA = await insertConcept(db(), courseA);
    const inB = await insertConcept(db(), courseB);
    const error = await queryError(
      db(),
      "INSERT INTO prerequisite (course_id, concept_id, prerequisite_id) VALUES ($1, $2, $3)",
      [courseA, inA, inB],
    );
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint).toBe("prerequisite_prerequisite_in_course");
  });

  it("rejects the same link twice", async () => {
    const courseId = await insertCourse(db());
    const root = await insertConcept(db(), courseId, { isRoot: true });
    const child = await insertConcept(db(), courseId);
    await insertPrerequisite(db(), courseId, child, root);
    const error = await queryError(
      db(),
      "INSERT INTO prerequisite (course_id, concept_id, prerequisite_id) VALUES ($1, $2, $3)",
      [courseId, child, root],
    );
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("prerequisite_pkey");
  });
});
