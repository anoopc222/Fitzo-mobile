import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const streakKey = (userId) => `fitzo:gameStreak:${userId}`;

export async function recordGamePlay(userId) {
  if (!userId) return;
  const today = todayString();
  const yesterday = yesterdayString();
  const raw = await AsyncStorage.getItem(streakKey(userId));
  let current = { lastDate: null, streak: 0 };
  if (raw) { try { current = JSON.parse(raw); } catch {} }
  if (current.lastDate === today) return;
  const newStreak = current.lastDate === yesterday ? current.streak + 1 : 1;
  await AsyncStorage.setItem(streakKey(userId), JSON.stringify({ lastDate: today, streak: newStreak }));
}

export function useGameStreak(userId) {
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(streakKey(userId)).then(raw => {
      if (!raw) return;
      try {
        const { streak: s } = JSON.parse(raw);
        setStreak(s ?? 0);
      } catch {}
    });
  }, [userId]);

  const recordPlay = useCallback(async () => {
    if (!userId) return;
    const today = todayString();
    const yesterday = yesterdayString();
    const raw = await AsyncStorage.getItem(streakKey(userId));
    let current = { lastDate: null, streak: 0 };
    if (raw) {
      try { current = JSON.parse(raw); } catch {}
    }

    if (current.lastDate === today) return; // already recorded today
    const newStreak = current.lastDate === yesterday ? current.streak + 1 : 1;
    const updated = { lastDate: today, streak: newStreak };
    await AsyncStorage.setItem(streakKey(userId), JSON.stringify(updated));
    setStreak(newStreak);
  }, [userId]);

  return { streak, recordPlay };
}
