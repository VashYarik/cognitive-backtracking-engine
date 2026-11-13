// Starts the server. Run with: npm start   (reads the database login from the root .env)
import pg from "pg";
import { buildApp } from "./app.ts";
import { dbConfig, requireEnv } from "./db/config.ts";

// 127.0.0.1 only: reachable from this computer, not from the network,
// the same as the database in compose.yaml.
const HOST = "127.0.0.1";
const PORT = 3000;

const pool = new pg.Pool(dbConfig(requireEnv("POSTGRES_DB")));
const app = buildApp(pool);

// Ctrl+C: stop taking requests, then close the database connections.
process.on("SIGINT", () => {
  app
    .close()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});

await app.listen({ host: HOST, port: PORT });
