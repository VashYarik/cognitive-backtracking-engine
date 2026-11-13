// Rules of migration 004: the goal concept (spec v1.6, 3.6 and 4.15).
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  type Id,
  insertConcept,
  insertCourse,
  insertPrerequisite,
  insertSession,
  queryError,
  UNIQUE_VIOLATION,
} from "./fixtures.ts";
import { useTestDb } from "./test-db.ts";

const db = useTestDb();

// Root R; A needs R; G needs A and is the goal; P needs G (past the goal);
// S needs R but the goal does not need it (a side concept).
// Scope of the goal: G, A, R.
async function buildTree() {
  const courseId = await insertCourse(db());
  const root = await insertConcept(db(), courseId, { isRoot: true });
  const a = await insertConcept(db(), courseId);
  const goal = await insertConcept(db(), courseId, { isGoal: true });
  const past = await insertConcept(db(), courseId);
  const side = await insertConcept(db(), courseId);
  await insertPrerequisite(db(), courseId, a, root);
  await insertPrerequisite(db(), courseId, goal, a);
  await insertPrerequisite(db(), courseId, past, goal);
  await insertPrerequisite(db(), courseId, side, root);
  return { courseId, root, a, goal, past, side };
}

async function setCurrentConcept(sessionId: Id, conceptId: Id) {
  return db().query("UPDATE class_session SET current_concept_id = $1 WHERE id = $2", [
    conceptId,
    sessionId,
  ]);
}

const INSERT_PULSE = `INSERT INTO pulse (class_session_id, concept_id, wording_id, joined_count, window_seconds)
  VALUES ($1, $2, (SELECT min(id) FROM p1_wording), 0, 25)`;
const INSERT_WALK_BACK = "INSERT INTO walk_back (class_session_id, concept_id) VALUES ($1, $2)";

describe("the goal flag", () => {
  it("is off unless set", async () => {
    const courseId = await insertCourse(db());
    await db().query("INSERT INTO concept (course_id, title) VALUES ($1, 'Limits')", [courseId]);
    const { rows } = await db().query("SELECT is_goal FROM concept WHERE course_id = $1", [
      courseId,
    ]);
    expect(rows[0].is_goal).toBe(false);
  });

  it("allows only one goal per course", async () => {
    const courseId = await insertCourse(db());
    await insertConcept(db(), courseId, { isGoal: true });
    const error = await queryError(
      db(),
      "INSERT INTO concept (course_id, title, is_goal) VALUES ($1, 'Second goal', true)",
      [courseId],
    );
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("concept_one_goal_per_course");
  });

  it("may be on the root, for a course with one concept", async () => {
    const courseId = await insertCourse(db());
    await insertConcept(db(), courseId, { isRoot: true, isGoal: true });
  });
});

describe("the current concept must be in the goal's scope", () => {
  it("accepts the goal itself", async () => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    await setCurrentConcept(sessionId, t.goal);
  });

  it("accepts a concept two levels under the goal", async () => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    await setCurrentConcept(sessionId, t.root);
  });

  it.each([
    ["a concept past the goal", "past"],
    ["a side concept the goal does not need", "side"],
  ] as const)("rejects %s", async (_label, which) => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    const error = await queryError(
      db(),
      "UPDATE class_session SET current_concept_id = $1 WHERE id = $2",
      [t[which], sessionId],
    );
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("class_session_concept_in_goal_scope");
  });

  it("also checks the current concept given when the session is created", async () => {
    const t = await buildTree();
    await db().query("UPDATE course SET tree_approved = true WHERE id = $1", [t.courseId]);
    const error = await queryError(
      db(),
      "INSERT INTO class_session (course_id, join_code, current_concept_id) VALUES ($1, 'G1', $2)",
      [t.courseId, t.past],
    );
    expect(error.constraint).toBe("class_session_concept_in_goal_scope");
  });
});

describe("a pulse's concept must be in the goal's scope", () => {
  it("rejects a concept past the goal", async () => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    const error = await queryError(db(), INSERT_PULSE, [sessionId, t.past]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("pulse_concept_in_goal_scope");
  });

  it("accepts a concept in the scope", async () => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    await db().query(INSERT_PULSE, [sessionId, t.a]);
  });

  it("rejects every concept when the course has no goal", async () => {
    const courseId = await insertCourse(db());
    const root = await insertConcept(db(), courseId, { isRoot: true });
    const sessionId = await insertSession(db(), courseId);
    const error = await queryError(db(), INSERT_PULSE, [sessionId, root]);
    expect(error.constraint).toBe("pulse_concept_in_goal_scope");
  });
});

describe("a walk-back's concept must be in the goal's scope", () => {
  it("rejects a concept past the goal", async () => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    const error = await queryError(db(), INSERT_WALK_BACK, [sessionId, t.past]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("walk_back_concept_in_goal_scope");
  });

  it("accepts going back to the root", async () => {
    const t = await buildTree();
    const sessionId = await insertSession(db(), t.courseId);
    await db().query(INSERT_WALK_BACK, [sessionId, t.root]);
  });
});

describe("moving the goal", () => {
  it("removes the tree's approval", async () => {
    const t = await buildTree();
    await db().query("UPDATE course SET tree_approved = true WHERE id = $1", [t.courseId]);
    await db().query("UPDATE concept SET is_goal = false WHERE id = $1", [t.goal]);
    await db().query("UPDATE concept SET is_goal = true WHERE id = $1", [t.a]);
    const { rows } = await db().query("SELECT tree_approved FROM course WHERE id = $1", [
      t.courseId,
    ]);
    expect(rows[0].tree_approved).toBe(false);
  });

  it("is rejected while a session is active", async () => {
    const t = await buildTree();
    await insertSession(db(), t.courseId);
    const error = await queryError(db(), "UPDATE concept SET is_goal = false WHERE id = $1", [
      t.goal,
    ]);
    expect(error.constraint).toBe("tree_locked_during_session");
  });
});
