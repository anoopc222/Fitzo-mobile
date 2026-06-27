// Pure, client-side achievement derivation — no extra Supabase calls or
// tables. Badges are computed directly from the same `home` query data
// HomeScreen already fetches, so unlocking is always in sync with reality
// instead of needing a separate persisted "achievements" record.

const BADGES = [
  {
    id: 'streak-7',
    icon: '🔥',
    label: '7-Day Streak',
    description: 'Log steps 7 days in a row',
    isUnlocked: (h) => (h.streak ?? 0) >= 7,
  },
  {
    id: 'streak-30',
    icon: '🏆',
    label: '30-Day Streak',
    description: 'Log steps 30 days in a row',
    isUnlocked: (h) => (h.streak ?? 0) >= 30,
  },
  {
    id: 'streak-record',
    icon: '🥇',
    label: 'Personal Best',
    description: 'Match or beat your longest-ever streak',
    isUnlocked: (h) => (h.streak ?? 0) > 0 && (h.streak ?? 0) >= (h.longestStreak ?? 0),
  },
  {
    id: 'step-goal',
    icon: '👟',
    label: 'Goal Crusher',
    description: "Hit today's step goal",
    isUnlocked: (h) => !!h.stepGoalMet,
  },
  {
    id: 'sleep-goal',
    icon: '🌙',
    label: 'Well Rested',
    description: "Hit last night's sleep goal",
    isUnlocked: (h) => !!h.sleepGoalMet,
  },
  {
    id: 'weekly-workouts',
    icon: '💪',
    label: 'Consistency King',
    description: 'Hit your weekly workout goal',
    isUnlocked: (h) => (h.thisWeek?.sessions ?? 0) >= (h.weeklyGoal ?? Infinity),
  },
  {
    id: 'pr-watch',
    icon: '📈',
    label: 'Strength Gains',
    description: 'Within range of a new all-time PR',
    isUnlocked: (h) => !!h.prWatch,
  },
  {
    id: 'no-sleep-debt',
    icon: '☀️',
    label: 'Recovered',
    description: 'No sleep debt this week',
    isUnlocked: (h) => !h.sleepDebt,
  },
];

export function computeAchievements(home) {
  if (!home) return BADGES.map(b => ({ ...b, unlocked: false }));
  return BADGES.map(b => ({ ...b, unlocked: b.isUnlocked(home) }));
}
