// Weekly challenges — derived from the same `home` query data as
// achievements. Since the targets/progress are read from the current
// week's range, these naturally reset every Monday with no extra storage.

const CHALLENGES = [
  {
    id: 'steps-5-7',
    icon: '👟',
    labelKey: 'gamification.challengeStepsLabel',
    descriptionKey: 'gamification.challengeStepsDescription',
    target: () => 5,
    progress: (h) => h.thisWeek?.goalDays ?? 0,
  },
  {
    id: 'workouts-week',
    icon: '🏋️',
    labelKey: 'gamification.challengeWorkoutsLabel',
    descriptionKey: 'gamification.challengeWorkoutsDescription',
    target: (h) => h.weeklyGoal ?? 4,
    progress: (h) => h.thisWeek?.sessions ?? 0,
  },
  {
    id: 'food-log-week',
    icon: '🍽️',
    labelKey: 'gamification.challengeFoodLabel',
    descriptionKey: 'gamification.challengeFoodDescription',
    target: () => 5,
    progress: (h) => h.thisWeek?.kcalDays ?? 0,
  },
  {
    id: 'no-debt-week',
    icon: '🌙',
    labelKey: 'gamification.challengeRestLabel',
    descriptionKey: 'gamification.challengeRestDescription',
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
