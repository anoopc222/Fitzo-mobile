// Activity color mappings for calendar
export const ACTIVITY_COLORS = {
  gym: {
    color: '#34d399',
    label: 'Gym',
    icon: '🏋️',
  },
  cardio: {
    color: '#60a5fa',
    label: 'Cardio',
    icon: '🏃',
  },
  rest: {
    color: '#fbbf24',
    label: 'Rest',
    icon: '😴',
  },
  default: {
    color: '#8b5cf6',
    label: 'Other',
    icon: '✓',
  },
};

export const getActivityType = (notes) => {
  if (!notes) return 'gym';
  const n = notes.toLowerCase();
  if (n === 'rest day') return 'rest';
  if (['cardio', 'run', 'stair', 'hiit', 'bike', 'swim', 'walk', 'cycle', 'elliptical'].some(k => n.includes(k))) {
    return 'cardio';
  }
  return 'gym';
};

export const formatCalendarData = (workoutSessions) => {
  const data = {};
  workoutSessions.forEach((session) => {
    const dateKey = session.date;
    const activityType = getActivityType(session.notes);
    data[dateKey] = ACTIVITY_COLORS[activityType];
  });
  return data;
};
