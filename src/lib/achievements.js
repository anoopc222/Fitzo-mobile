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
    detail: (h) => {
      const streak = h.streak ?? 0;
      return streak >= 7
        ? `You've logged steps for ${streak} days in a row. Nice consistency!`
        : `${streak}/7 days logged in a row. Log your steps again tomorrow to keep the streak alive.`;
    },
  },
  {
    id: 'streak-30',
    icon: '🏆',
    label: '30-Day Streak',
    description: 'Log steps 30 days in a row',
    isUnlocked: (h) => (h.streak ?? 0) >= 30,
    detail: (h) => {
      const streak = h.streak ?? 0;
      return streak >= 30
        ? `You've logged steps for ${streak} days straight — a full month of consistency!`
        : `${streak}/30 days logged in a row. Keep your daily step log going to reach 30.`;
    },
  },
  {
    id: 'streak-record',
    icon: '🥇',
    label: 'Personal Best',
    description: 'Match or beat your longest-ever streak',
    isUnlocked: (h) => (h.streak ?? 0) > 0 && (h.streak ?? 0) >= (h.longestStreak ?? 0),
    detail: (h) => {
      const streak = h.streak ?? 0;
      const best = h.longestStreak ?? 0;
      return streak > 0 && streak >= best
        ? `Your current streak of ${streak} days matches or beats your all-time best!`
        : `Your current streak is ${streak} days. Your all-time best is ${best} days — beat it to unlock.`;
    },
  },
  {
    id: 'step-goal',
    icon: '👟',
    label: 'Goal Crusher',
    description: "Hit today's step goal",
    isUnlocked: (h) => !!h.stepGoalMet,
    detail: (h) => (h.stepGoalMet
      ? "You've hit today's step goal. Great work!"
      : "You haven't hit today's step goal yet. Log more steps today to unlock this."),
  },
  {
    id: 'sleep-goal',
    icon: '🌙',
    label: 'Well Rested',
    description: "Hit last night's sleep goal",
    isUnlocked: (h) => !!h.sleepGoalMet,
    detail: (h) => (h.sleepGoalMet
      ? "You hit last night's sleep goal. Well rested!"
      : "You didn't hit last night's sleep goal. Log a full night's sleep to unlock this."),
  },
  {
    id: 'weekly-workouts',
    icon: '💪',
    label: 'Consistency King',
    description: 'Hit your weekly workout goal',
    isUnlocked: (h) => (h.thisWeek?.sessions ?? 0) >= (h.weeklyGoal ?? Infinity),
    detail: (h) => {
      const sessions = h.thisWeek?.sessions ?? 0;
      const goal = h.weeklyGoal ?? 0;
      return sessions >= goal
        ? `You've completed ${sessions}/${goal} workouts this week. Goal met!`
        : `${sessions}/${goal} workouts logged this week. Log ${Math.max(goal - sessions, 0)} more to unlock this.`;
    },
  },
  {
    id: 'pr-watch',
    icon: '📈',
    label: 'Strength Gains',
    description: 'Within range of a new all-time PR',
    isUnlocked: (h) => !!h.prWatch,
    detail: (h) => (h.prWatch
      ? `You're close to a new PR on ${h.prWatch.exercise_name ?? 'an exercise'}. Push for it in your next session!`
      : "No exercise is close to a new PR right now. Keep training to get within range."),
  },
  {
    id: 'no-sleep-debt',
    icon: '☀️',
    label: 'Recovered',
    description: 'No sleep debt this week',
    isUnlocked: (h) => !h.sleepDebt,
    detail: (h) => (!h.sleepDebt
      ? "No sleep debt this week. Your recovery is on track."
      : "You have sleep debt built up this week. Log more rest to catch up and unlock this."),
  },
];

export function computeAchievements(home) {
  if (!home) return BADGES.map(b => ({ ...b, unlocked: false, detail: b.description }));
  return BADGES.map(b => ({ ...b, unlocked: b.isUnlocked(home), detail: b.detail(home) }));
}
