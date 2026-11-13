// Builds the Fastify app: logging, error answers and the routes.
// The database pool is passed in, so tests can give it the test database.
import Fastify, { type FastifyInstance, LogController } from "fastify";
import type pg from "pg";
import { toHttpError } from "./http/db-errors.ts";

export type AppOptions = {
  // Where log lines go. Default: standard output. Tests pass a collector.
  logStream?: { write: (line: string) => void };
};

export function buildApp(db: pg.Pool, options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger:
      options.logStream === undefined
        ? { level: "info" }
        : { level: "info", stream: options.logStream },
    // Why: Fastify's automatic log line for each request records the client's
    // address and the time. For an answer request that would record when, and
    // from which device, one student answered, which the spec forbids
    // (section 5: response time is not recorded). So there are no automatic
    // request lines; only unexpected errors are logged, below.
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.setErrorHandler((error, request, reply) => {
    // A database rule refused the change: answer with the rule's name.
    const ruleError = toHttpError(error);
    if (ruleError !== null) {
      return reply.code(ruleError.status).send(ruleError.body);
    }

    // Fastify's own request errors (for example a body that does not match its
    // schema) carry a 4xx status. Answer without details.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request" });
    }

    // Anything else is a server fault. The client learns nothing about it.
    // The log gets the route pattern (no ids) and, for a database error, only
    // its code: PostgreSQL messages and details can contain row values, such
    // as a student code. Our own error messages never contain personal data.
    const code = (error as { code?: unknown }).code;
    const isDatabaseError = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
    request.log.error(
      isDatabaseError
        ? { route: request.routeOptions.url, code }
        : {
            route: request.routeOptions.url,
            message: error instanceof Error ? error.message : "non-error value thrown",
          },
      "unexpected error",
    );
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/api/health", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "database_unavailable" });
    }
  });

  return app;
}
