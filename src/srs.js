/**
 * FSRS (Free Spaced Repetition Scheduler) adapter
 *
 * The app's callers still use quality numbers 1/3/4/5 (Again/Hard/Good/Easy)
 * from the SM-2 era — we map those to FSRS Rating internally so the public
 * API stays stable.
 */

import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
} from "ts-fsrs";

const params = generatorParameters({
  enable_fuzz: true,
  request_retention: 0.9,
});
const scheduler = fsrs(params);

const QUALITY_TO_RATING = {
  1: Rating.Again,
  3: Rating.Hard,
  4: Rating.Good,
  5: Rating.Easy,
};

function serializeCard(c) {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review ? c.last_review.toISOString() : undefined,
  };
}

function deserializeCard(entry) {
  if (!entry) return createEmptyCard(new Date());

  // Legacy SM-2 migration — preserve interval as initial stability
  if (entry.easeFactor !== undefined) {
    const card = createEmptyCard(new Date());
    if (entry.interval > 0) {
      card.stability = Math.max(0.5, entry.interval);
      card.scheduled_days = entry.interval;
      card.state = State.Review;
      card.reps = entry.repetitions || 0;
      card.due = new Date(entry.nextReview || Date.now());
      if (entry.lastReview) card.last_review = new Date(entry.lastReview);
    }
    return card;
  }

  return {
    due: new Date(entry.due),
    stability: entry.stability,
    difficulty: entry.difficulty,
    elapsed_days: entry.elapsed_days || 0,
    scheduled_days: entry.scheduled_days || 0,
    learning_steps: entry.learning_steps || 0,
    reps: entry.reps || 0,
    lapses: entry.lapses || 0,
    state: entry.state ?? State.New,
    last_review: entry.last_review ? new Date(entry.last_review) : undefined,
  };
}

export function createSrsEntry() {
  return serializeCard(createEmptyCard(new Date()));
}

export function reviewCard(entry, quality) {
  const rating = QUALITY_TO_RATING[quality];
  if (!rating) return entry;
  const card = deserializeCard(entry);
  const result = scheduler.next(card, new Date(), rating);
  return serializeCard(result.card);
}

export function isDue(entry) {
  if (!entry) return true;
  const due = entry.easeFactor !== undefined ? entry.nextReview : entry.due;
  return new Date(due) <= new Date();
}

export function getDueKanji(kanjiData, knownSet, srsData) {
  return kanjiData.filter((k) => {
    if (!knownSet.has(k.Kanji)) return false;
    return isDue(srsData[k.Kanji]);
  });
}

export function getDueCount(kanjiData, knownSet, srsData) {
  return getDueKanji(kanjiData, knownSet, srsData).length;
}

export function formatInterval(entry) {
  if (!entry) return "New";

  // Legacy SM-2 shape
  if (entry.easeFactor !== undefined) {
    if (!entry.lastReview) return "New";
    const days = entry.interval;
    if (days === 0) return "New";
    if (days === 1) return "1 day";
    if (days < 30) return `${days} days`;
    if (days < 365) return `${Math.round(days / 30)} mo`;
    return `${(days / 365).toFixed(1)} yr`;
  }

  // FSRS shape
  if (entry.state === State.New || entry.state === 0 || !entry.last_review) {
    return "New";
  }
  const days = entry.scheduled_days;
  if (days < 1) {
    const mins = Math.max(1, Math.round(days * 24 * 60));
    return `${mins}m`;
  }
  const rounded = Math.round(days);
  if (rounded === 1) return "1 day";
  if (rounded < 30) return `${rounded} days`;
  if (rounded < 365) return `${Math.round(rounded / 30)} mo`;
  return `${(rounded / 365).toFixed(1)} yr`;
}

/**
 * One-time migration helper — returns a new srsData object with legacy
 * SM-2 entries converted to FSRS shape. Idempotent on already-new entries.
 */
export function migrateSrsData(srsData) {
  let changed = false;
  const migrated = {};
  for (const key of Object.keys(srsData)) {
    const entry = srsData[key];
    if (entry && entry.easeFactor !== undefined) {
      migrated[key] = serializeCard(deserializeCard(entry));
      changed = true;
    } else {
      migrated[key] = entry;
    }
  }
  return { data: migrated, changed };
}
