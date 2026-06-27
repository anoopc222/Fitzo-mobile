// Pure, client-side leveling system derived from the same `home` query data
// the achievements engine uses — no extra Supabase calls, tables, or storage.

const LEVEL_TITLES = ['Rookie', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite', 'Legend'];
const XP_PER_LEVEL = 150;

const XP_SOURCES = [
  { key: 'streak', label: 'Daily streak', perUnit: 10, value: (h) => Math.min(h.streak ?? 0, 60) },
  { key: 'sessions', label: 'Workouts this week', perUnit: 25, value: (h) => h.thisWeek?.sessions ?? 0 },
  { key: 'stepGoalDays', label: 'Step goal days this week', perUnit: 15, value: (h) => h.thisWeek?.goalDays ?? 0 },
  { key: 'foodLogDays', label: 'Food log days this week', perUnit: 10, value: (h) => h.thisWeek?.kcalDays ?? 0 },
  { key: 'stepGoalToday', label: "Today's step goal", perUnit: 20, value: (h) => (h.stepGoalMet ? 1 : 0) },
  { key: 'sleepGoalToday', label: "Last night's sleep goal", perUnit: 20, value: (h) => (h.sleepGoalMet ? 1 : 0) },
  { key: 'noSleepDebt', label: 'No sleep debt', perUnit: 15, value: (h) => (h.sleepDebt ? 0 : 1) },
];

export function computeXPBreakdown(home) {
  if (!home) return XP_SOURCES.map(s => ({ key: s.key, label: s.label, xp: 0 }));
  return XP_SOURCES.map(s => ({ key: s.key, label: s.label, xp: s.value(home) * s.perUnit }));
}

export function computeXP(home) {
  return computeXPBreakdown(home).reduce((sum, s) => sum + s.xp, 0);
}

export function computeLevel(xp) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;
  const title = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
  return {
    level,
    title,
    xp,
    xpIntoLevel,
    xpForNextLevel: XP_PER_LEVEL,
    progressPct: Math.round((xpIntoLevel / XP_PER_LEVEL) * 100),
  };
}
