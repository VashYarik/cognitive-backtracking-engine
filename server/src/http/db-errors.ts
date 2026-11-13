// Turns a database rule error into an HTTP answer that names the rule
// (docs/slice1-api.md, section 2), for example 409 { error: "prerequisite_no_loop" }.
// The apps turn rule names into plain sentences.

export type HttpError = { status: number; body: { error: string } };

// PostgreSQL error codes starting with "23" are "integrity constraint
// violations": a rule in the database refused the change. Our own trigger
// rules use 23514 (check_violation) and always carry a rule name.
const RULE_ERROR_CLASS = "23";

export function toHttpError(error: unknown): HttpError | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (
    typeof code !== "string" ||
    !code.startsWith(RULE_ERROR_CLASS) ||
    typeof constraint !== "string" ||
    constraint === ""
  ) {
    return null;
  }
  return { status: 409, body: { error: constraint } };
}
