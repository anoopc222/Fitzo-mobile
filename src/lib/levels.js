// Pure, client-side leveling system derived from the same `home` query data
// the achievements engine uses — no extra Supabase calls, tables, or storage.

const LEVEL_TITLE_KEYS = [
  'gamification.levelTitleRookie',
  'gamification.levelTitleBronze',
  'gamification.levelTitleSilver',
  'gamification.levelTitleGold',
  'gamification.levelTitlePlatinum',
  'gamification.levelTitleDiamond',
  'gamification.levelTitleElite',
  'gamification.levelTitleLegend',
];
const XP_PER_LEVEL = 150;

const XP_SOURCES = [
  { key: 'streak', labelKey: 'gamification.xpSourceStreak', perUnit: 10, value: (h) => Math.min(h.streak ?? 0, 60) },
  { key: 'sessions', labelKey: 'gamification.xpSourceSessions', perUnit: 25, value: (h) => h.thisWeek?.sessions ?? 0 },
  { key: 'stepGoalDays', labelKey: 'gamification.xpSourceStepGoalDays', perUnit: 15, value: (h) => h.thisWeek?.goalDays ?? 0 },
  { key: 'foodLogDays', labelKey: 'gamification.xpSourceFoodLogDays', perUnit: 10, value: (h) => h.thisWeek?.kcalDays ?? 0 },
  { key: 'stepGoalToday', labelKey: 'gamification.xpSourceStepGoalToday', perUnit: 20, value: (h) => (h.stepGoalMet ? 1 : 0) },
  { key: 'sleepGoalToday', labelKey: 'gamification.xpSourceSleepGoalToday', perUnit: 20, value: (h) => (h.sleepGoalMet ? 1 : 0) },
  { key: 'noSleepDebt', labelKey: 'gamification.xpSourceNoSleepDebt', perUnit: 15, value: (h) => (h.sleepDebt ? 0 : 1) },
];

export function computeXPBreakdown(home) {
  if (!home) return XP_SOURCES.map(s => ({ key: s.key, labelKey: s.labelKey, xp: 0 }));
  return XP_SOURCES.map(s => ({ key: s.key, labelKey: s.labelKey, xp: s.value(home) * s.perUnit }));
}

export function computeXP(home) {
  return computeXPBreakdown(home).reduce((sum, s) => sum + s.xp, 0);
}

export function computeLevel(xp) {
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = xp % XP_PER_LEVEL;
  const titleKey = LEVEL_TITLE_KEYS[Math.min(level - 1, LEVEL_TITLE_KEYS.length - 1)];
  return {
    level,
    titleKey,
    xp,
    xpIntoLevel,
    xpForNextLevel: XP_PER_LEVEL,
    progressPct: Math.round((xpIntoLevel / XP_PER_LEVEL) * 100),
  };
}
