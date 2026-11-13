// The live number and the fracture rule (spec 4.6 to 4.8; design section 3).
// One function produces both, from the same ratings and settings, so the number
// the professor sees and the alert can never disagree (spec 4.8).
// Pure: the caller loads the ratings and settings and decides what to send.

// The lost cutoff depends on the concept the pulse was about (spec 4.7).
export function lostCutoffFor(
  isCritical: boolean,
  course: { lostCutoffOrdinary: number; lostCutoffCritical: number },
): number {
  return isCritical ? course.lostCutoffCritical : course.lostCutoffOrdinary;
}

export type PulseSettings = {
  lostCutoff: number; // a rating at or below this counts as lost
  alertBarPercent: number; // whole number, 1 to 100
  minGroupSize: number;
};

// Below the minimum group size the result carries no counts at all, so no
// later code can send a small group's numbers by mistake (spec 5, D27).
export type PulseResult =
  | { enoughRatings: false }
  | {
      enoughRatings: true;
      ratingCount: number;
      followingCount: number;
      lostCount: number;
      followingPercent: number; // whole number, rounded up
      fracture: boolean;
    };

// ratings: the P2 ratings of one pulse, one per student who gave a rating.
// P1 answers are never passed in: they do not count (spec 4.6, 4.7).
export function evaluatePulse(ratings: readonly number[], settings: PulseSettings): PulseResult {
  for (const rating of ratings) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 7) {
      throw new Error(`Invalid rating ${rating}: a rating is a whole number from 1 to 7.`);
    }
  }

  const ratingCount = ratings.length;
  if (ratingCount < settings.minGroupSize) {
    return { enoughRatings: false };
  }

  const lostCount = ratings.filter((rating) => rating <= settings.lostCutoff).length;
  const followingCount = ratingCount - lostCount;

  // Whole-number comparison, so no rounding can move a class across the bar:
  // lost / ratings >= bar / 100  is the same as  lost * 100 >= bar * ratings.
  const fracture = lostCount * 100 >= settings.alertBarPercent * ratingCount;

  // Rounded up (Yarik, 2026-11-13). The alert fires exactly when following is at
  // most (100 - bar) percent; because 100 - bar is a whole number, rounding up
  // keeps "displayed percentage <= 100 - bar" true exactly when the alert fires.
  // Ordinary rounding would show 75% for 75.4% while no alert fires.
  const followingPercent = Math.ceil((followingCount * 100) / ratingCount);

  return { enoughRatings: true, ratingCount, followingCount, lostCount, followingPercent, fracture };
}
