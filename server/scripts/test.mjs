// Starts Vitest from the folder's real spelling on disk.
// Why: on Windows, when the current folder starts with a lowercase drive
// letter ("c:\" instead of "C:\"), Vitest loads its own code twice and every
// test file fails with "Cannot read properties of undefined (reading 'config')".
// Upstream issue: vitest-dev/vitest#10812 (unfixed as of Vitest 5.1.0).
// realpathSync.native returns the path with the casing stored on disk.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";

const cwd = realpathSync.native(process.cwd());
const vitestCli = join(cwd, "node_modules", "vitest", "vitest.mjs");

// Extra arguments (for example "npm test -- fracture") are passed on to Vitest.
const result = spawnSync(
  process.execPath,
  [vitestCli, "run", ...process.argv.slice(2)],
  { cwd, stdio: "inherit" },
);

process.exit(result.status ?? 1);
