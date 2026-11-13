import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Prepares the test database once before all test files run.
    globalSetup: ["./test/db/global-setup.ts"],
  },
});
