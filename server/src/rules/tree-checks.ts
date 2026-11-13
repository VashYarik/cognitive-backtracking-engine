// The checks a concept tree must pass before the professor can approve it
// (spec 3.2 and D21; the goal check is from spec v1.6, 3.6).
// Pure: tree data in, result out. The database is not read here; the caller
// loads the concepts and links and, if the tree passes, sets tree_approved.
// The lecture-segment check is not part of slice 1.

export type ConceptNode = { id: string; isRoot: boolean; isGoal: boolean };

// "conceptId needs prerequisiteId".
export type PrerequisiteLink = { conceptId: string; prerequisiteId: string };

export type TreeCheckName = "one_root" | "no_loops" | "all_lead_to_root" | "one_goal";

// conceptIds names the concepts involved, in the order the concepts were given.
// For one_root and one_goal it lists the roots or goals found (empty if none).
export type TreeCheckFailure = { check: TreeCheckName; conceptIds: string[] };

export type TreeCheckResult = { passed: true } | { passed: false; failures: TreeCheckFailure[] };

// Every check runs and every failure is reported, so the professor can fix all
// problems in one pass (Yarik, 2026-11-13). Failures come in this fixed order:
// one_root, no_loops, all_lead_to_root, one_goal.
export function checkTree(
  concepts: readonly ConceptNode[],
  links: readonly PrerequisiteLink[],
): TreeCheckResult {
  const failures: TreeCheckFailure[] = [];

  const roots = concepts.filter((c) => c.isRoot).map((c) => c.id);
  if (roots.length !== 1) {
    failures.push({ check: "one_root", conceptIds: roots });
  }

  // prerequisitesOf: concept -> the concepts it needs.
  // dependentsOf: concept -> the concepts that need it.
  const prerequisitesOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const link of links) {
    addTo(prerequisitesOf, link.conceptId, link.prerequisiteId);
    addTo(dependentsOf, link.prerequisiteId, link.conceptId);
  }

  // A concept is in a loop if walking its prerequisites leads back to itself.
  // (A concept that only depends on a loop never returns to itself, so it is not named.)
  const inLoop = concepts
    .filter((c) => reachableFrom(prerequisitesOf.get(c.id) ?? [], prerequisitesOf).has(c.id))
    .map((c) => c.id);
  if (inLoop.length > 0) {
    failures.push({ check: "no_loops", conceptIds: inLoop });
  }

  // Only meaningful with exactly one root. The concepts that lead to the root are
  // the root and everything that needs it, directly or through other concepts.
  if (roots.length === 1) {
    const root = roots[0];
    const leadToRoot = reachableFrom([root], dependentsOf);
    leadToRoot.add(root);
    const notLeading = concepts.filter((c) => !leadToRoot.has(c.id)).map((c) => c.id);
    if (notLeading.length > 0) {
      failures.push({ check: "all_lead_to_root", conceptIds: notLeading });
    }
  }

  const goals = concepts.filter((c) => c.isGoal).map((c) => c.id);
  if (goals.length !== 1) {
    failures.push({ check: "one_goal", conceptIds: goals });
  }

  return failures.length === 0 ? { passed: true } : { passed: false, failures };
}

function addTo(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}

// Breadth-first walk: every concept reachable from the start concepts by
// following the edges, including the start concepts themselves. The visited
// set stops the walk from going round a loop forever.
function reachableFrom(start: readonly string[], edges: Map<string, string[]>): Set<string> {
  const visited = new Set<string>(start);
  const queue = [...start];
  // The queue only grows; i moves through it, so each concept is handled once.
  for (let i = 0; i < queue.length; i += 1) {
    for (const next of edges.get(queue[i]) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}
