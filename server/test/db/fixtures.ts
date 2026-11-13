// Small helpers that insert rows for database tests, so each test only states
// what matters to it. Ids come back as strings: pg returns PostgreSQL bigint
// values as text, because a JavaScript number cannot hold every 64-bit integer.
import { randomUUID } from "node:crypto";
import type { Client, DatabaseError } from "pg";

export type Id = string;

// Random rather than counted: test files run at the same time, each in its own
// transaction, and equal emails or join codes would make them wait on each other.
function unique(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function insertReturningId(db: Client, sql: string, values: unknown[]): Promise<Id> {
  const { rows } = await db.query<{ id: Id }>(sql, values);
  return rows[0].id;
}

export function insertProfessor(db: Client): Promise<Id> {
  return insertReturningId(
    db,
    "INSERT INTO professor (email, password_hash) VALUES ($1, 'not-a-real-hash') RETURNING id",
    [`${unique("prof")}@example.test`],
  );
}

export async function insertCourse(db: Client): Promise<Id> {
  const professorId = await insertProfessor(db);
  return insertReturningId(
    db,
    "INSERT INTO course (professor_id, name) VALUES ($1, $2) RETURNING id",
    [professorId, unique("course")],
  );
}

export function insertConcept(
  db: Client,
  courseId: Id,
  options: { isRoot?: boolean; isCritical?: boolean } = {},
): Promise<Id> {
  return insertReturningId(
    db,
    `INSERT INTO concept (course_id, title, is_root, is_critical)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [courseId, unique("concept"), options.isRoot ?? false, options.isCritical ?? false],
  );
}

export async function insertPrerequisite(
  db: Client,
  courseId: Id,
  conceptId: Id,
  prerequisiteId: Id,
): Promise<void> {
  await db.query(
    "INSERT INTO prerequisite (course_id, concept_id, prerequisite_id) VALUES ($1, $2, $3)",
    [courseId, conceptId, prerequisiteId],
  );
}

// Marks the tree approved before inserting, so these helpers keep working once
// the database rejects sessions from unapproved trees (design decision 11).
export async function insertSession(
  db: Client,
  courseId: Id,
  options: { joinCode?: string; currentConceptId?: Id } = {},
): Promise<Id> {
  await db.query("UPDATE course SET tree_approved = true WHERE id = $1", [courseId]);
  return insertReturningId(
    db,
    `INSERT INTO class_session (course_id, join_code, current_concept_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [courseId, options.joinCode ?? unique("code"), options.currentConceptId ?? null],
  );
}

export function insertStudent(db: Client, sessionId: Id): Promise<string> {
  return insertReturningId(
    db,
    "INSERT INTO student_session (class_session_id) VALUES ($1) RETURNING id",
    [sessionId],
  );
}

export function insertPulse(db: Client, sessionId: Id, conceptId: Id): Promise<Id> {
  return insertReturningId(
    db,
    `INSERT INTO pulse (class_session_id, concept_id, wording_id, joined_count, window_seconds)
     VALUES ($1, $2, (SELECT min(id) FROM p1_wording), 0, 25) RETURNING id`,
    [sessionId, conceptId],
  );
}

// A course with a root concept, an approved tree, a session and one pulse.
export async function insertPulseSetup(db: Client) {
  const courseId = await insertCourse(db);
  const conceptId = await insertConcept(db, courseId, { isRoot: true });
  const sessionId = await insertSession(db, courseId);
  const pulseId = await insertPulse(db, sessionId, conceptId);
  return { courseId, conceptId, sessionId, pulseId };
}

// Runs a query that is expected to fail and returns the database error.
// A failed statement would cancel the whole test transaction, so the query runs
// inside a savepoint (a named point inside a transaction that can be rolled back
// to on its own), and the test can keep using the database afterwards.
export async function queryError(
  db: Client,
  sql: string,
  values: unknown[] = [],
): Promise<DatabaseError> {
  await db.query("SAVEPOINT expect_error");
  try {
    await db.query(sql, values);
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT expect_error");
    return error as DatabaseError;
  }
  await db.query("RELEASE SAVEPOINT expect_error");
  throw new Error(`Expected the query to fail, but it succeeded: ${sql}`);
}

// PostgreSQL error codes used in the tests.
export const CHECK_VIOLATION = "23514";
export const UNIQUE_VIOLATION = "23505";
export const FOREIGN_KEY_VIOLATION = "23503";
