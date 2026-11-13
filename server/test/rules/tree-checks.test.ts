// The tree checks run when the professor taps Approve (spec 3.2, D21; v1.6 goal).
import { describe, expect, it } from "vitest";
import {
  checkTree,
  type ConceptNode,
  type PrerequisiteLink,
} from "../../src/rules/tree-checks.ts";

// Short builders: concept("a") is an ordinary concept; root and goal flags as named.
function concept(id: string, flags: { root?: boolean; goal?: boolean } = {}): ConceptNode {
  return { id, isRoot: flags.root ?? false, isGoal: flags.goal ?? false };
}
// needs("b", "a") means "b needs a".
function needs(conceptId: string, prerequisiteId: string): PrerequisiteLink {
  return { conceptId, prerequisiteId };
}

describe("checkTree: trees that pass", () => {
  it("passes a valid tree with a diamond and concepts past the goal", () => {
    // r (root) <- a <- b, a <- c, b + c <- g (goal) <- p (past the goal)
    const concepts = [
      concept("r", { root: true }),
      concept("a"),
      concept("b"),
      concept("c"),
      concept("g", { goal: true }),
      concept("p"),
    ];
    const links = [
      needs("a", "r"),
      needs("b", "a"),
      needs("c", "a"),
      needs("g", "b"),
      needs("g", "c"),
      needs("p", "g"),
    ];
    expect(checkTree(concepts, links)).toEqual({ passed: true });
  });

  it("passes a course with one concept that is both root and goal", () => {
    expect(checkTree([concept("r", { root: true, goal: true })], [])).toEqual({ passed: true });
  });
});

describe("checkTree: one_root", () => {
  it("fails when there is no root", () => {
    const result = checkTree([concept("a", { goal: true })], []);
    expect(result).toEqual({
      passed: false,
      failures: [{ check: "one_root", conceptIds: [] }],
    });
  });

  it("fails when there are two roots, naming both", () => {
    const result = checkTree(
      [concept("r1", { root: true, goal: true }), concept("r2", { root: true })],
      [],
    );
    expect(result).toEqual({
      passed: false,
      failures: [{ check: "one_root", conceptIds: ["r1", "r2"] }],
    });
  });

  it("fails an empty tree on both one_root and one_goal", () => {
    expect(checkTree([], [])).toEqual({
      passed: false,
      failures: [
        { check: "one_root", conceptIds: [] },
        { check: "one_goal", conceptIds: [] },
      ],
    });
  });
});

describe("checkTree: no_loops", () => {
  it("names the two concepts of a direct loop", () => {
    const concepts = [concept("r", { root: true, goal: true }), concept("a"), concept("b")];
    const links = [needs("a", "r"), needs("a", "b"), needs("b", "a")];
    expect(checkTree(concepts, links)).toEqual({
      passed: false,
      failures: [{ check: "no_loops", conceptIds: ["a", "b"] }],
    });
  });

  it("names the three concepts of a longer loop, and not a concept that only depends on it", () => {
    // a -> b -> c -> a is the loop; d needs a but is not part of the loop.
    const concepts = [
      concept("r", { root: true, goal: true }),
      concept("a"),
      concept("b"),
      concept("c"),
      concept("d"),
    ];
    const links = [
      needs("a", "r"),
      needs("a", "b"),
      needs("b", "c"),
      needs("c", "a"),
      needs("d", "a"),
    ];
    expect(checkTree(concepts, links)).toEqual({
      passed: false,
      failures: [{ check: "no_loops", conceptIds: ["a", "b", "c"] }],
    });
  });
});

describe("checkTree: all_lead_to_root", () => {
  it("names a concept with no prerequisites that is not the root", () => {
    const concepts = [concept("r", { root: true, goal: true }), concept("a")];
    expect(checkTree(concepts, [])).toEqual({
      passed: false,
      failures: [{ check: "all_lead_to_root", conceptIds: ["a"] }],
    });
  });

  it("names a concept whose only prerequisite does not lead to the root", () => {
    const concepts = [concept("r", { root: true, goal: true }), concept("a"), concept("b")];
    expect(checkTree(concepts, [needs("b", "a")])).toEqual({
      passed: false,
      failures: [{ check: "all_lead_to_root", conceptIds: ["a", "b"] }],
    });
  });

  it("reports a loop that is not attached to the root under both checks", () => {
    const concepts = [concept("r", { root: true, goal: true }), concept("a"), concept("b")];
    const links = [needs("a", "b"), needs("b", "a")];
    expect(checkTree(concepts, links)).toEqual({
      passed: false,
      failures: [
        { check: "no_loops", conceptIds: ["a", "b"] },
        { check: "all_lead_to_root", conceptIds: ["a", "b"] },
      ],
    });
  });

  it("is skipped when there is not exactly one root", () => {
    const result = checkTree([concept("a", { goal: true }), concept("b")], []);
    expect(result).toEqual({
      passed: false,
      failures: [{ check: "one_root", conceptIds: [] }],
    });
  });
});

describe("checkTree: one_goal", () => {
  it("fails when there is no goal", () => {
    expect(checkTree([concept("r", { root: true })], [])).toEqual({
      passed: false,
      failures: [{ check: "one_goal", conceptIds: [] }],
    });
  });

  it("fails when there are two goals, naming both", () => {
    const concepts = [concept("r", { root: true, goal: true }), concept("a", { goal: true })];
    expect(checkTree(concepts, [needs("a", "r")])).toEqual({
      passed: false,
      failures: [{ check: "one_goal", conceptIds: ["r", "a"] }],
    });
  });
});

describe("checkTree: several problems at once", () => {
  it("reports every failed check, in the fixed order", () => {
    // Root present; a and b form a loop off the root; c is unlinked; no goal.
    const concepts = [concept("r", { root: true }), concept("a"), concept("b"), concept("c")];
    const links = [needs("a", "b"), needs("b", "a")];
    expect(checkTree(concepts, links)).toEqual({
      passed: false,
      failures: [
        { check: "no_loops", conceptIds: ["a", "b"] },
        { check: "all_lead_to_root", conceptIds: ["a", "b", "c"] },
        { check: "one_goal", conceptIds: [] },
      ],
    });
  });
});
