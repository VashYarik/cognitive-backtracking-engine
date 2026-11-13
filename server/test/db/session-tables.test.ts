// Rules of migration 002: p1_wording, class_session, student_session, pulse,
// response, fracture_alert, walk_back.
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  insertConcept,
  insertCourse,
  insertPulseSetup,
  insertSession,
  insertStudent,
  queryError,
  UNIQUE_VIOLATION,
} from "./fixtures.ts";
import { useTestDb } from "./test-db.ts";

const db = useTestDb();

describe("p1_wording", () => {
  it("holds the starting P1 wording from the spec", async () => {
    const { rows } = await db().query("SELECT text FROM p1_wording");
    expect(rows).toEqual([{ text: "Could you explain the last idea to a classmate right now?" }]);
  });
});

describe("class_session", () => {
  it("rejects a join code already used by a session that has not ended", async () => {
    const courseId = await insertCourse(db());
    await insertSession(db(), courseId, { joinCode: "ABC123" });
    const error = await queryError(
      db(),
      "INSERT INTO class_session (course_id, join_code) VALUES ($1, 'ABC123')",
      [courseId],
    );
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("class_session_join_code_active");
  });

  it("allows a join code again once the earlier session has ended", async () => {
    const courseId = await insertCourse(db());
    const first = await insertSession(db(), courseId, { joinCode: "ABC123" });
    await db().query("UPDATE class_session SET ended_at = now() WHERE id = $1", [first]);
    await insertSession(db(), courseId, { joinCode: "ABC123" });
  });

  it("accepts a current concept of its own course", async () => {
    const courseId = await insertCourse(db());
    const concept = await insertConcept(db(), courseId, { isRoot: true });
    await insertSession(db(), courseId, { currentConceptId: concept });
  });

  it("rejects a current concept of another course", async () => {
    const courseA = await insertCourse(db());
    const conceptOfB = await insertConcept(db(), await insertCourse(db()));
    await db().query("UPDATE course SET tree_approved = true WHERE id = $1", [courseA]);
    const error = await queryError(
      db(),
      "INSERT INTO class_session (course_id, join_code, current_concept_id) VALUES ($1, 'X1', $2)",
      [courseA, conceptOfB],
    );
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
    expect(error.constraint).toBe("class_session_current_concept_in_course");
  });
});

describe("student_session", () => {
  it("gets a random UUID as its code", async () => {
    const sessionId = await insertSession(db(), await insertCourse(db()));
    const a = await insertStudent(db(), sessionId);
    const b = await insertStudent(db(), sessionId);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(a).toMatch(uuid);
    expect(b).toMatch(uuid);
    expect(a).not.toBe(b);
  });
});

describe("pulse", () => {
  it("rejects an unknown closed_by value", async () => {
    const { pulseId } = await insertPulseSetup(db());
    const error = await queryError(
      db(),
      "UPDATE pulse SET closed_at = now(), closed_by = 'student' WHERE id = $1",
      [pulseId],
    );
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("pulse_closed_by_values");
  });

  it("rejects closed_at without closed_by", async () => {
    const { pulseId } = await insertPulseSetup(db());
    const error = await queryError(db(), "UPDATE pulse SET closed_at = now() WHERE id = $1", [
      pulseId,
    ]);
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("pulse_closed_together");
  });

  it("accepts each allowed way of closing", async () => {
    for (const closedBy of ["timeout", "all_answered", "professor"]) {
      const { pulseId } = await insertPulseSetup(db());
      await db().query("UPDATE pulse SET closed_at = now(), closed_by = $1 WHERE id = $2", [
        closedBy,
        pulseId,
      ]);
    }
  });

  it("rejects an answer window outside 15 to 60 seconds", async () => {
    const { pulseId } = await insertPulseSetup(db());
    for (const seconds of [14, 61]) {
      const error = await queryError(db(), "UPDATE pulse SET window_seconds = $1 WHERE id = $2", [
        seconds,
        pulseId,
      ]);
      expect(error.constraint).toBe("pulse_window_range");
    }
  });
});

describe("response", () => {
  // Hard rule: response time is never recorded (spec section 5). If a column is
  // ever added to this table, this test fails and the change must be reviewed.
  it("has exactly the columns id, pulse_id, student_session_id, p1, p2", async () => {
    const { rows } = await db().query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'response'
       ORDER BY ordinal_position`,
    );
    expect(rows.map((row) => row.column_name)).toEqual([
      "id",
      "pulse_id",
      "student_session_id",
      "p1",
      "p2",
    ]);
  });

  it("accepts P1 only, P2 only, or both", async () => {
    const { pulseId } = await insertPulseSetup(db());
    await db().query("INSERT INTO response (pulse_id, p1) VALUES ($1, 'yes')", [pulseId]);
    await db().query("INSERT INTO response (pulse_id, p2) VALUES ($1, 7)", [pulseId]);
    await db().query("INSERT INTO response (pulse_id, p1, p2) VALUES ($1, 'not_yet', 1)", [pulseId]);
  });

  const badAnswers: [label: string, p1: string | null, p2: number | null, constraint: string][] = [
    ["P1 other than yes / not_yet", "maybe", null, "response_p1_values"],
    ["P2 of 0", null, 0, "response_p2_range"],
    ["P2 of 8", null, 8, "response_p2_range"],
    ["no answer at all", null, null, "response_has_answer"],
  ];
  it.each(badAnswers)("rejects %s", async (_label, p1, p2, constraint) => {
    const { pulseId } = await insertPulseSetup(db());
    const error = await queryError(
      db(),
      "INSERT INTO response (pulse_id, p1, p2) VALUES ($1, $2, $3)",
      [pulseId, p1, p2],
    );
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe(constraint);
  });

  it("allows one answer row per student per pulse", async () => {
    const { sessionId, pulseId } = await insertPulseSetup(db());
    const student = await insertStudent(db(), sessionId);
    await db().query(
      "INSERT INTO response (pulse_id, student_session_id, p1) VALUES ($1, $2, 'yes')",
      [pulseId, student],
    );
    const error = await queryError(
      db(),
      "INSERT INTO response (pulse_id, student_session_id, p2) VALUES ($1, $2, 4)",
      [pulseId, student],
    );
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("response_one_per_student");
  });

  it("keeps the answers but empties the link when the student code is deleted", async () => {
    const { sessionId, pulseId } = await insertPulseSetup(db());
    const studentA = await insertStudent(db(), sessionId);
    const studentB = await insertStudent(db(), sessionId);
    for (const [student, p2] of [
      [studentA, 2],
      [studentB, 6],
    ] as const) {
      await db().query(
        "INSERT INTO response (pulse_id, student_session_id, p2) VALUES ($1, $2, $3)",
        [pulseId, student, p2],
      );
    }

    await db().query("DELETE FROM student_session WHERE class_session_id = $1", [sessionId]);

    const { rows } = await db().query(
      "SELECT student_session_id, p2 FROM response WHERE pulse_id = $1 ORDER BY p2",
      [pulseId],
    );
    expect(rows).toEqual([
      { student_session_id: null, p2: 2 },
      { student_session_id: null, p2: 6 },
    ]);
  });
});

describe("fracture_alert", () => {
  it("stores the counts and the settings it was judged by", async () => {
    const { pulseId } = await insertPulseSetup(db());
    await db().query(
      `INSERT INTO fracture_alert
         (pulse_id, rating_count, lost_count, lost_cutoff, alert_bar_percent, min_group_size)
       VALUES ($1, 12, 4, 3, 25, 3)`,
      [pulseId],
    );
    const { rows } = await db().query(
      `SELECT rating_count, lost_count, lost_cutoff, alert_bar_percent, min_group_size
       FROM fracture_alert WHERE pulse_id = $1`,
      [pulseId],
    );
    expect(rows[0]).toEqual({
      rating_count: 12,
      lost_count: 4,
      lost_cutoff: 3,
      alert_bar_percent: 25,
      min_group_size: 3,
    });
  });

  it("allows at most one alert per pulse", async () => {
    const { pulseId } = await insertPulseSetup(db());
    const insert = `INSERT INTO fracture_alert
        (pulse_id, rating_count, lost_count, lost_cutoff, alert_bar_percent, min_group_size)
      VALUES ($1, 12, 4, 3, 25, 3)`;
    await db().query(insert, [pulseId]);
    const error = await queryError(db(), insert, [pulseId]);
    expect(error.code).toBe(UNIQUE_VIOLATION);
    expect(error.constraint).toBe("fracture_alert_one_per_pulse");
  });

  it("rejects more lost students than rating students", async () => {
    const { pulseId } = await insertPulseSetup(db());
    const error = await queryError(
      db(),
      `INSERT INTO fracture_alert
         (pulse_id, rating_count, lost_count, lost_cutoff, alert_bar_percent, min_group_size)
       VALUES ($1, 3, 4, 3, 25, 3)`,
      [pulseId],
    );
    expect(error.code).toBe(CHECK_VIOLATION);
    expect(error.constraint).toBe("fracture_alert_lost_within_ratings");
  });
});

describe("walk_back", () => {
  it("records the concept walked back to and the confirmation time", async () => {
    const { sessionId, conceptId } = await insertPulseSetup(db());
    await db().query("INSERT INTO walk_back (class_session_id, concept_id) VALUES ($1, $2)", [
      sessionId,
      conceptId,
    ]);
    const { rows } = await db().query(
      "SELECT concept_id, confirmed_at FROM walk_back WHERE class_session_id = $1",
      [sessionId],
    );
    expect(rows[0].concept_id).toBe(conceptId);
    expect(rows[0].confirmed_at).toBeInstanceOf(Date);
  });
});
