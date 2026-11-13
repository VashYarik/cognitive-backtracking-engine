// Turning database rule errors into HTTP answers (docs/slice1-api.md, section 2).
import { describe, expect, it } from "vitest";
import { toHttpError } from "../../src/http/db-errors.ts";

// The shape pg gives a database error: a five-character code and, for rule
// errors, the name of the rule (constraint) that refused the change.
function dbError(code: string, constraint?: string): Error {
  return Object.assign(new Error("database error"), { code, constraint });
}

describe("toHttpError", () => {
  it.each([
    ["check rule", "23514", "tree_locked_during_session"],
    ["unique rule", "23505", "concept_one_root_per_course"],
    ["foreign key rule", "23503", "class_session_current_concept_in_course"],
  ])("turns a %s into 409 with the rule name", (_label, code, constraint) => {
    expect(toHttpError(dbError(code, constraint))).toEqual({
      status: 409,
      body: { error: constraint },
    });
  });

  it("returns null for a rule error without a rule name", () => {
    expect(toHttpError(dbError("23502"))).toBeNull();
  });

  it("returns null for a database error that is not a rule error", () => {
    expect(toHttpError(dbError("42P01", "anything"))).toBeNull();
  });

  it("returns null for an ordinary error", () => {
    expect(toHttpError(new Error("something broke"))).toBeNull();
  });

  it("returns null for something that is not an error at all", () => {
    expect(toHttpError("a string")).toBeNull();
  });
});
