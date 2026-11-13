// Temporary: proves that Vitest finds and runs test files in this folder.
// Delete this file once the first real test exists.
import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("runs a test", () => {
    expect(1 + 1).toBe(2);
  });
});
