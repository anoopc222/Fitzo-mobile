// Pure, client-side achievement derivation — no extra Supabase calls or
// tables. Badges are computed directly from the same `home` query data
// HomeScreen already fetches, so unlocking is always in sync with reality
// instead of needing a separate persisted "achievements" record.
//
// Labels/descriptions/details are returned as i18n key+params pairs (not
// raw strings) since this module has no access to useTranslation() —
// consumers resolve them with t() at render time.

const BADGES = [
  {
    id: 'streak-7',
    icon: '🔥',
    labelKey: 'gamification.achStreak7Label',
    descriptionKey: 'gamification.achStreak7Description',
    isUnlocked: (h) => (h.streak ?? 0) >= 7,
    detail: (h) => {
      const streak = h.streak ?? 0;
      return streak >= 7
        ? { key: 'gamification.achStreak7DetailUnlocked', params: { streak } }
        : { key: 'gamification.achStreak7DetailLocked', params: { streak } };
    },
  },
  {
    id: 'streak-30',
    icon: '🏆',
    labelKey: 'gamification.achStreak30Label',
    descriptionKey: 'gamification.achStreak30Description',
    isUnlocked: (h) => (h.streak ?? 0) >= 30,
    detail: (h) => {
      const streak = h.streak ?? 0;
      return streak >= 30
        ? { key: 'gamification.achStreak30DetailUnlocked', params: { streak } }
        : { key: 'gamification.achStreak30DetailLocked', params: { streak } };
    },
  },
  {
    id: 'streak-record',
    icon: '🥇',
    labelKey: 'gamification.achStreakRecordLabel',
    descriptionKey: 'gamification.achStreakRecordDescription',
    isUnlocked: (h) => (h.streak ?? 0) > 0 && (h.streak ?? 0) >= (h.longestStreak ?? 0),
    detail: (h) => {
      const streak = h.streak ?? 0;
      const best = h.longestStreak ?? 0;
      return streak > 0 && streak >= best
        ? { key: 'gamification.achStreakRecordDetailUnlocked', params: { streak } }
        : { key: 'gamification.achStreakRecordDetailLocked', params: { streak, best } };
    },
  },
  {
    id: 'step-goal',
    icon: '👟',
    labelKey: 'gamification.achStepGoalLabel',
    descriptionKey: 'gamification.achStepGoalDescription',
    isUnlocked: (h) => !!h.stepGoalMet,
    detail: (h) => (h.stepGoalMet
      ? { key: 'gamification.achStepGoalDetailUnlocked' }
      : { key: 'gamification.achStepGoalDetailLocked' }),
  },
  {
    id: 'sleep-goal',
    icon: '🌙',
    labelKey: 'gamification.achSleepGoalLabel',
    descriptionKey: 'gamification.achSleepGoalDescription',
    isUnlocked: (h) => !!h.sleepGoalMet,
    detail: (h) => (h.sleepGoalMet
      ? { key: 'gamification.achSleepGoalDetailUnlocked' }
      : { key: 'gamification.achSleepGoalDetailLocked' }),
  },
  {
    id: 'weekly-workouts',
    icon: '💪',
    labelKey: 'gamification.achWeeklyWorkoutsLabel',
    descriptionKey: 'gamification.achWeeklyWorkoutsDescription',
    isUnlocked: (h) => (h.thisWeek?.sessions ?? 0) >= (h.weeklyGoal ?? Infinity),
    detail: (h) => {
      const sessions = h.thisWeek?.sessions ?? 0;
      const goal = h.weeklyGoal ?? 0;
      return sessions >= goal
        ? { key: 'gamification.achWeeklyWorkoutsDetailUnlocked', params: { sessions, goal } }
        : { key: 'gamification.achWeeklyWorkoutsDetailLocked', params: { sessions, goal, remaining: Math.max(goal - sessions, 0) } };
    },
  },
  {
    id: 'pr-watch',
    icon: '📈',
    labelKey: 'gamification.achPrWatchLabel',
    descriptionKey: 'gamification.achPrWatchDescription',
    isUnlocked: (h) => !!h.prWatch,
    detail: (h) => (h.prWatch
      ? { key: 'gamification.achPrWatchDetailUnlocked', params: { exercise: h.prWatch.exercise_name } }
      : { key: 'gamification.achPrWatchDetailLocked' }),
  },
  {
    id: 'no-sleep-debt',
    icon: '☀️',
    labelKey: 'gamification.achNoSleepDebtLabel',
    descriptionKey: 'gamification.achNoSleepDebtDescription',
    isUnlocked: (h) => !h.sleepDebt,
    detail: (h) => (!h.sleepDebt
      ? { key: 'gamification.achNoSleepDebtDetailUnlocked' }
      : { key: 'gamification.achNoSleepDebtDetailLocked' }),
  },
];

export function computeAchievements(home) {
  if (!home) return BADGES.map(b => ({ ...b, unlocked: false, detail: { key: b.descriptionKey } }));
  return BADGES.map(b => ({ ...b, unlocked: b.isUnlocked(home), detail: b.detail(home) }));
}
