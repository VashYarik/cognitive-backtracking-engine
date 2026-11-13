// Rules of migration 003 for sessions: a session needs an approved tree, and a
// pulse's or walk-back's concept must belong to the session's course.
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  insertConcept,
  insertCourse,
  insertPulseSetup,
  insertSession,
  queryError,
} from "./fixtures.ts";
import { useTestDb } from "./test-db.ts";

const db = useTestDb();

describe("a session needs an approved tree", () => {
  it("rejects a session for a course whose tree is not approved", async () => {
    const courseId = await insertCourse(db());
    const error = await queryError(
      db(),
      "INSERT INTO class_session (course_id, join_code) VALUES ($1, 'A1')",
      [courseId],
    );
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("class_session_requires_approved_tree");
  });

  it("accepts a session for a course whose tree is approved", async () => {
    const courseId = await insertCourse(db());
    await db().query("UPDATE course SET tree_approved = true WHERE id = $1", [courseId]);
    await db().query("INSERT INTO class_session (course_id, join_code) VALUES ($1, 'A1')", [
      courseId,
    ]);
  });
});

describe("a pulse's concept belongs to the session's course", () => {
  const insertPulse = `INSERT INTO pulse (class_session_id, concept_id, wording_id, joined_count, window_seconds)
    VALUES ($1, $2, (SELECT min(id) FROM p1_wording), 0, 25)`;

  it("rejects a concept of another course", async () => {
    const { sessionId } = await insertPulseSetup(db());
    const otherConcept = await insertConcept(db(), await insertCourse(db()));
    const error = await queryError(db(), insertPulse, [sessionId, otherConcept]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("pulse_concept_in_course");
  });

  it("rejects changing a pulse to a concept of another course", async () => {
    const { pulseId } = await insertPulseSetup(db());
    const otherConcept = await insertConcept(db(), await insertCourse(db()));
    const error = await queryError(db(), "UPDATE pulse SET concept_id = $1 WHERE id = $2", [
      otherConcept,
      pulseId,
    ]);
    expect(error.constraint).toBe("pulse_concept_in_course");
  });

  it("accepts a concept of the session's course", async () => {
    const { sessionId, conceptId } = await insertPulseSetup(db());
    await db().query(insertPulse, [sessionId, conceptId]);
  });
});

describe("a walk-back's concept belongs to the session's course", () => {
  const insertWalkBack = "INSERT INTO walk_back (class_session_id, concept_id) VALUES ($1, $2)";

  it("rejects a concept of another course", async () => {
    const courseId = await insertCourse(db());
    await insertConcept(db(), courseId, { isRoot: true });
    const sessionId = await insertSession(db(), courseId);
    const otherConcept = await insertConcept(db(), await insertCourse(db()));
    const error = await queryError(db(), insertWalkBack, [sessionId, otherConcept]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("walk_back_concept_in_course");
  });

  it("accepts a concept of the session's course", async () => {
    const { sessionId, conceptId } = await insertPulseSetup(db());
    await db().query(insertWalkBack, [sessionId, conceptId]);
  });
});
