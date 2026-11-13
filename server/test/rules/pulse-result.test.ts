// The live number and the fracture rule (spec 4.6 to 4.8, v1.5; design section 3).
import { describe, expect, it } from "vitest";
import {
  evaluatePulse,
  lostCutoffFor,
  type PulseSettings,
} from "../../src/rules/pulse-result.ts";

const COURSE_DEFAULTS = { lostCutoffOrdinary: 3, lostCutoffCritical: 5 };
const ORDINARY: PulseSettings = { lostCutoff: 3, alertBarPercent: 25, minGroupSize: 3 };

// n ratings of the same value.
function times(n: number, rating: number): number[] {
  return Array.from({ length: n }, () => rating);
}

describe("lostCutoffFor", () => {
  it("uses the ordinary cutoff for an ordinary concept", () => {
    expect(lostCutoffFor(false, COURSE_DEFAULTS)).toBe(3);
  });

  it("uses the critical cutoff for a critical concept", () => {
    expect(lostCutoffFor(true, COURSE_DEFAULTS)).toBe(5);
  });
});

describe("evaluatePulse: the minimum group size", () => {
  // Privacy (spec 5, D27): below the minimum nothing about the group may leave
  // the server, so the result carries no counts at all.
  it("returns only enoughRatings: false below the minimum, with no counts", () => {
    expect(evaluatePulse([2, 6], ORDINARY)).toEqual({ enoughRatings: false });
  });

  it("returns only enoughRatings: false when there are no ratings", () => {
    expect(evaluatePulse([], ORDINARY)).toEqual({ enoughRatings: false });
  });

  it("shows the result at exactly the minimum", () => {
    expect(evaluatePulse([2, 6, 7], ORDINARY)).toEqual({
      enoughRatings: true,
      ratingCount: 3,
      followingCount: 2,
      lostCount: 1,
      followingPercent: 67,
      fracture: true,
    });
  });
});

describe("evaluatePulse: following and lost", () => {
  it("counts a rating equal to the cutoff as lost, and one above it as following", () => {
    const result = evaluatePulse([3, 3, 4, 4], ORDINARY);
    expect(result).toMatchObject({ followingCount: 2, lostCount: 2 });
  });

  it("uses the stricter cutoff for a critical concept", () => {
    const critical = { ...ORDINARY, lostCutoff: 5 };
    expect(evaluatePulse([5, 5, 6, 6], critical)).toMatchObject({ followingCount: 2, lostCount: 2 });
  });

  it("matches the spec example: Following 18 of 24 (75%)", () => {
    const ratings = [...times(18, 6), ...times(6, 2)];
    expect(evaluatePulse(ratings, ORDINARY)).toEqual({
      enoughRatings: true,
      ratingCount: 24,
      followingCount: 18,
      lostCount: 6,
      followingPercent: 75,
      fracture: true,
    });
  });
});

describe("evaluatePulse: the fracture rule", () => {
  it("fires at exactly the alert bar: 1 lost of 4 is 25%", () => {
    expect(evaluatePulse([1, 7, 7, 7], ORDINARY)).toMatchObject({ fracture: true });
  });

  it("does not fire just below the bar: 1 lost of 5 is 20%", () => {
    expect(evaluatePulse([1, 7, 7, 7, 7], ORDINARY)).toMatchObject({ fracture: false });
  });

  it("does not fire below the minimum group, even if everyone is lost", () => {
    expect(evaluatePulse([1, 1], ORDINARY)).toEqual({ enoughRatings: false });
  });

  it("follows a changed alert bar", () => {
    const strict = { ...ORDINARY, alertBarPercent: 50 };
    expect(evaluatePulse([1, 7, 7, 7], strict)).toMatchObject({ fracture: false });
    expect(evaluatePulse([1, 1, 7, 7], strict)).toMatchObject({ fracture: true });
  });
});

describe("evaluatePulse: rounding", () => {
  it("rounds the following percentage up: 2 of 3 is 66.7%, shown as 67%", () => {
    expect(evaluatePulse([7, 7, 1], ORDINARY)).toMatchObject({ followingPercent: 67 });
  });

  it("rounds up just below 75%: 74 of 99 is 74.7%, shown as 75%, and the alert fires", () => {
    const ratings = [...times(74, 7), ...times(25, 1)];
    expect(evaluatePulse(ratings, ORDINARY)).toMatchObject({ followingPercent: 75, fracture: true });
  });

  it("rounds up just above 75%: 76 of 101 is 75.2%, shown as 76%, and no alert fires", () => {
    const ratings = [...times(76, 7), ...times(25, 1)];
    expect(evaluatePulse(ratings, ORDINARY)).toMatchObject({ followingPercent: 76, fracture: false });
  });
});

describe("evaluatePulse: the number and the alert never disagree (spec 4.8)", () => {
  // The alert fires exactly when the displayed following percentage is at most
  // 100 - bar. Checked for every class size from the minimum to 40, every
  // possible number of lost students, and several alert bars.
  it("holds for every combination", () => {
    for (const alertBarPercent of [1, 10, 25, 30, 33, 50, 75, 100]) {
      const settings = { ...ORDINARY, alertBarPercent };
      for (let size = settings.minGroupSize; size <= 40; size += 1) {
        for (let lost = 0; lost <= size; lost += 1) {
          const result = evaluatePulse([...times(lost, 1), ...times(size - lost, 7)], settings);
          if (!result.enoughRatings) {
            throw new Error(`unexpected: not enough ratings for size ${size}`);
          }
          expect(result.followingPercent <= 100 - alertBarPercent).toBe(result.fracture);
        }
      }
    }
  });
});

describe("evaluatePulse: invalid ratings", () => {
  it.each([0, 8, 2.5, Number.NaN])("rejects a rating of %s", (bad) => {
    expect(() => evaluatePulse([4, 4, bad], ORDINARY)).toThrow();
  });
});
