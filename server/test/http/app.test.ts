// The server skeleton: health check, error answers, and what is logged.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { dbConfig } from "../../src/db/config.ts";
import { loadTestEnv, testDatabaseName } from "../db/test-database.ts";

let pool: pg.Pool;

beforeAll(() => {
  loadTestEnv();
  pool = new pg.Pool(dbConfig(testDatabaseName()));
});

afterAll(async () => {
  await pool.end();
});

// Collects everything the app logs, one entry per log line.
function captureLogs() {
  const lines: string[] = [];
  return { lines, stream: { write: (line: string) => void lines.push(line) } };
}

describe("GET /api/health", () => {
  it("answers ok when the database is reachable", async () => {
    const app = buildApp(pool);
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("answers 503 when the database cannot be reached", async () => {
    // Port 1: nothing listens there, so every connection is refused.
    const deadPool = new pg.Pool({ ...dbConfig(testDatabaseName()), port: 1 });
    const app = buildApp(deadPool);
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "database_unavailable" });
    await app.close();
    await deadPool.end();
  });
});

describe("error answers", () => {
  it("answers 409 with the rule name when a database rule refuses a change", async () => {
    const app = buildApp(pool);
    app.get("/test/rule", async () => {
      await pool.query(
        `DO $$ BEGIN
           RAISE EXCEPTION 'refused' USING ERRCODE = 'check_violation', CONSTRAINT = 'some_rule';
         END $$`,
      );
    });
    const response = await app.inject({ method: "GET", url: "/test/rule" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "some_rule" });
    await app.close();
  });

  it("answers 400 without details when a request body does not match its schema", async () => {
    const app = buildApp(pool);
    app.post(
      "/test/schema",
      {
        schema: {
          body: {
            type: "object",
            required: ["p2"],
            properties: { p2: { type: "integer", minimum: 1, maximum: 7 } },
          },
        },
      },
      async () => ({ ok: true }),
    );
    const response = await app.inject({ method: "POST", url: "/test/schema", payload: { p2: 9 } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "bad_request" });
    await app.close();
  });

  it("answers 500 without the error's message for an unexpected error", async () => {
    const app = buildApp(pool, { logStream: captureLogs().stream });
    app.get("/test/crash", async () => {
      throw new Error("internal detail that must not reach the client");
    });
    const response = await app.inject({ method: "GET", url: "/test/crash" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "internal_error" });
    await app.close();
  });
});

describe("logging (CLAUDE.md section 7; spec section 5)", () => {
  it("writes no log line for a normal request", async () => {
    const logs = captureLogs();
    const app = buildApp(pool, { logStream: logs.stream });
    await app.inject({ method: "GET", url: "/api/health" });
    await app.close();
    // Only start-up/shutdown lines may appear, never one about the request.
    expect(logs.lines.filter((line) => line.includes("/api/health"))).toEqual([]);
  });

  it("never logs the student code, the request body or the client address", async () => {
    const logs = captureLogs();
    const app = buildApp(pool, { logStream: logs.stream });
    app.post("/test/answer", async () => {
      // A database error whose extra fields hold row values, as PostgreSQL's do.
      throw Object.assign(new Error("database failure"), {
        code: "XX000",
        detail: "Key (student_session_id)=(secret-student-code) already exists.",
      });
    });
    const response = await app.inject({
      method: "POST",
      url: "/test/answer",
      headers: { authorization: "Bearer secret-student-code" },
      payload: { p2: 5, note: "answer-body-marker" },
      remoteAddress: "203.0.113.7",
    });
    await app.close();

    expect(response.statusCode).toBe(500);
    const text = logs.lines.join("\n");
    expect(text).toContain("unexpected error");
    expect(text).not.toContain("secret-student-code");
    expect(text).not.toContain("answer-body-marker");
    expect(text).not.toContain("203.0.113.7");
  });
});
