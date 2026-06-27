// Streak freezes — a consumable, earned every 7-day streak milestone, that
// lets a user cover one missed day without losing their streak. State is
// stored locally per-user in AsyncStorage (mirrors the ThemeContext /
// i18n persistence pattern); it doesn't need a Supabase table since it's
// purely a display/motivation mechanic layered on top of real log data.

import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (userId) => `fitzo:streakFreeze:${userId}`;

async function getState(userId) {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  return raw ? JSON.parse(raw) : { freezesAvailable: 0, awardedMilestones: [], frozenDates: [] };
}

async function setState(userId, state) {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(state));
}

export async function getFreezeState(userId) {
  return getState(userId);
}

// Awards one freeze the first time the streak crosses each new 7-day
// milestone (7, 14, 21, ...).
export async function syncFreezeAwards(userId, streak) {
  const state = await getState(userId);
  const milestone = Math.floor((streak ?? 0) / 7) * 7;
  if (milestone > 0 && !state.awardedMilestones.includes(milestone)) {
    state.awardedMilestones.push(milestone);
    state.freezesAvailable += 1;
    await setState(userId, state);
  }
  return state;
}

// Spends one freeze to cover a given date, so the streak calculation
// treats that day as logged even though it wasn't.
export async function useFreezeForDate(userId, dateStr) {
  const state = await getState(userId);
  if (state.freezesAvailable <= 0 || state.frozenDates.includes(dateStr)) return state;
  state.frozenDates.push(dateStr);
  state.freezesAvailable -= 1;
  await setState(userId, state);
  return state;
}
