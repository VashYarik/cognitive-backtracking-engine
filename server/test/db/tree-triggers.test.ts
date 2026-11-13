// Rules of migration 003 for the concept tree: no loops, no prerequisite on the
// root, approval removed by any edit, tree locked while a session is active.
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  type Id,
  insertConcept,
  insertCourse,
  insertPrerequisite,
  insertSession,
  queryError,
} from "./fixtures.ts";
import { useTestDb } from "./test-db.ts";

const db = useTestDb();

const LINK = "INSERT INTO prerequisite (course_id, concept_id, prerequisite_id) VALUES ($1, $2, $3)";

// A course with n concepts that are not the root.
async function courseWith(n: number): Promise<{ courseId: Id; c: Id[] }> {
  const courseId = await insertCourse(db());
  const c: Id[] = [];
  for (let i = 0; i < n; i += 1) {
    c.push(await insertConcept(db(), courseId));
  }
  return { courseId, c };
}

async function approve(courseId: Id): Promise<void> {
  await db().query("UPDATE course SET tree_approved = true WHERE id = $1", [courseId]);
}

async function isApproved(courseId: Id): Promise<boolean> {
  const { rows } = await db().query("SELECT tree_approved FROM course WHERE id = $1", [courseId]);
  return rows[0].tree_approved;
}

describe("no loops in the prerequisite links", () => {
  it("accepts a chain", async () => {
    const { courseId, c } = await courseWith(3);
    await insertPrerequisite(db(), courseId, c[1], c[0]);
    await insertPrerequisite(db(), courseId, c[2], c[1]);
  });

  it("rejects a direct loop: A needs B, then B needs A", async () => {
    const { courseId, c } = await courseWith(2);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    const error = await queryError(db(), LINK, [courseId, c[1], c[0]]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("prerequisite_no_loop");
  });

  it("rejects a loop through three concepts", async () => {
    const { courseId, c } = await courseWith(3);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    await insertPrerequisite(db(), courseId, c[1], c[2]);
    const error = await queryError(db(), LINK, [courseId, c[2], c[0]]);
    expect(error.constraint).toBe("prerequisite_no_loop");
  });

  it("accepts a diamond: two paths to the same prerequisite are not a loop", async () => {
    const { courseId, c } = await courseWith(4);
    await insertPrerequisite(db(), courseId, c[1], c[0]);
    await insertPrerequisite(db(), courseId, c[2], c[0]);
    await insertPrerequisite(db(), courseId, c[3], c[1]);
    await insertPrerequisite(db(), courseId, c[3], c[2]);
  });

  it("rejects an update that creates a loop", async () => {
    const { courseId, c } = await courseWith(4);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    await insertPrerequisite(db(), courseId, c[1], c[2]);
    await insertPrerequisite(db(), courseId, c[3], c[2]);
    // Turn "D needs C" into "C needs A": A -> B -> C -> A.
    const error = await queryError(
      db(),
      `UPDATE prerequisite SET concept_id = $1, prerequisite_id = $2
       WHERE concept_id = $3 AND prerequisite_id = $4`,
      [c[2], c[0], c[3], c[2]],
    );
    expect(error.constraint).toBe("prerequisite_no_loop");
  });

  it("accepts reversing a link, because the old link is replaced, not kept", async () => {
    const { courseId, c } = await courseWith(2);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    await db().query(
      `UPDATE prerequisite SET concept_id = $2, prerequisite_id = $1
       WHERE concept_id = $1 AND prerequisite_id = $2`,
      [c[0], c[1]],
    );
  });
});

describe("the root has no prerequisites", () => {
  it("rejects a prerequisite on the root", async () => {
    const courseId = await insertCourse(db());
    const root = await insertConcept(db(), courseId, { isRoot: true });
    const other = await insertConcept(db(), courseId);
    const error = await queryError(db(), LINK, [courseId, root, other]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("prerequisite_not_on_root");
  });

  it("rejects making a concept that has prerequisites the root", async () => {
    const { courseId, c } = await courseWith(2);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    const error = await queryError(db(), "UPDATE concept SET is_root = true WHERE id = $1", [c[0]]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("concept_root_has_no_prerequisites");
  });

  it("accepts making a concept without prerequisites the root", async () => {
    const { courseId, c } = await courseWith(2);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    await db().query("UPDATE concept SET is_root = true WHERE id = $1", [c[1]]);
  });
});

describe("any tree edit removes the approval", () => {
  const edits: [label: string, edit: (courseId: Id, c: Id[]) => Promise<unknown>][] = [
    ["adding a concept", (courseId) => insertConcept(db(), courseId)],
    ["renaming a concept", (_, c) =>
      db().query("UPDATE concept SET title = 'New title' WHERE id = $1", [c[0]])],
    ["marking a concept critical", (_, c) =>
      db().query("UPDATE concept SET is_critical = true WHERE id = $1", [c[0]])],
    ["deleting a concept", (_, c) => db().query("DELETE FROM concept WHERE id = $1", [c[2]])],
    ["adding a link", (courseId, c) => insertPrerequisite(db(), courseId, c[1], c[2])],
    ["deleting a link", (_, c) =>
      db().query("DELETE FROM prerequisite WHERE concept_id = $1", [c[0]])],
  ];

  it.each(edits)("%s", async (_label, edit) => {
    const { courseId, c } = await courseWith(3);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    await approve(courseId);
    await edit(courseId, c);
    expect(await isApproved(courseId)).toBe(false);
  });

  it("leaves another course's approval alone", async () => {
    const edited = await courseWith(1);
    const other = await courseWith(1);
    await approve(edited.courseId);
    await approve(other.courseId);
    await insertConcept(db(), edited.courseId);
    expect(await isApproved(other.courseId)).toBe(true);
  });
});

describe("the tree is locked while a session is active", () => {
  const edits: [label: string, sql: string, values: (courseId: Id, c: Id[]) => unknown[]][] = [
    ["adding a concept", "INSERT INTO concept (course_id, title) VALUES ($1, 'New')", (courseId) => [
      courseId,
    ]],
    ["renaming a concept", "UPDATE concept SET title = 'New' WHERE id = $1", (_, c) => [c[0]]],
    ["deleting a concept", "DELETE FROM concept WHERE id = $1", (_, c) => [c[2]]],
    ["adding a link", LINK, (courseId, c) => [courseId, c[1], c[2]]],
    ["deleting a link", "DELETE FROM prerequisite WHERE concept_id = $1", (_, c) => [c[0]]],
  ];

  it.each(edits)("rejects %s", async (_label, sql, values) => {
    const { courseId, c } = await courseWith(3);
    await insertPrerequisite(db(), courseId, c[0], c[1]);
    await insertSession(db(), courseId);
    const error = await queryError(db(), sql, values(courseId, c));
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("tree_locked_during_session");
  });

  it("allows edits again once the session has ended", async () => {
    const { courseId } = await courseWith(1);
    const sessionId = await insertSession(db(), courseId);
    await db().query("UPDATE class_session SET ended_at = now() WHERE id = $1", [sessionId]);
    await insertConcept(db(), courseId);
  });

  it("is not affected by another course's active session", async () => {
    const locked = await courseWith(1);
    const free = await courseWith(1);
    await insertSession(db(), locked.courseId);
    await insertConcept(db(), free.courseId);
  });
});
