// Applies new migrations to the development database.
// Run with: npm run migrate   (reads the database login from the root .env)
import pg from "pg";
import { applyMigrations } from "./apply-migrations.ts";
import { dbConfig, requireEnv } from "./config.ts";

async function main(): Promise<void> {
  const client = new pg.Client(dbConfig(requireEnv("POSTGRES_DB")));
  await client.connect();
  try {
    const applied = await applyMigrations(client);
    for (const file of applied) {
      console.log(`Applied ${file}`);
    }
    console.log(
      applied.length === 0 ? "No new migrations." : `Applied ${applied.length} migration(s).`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
