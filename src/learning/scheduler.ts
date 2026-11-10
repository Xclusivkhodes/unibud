/**
 * SuperMemo SM-2, labeled deterministic-sm2.
 * Not ts-fsrs. ts-fsrs 6.0.0 declares engines.node >=24; this runtime is Node 22.
 * A review log is the evidence. The interval is not mastery.
 */
export const SCHEDULER_ID = "deterministic-sm2";

export type CardSchedule = {
  ease: number;
  intervalDays: number;
  repetitions: number;
  dueAt: string | null;
};

export function reviewSm2(card: CardSchedule, quality: number, reviewedAt: string, revealed: boolean): CardSchedule {
  if (!revealed) {
    throw new Error("reveal_required");
  }
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new Error("invalid_quality");
  }
  let { ease, intervalDays, repetitions } = card;
  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);
    repetitions += 1;
  }
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ease < 1.3) ease = 1.3;
  const due = new Date(reviewedAt);
  due.setUTCDate(due.getUTCDate() + intervalDays);
  return { ease, intervalDays, repetitions, dueAt: due.toISOString() };
}
