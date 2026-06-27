// Weekly challenges — derived from the same `home` query data as
// achievements. Since the targets/progress are read from the current
// week's range, these naturally reset every Monday with no extra storage.

const CHALLENGES = [
  {
    id: 'steps-5-7',
    icon: '👟',
    label: 'Step It Up',
    description: 'Hit your step goal 5 days this week',
    target: () => 5,
    progress: (h) => h.thisWeek?.goalDays ?? 0,
  },
  {
    id: 'workouts-week',
    icon: '🏋️',
    label: 'Gym Regular',
    description: 'Complete your weekly workout goal',
    target: (h) => h.weeklyGoal ?? 4,
    progress: (h) => h.thisWeek?.sessions ?? 0,
  },
  {
    id: 'food-log-week',
    icon: '🍽️',
    label: 'Tracked Eater',
    description: 'Log food 5 days this week',
    target: () => 5,
    progress: (h) => h.thisWeek?.kcalDays ?? 0,
  },
  {
    id: 'no-debt-week',
    icon: '🌙',
    label: 'Rested Week',
    description: 'End the week with no sleep debt',
    target: () => 1,
    progress: (h) => (h.sleepDebt ? 0 : 1),
  },
];

export function computeChallenges(home) {
  if (!home) {
    return CHALLENGES.map(c => ({ ...c, target: c.target({}), progress: 0, complete: false }));
  }
  return CHALLENGES.map(c => {
    const target = c.target(home);
    const progress = Math.min(c.progress(home), target);
    return { ...c, target, progress, complete: progress >= target };
  });
}
