# CBE Build Log
One row per build step: the time estimated before the step and the time it actually took. Purpose: compare estimates with reality and improve future estimates. Actual time is the working time from the start of the code to the passing checks; time spent waiting for a decision is not counted, and is noted where it mattered.

| Step | Date | What was built | Estimate (min) | Actual (min) | Notes |
|---|---|---|---|---|---|
| 1. Project skeleton | 2026-11-13 | `server/` with package.json, pinned dev dependencies (TypeScript 7.0.2, Vitest 5.0.5, Vite 8.3.5, @types/node 24.19.2), strict tsconfig, one setup test | 30 | 5 | Vitest failed when the current folder started with a lowercase drive letter (`c:\`), a known upstream bug (vitest-dev/vitest#10812). Fixed with `server/scripts/test.mjs`, approved by Yarik. |
