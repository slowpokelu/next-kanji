/**
 * SM-2 Spaced Repetition Algorithm
 *
 * Quality ratings:
 *   1 = Again (complete failure, reset)
 *   3 = Hard  (correct but difficult)
 *   4 = Good  (correct with some effort)
 *   5 = Easy  (effortless recall)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function createSrsEntry() {
  return {
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: Date.now(),
    lastReview: 0,
  };
}

export function reviewCard(entry, quality) {
  let { easeFactor, interval, repetitions } = entry;

  if (quality >= 3) {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions++;
  } else {
    repetitions = 0;
    interval = 1;
  }

  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  return {
    easeFactor,
    interval,
    repetitions,
    nextReview: Date.now() + interval * DAY_MS,
    lastReview: Date.now(),
  };
}

export function isDue(entry) {
  if (!entry) return true;
  return entry.nextReview <= Date.now();
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
  if (!entry || !entry.lastReview) return "New";
  const days = entry.interval;
  if (days === 0) return "New";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}
