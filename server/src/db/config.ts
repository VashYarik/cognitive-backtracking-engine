// Connection settings for PostgreSQL, shared by the migration script and the tests.
import type { ClientConfig } from "pg";

// Same host and port that compose.yaml publishes.
const DB_HOST = "127.0.0.1";
const DB_PORT = 5432;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. It is read from the .env file at the repo root.`);
  }
  return value;
}

export function dbConfig(database: string): ClientConfig {
  return {
    host: DB_HOST,
    port: DB_PORT,
    user: requireEnv("POSTGRES_USER"),
    password: requireEnv("POSTGRES_PASSWORD"),
    database,
  };
}
