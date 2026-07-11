import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const LAST_SCHEDULED_KEY = 'fitzo:smartReminderLastScheduled';

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function scheduleSmartReminder(userId) {
  const today = new Date();
  const todayStr = localDateStr(today);

  // Only schedule once per day
  const last = await AsyncStorage.getItem(LAST_SCHEDULED_KEY);
  if (last === todayStr) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Get last 28 days of workout sessions
  const since = localDateStr(new Date(Date.now() - 28 * 86400000));
  const { data: sessions } = await supabase
    .from('workout_sessions')
    .select('date')
    .eq('user_id', userId)
    .gte('date', since);

  if (!sessions?.length) return;

  // Count sessions per day-of-week (0=Sun…6=Sat)
  const dayCounts = Array(7).fill(0);
  sessions.forEach(s => {
    const dow = new Date(s.date + 'T12:00:00').getDay();
    dayCounts[dow]++;
  });

  const todayDow = today.getDay();
  const weeksInWindow = 4;
  const isTypicalDay = dayCounts[todayDow] >= Math.max(1, Math.floor(weeksInWindow / 2));
  if (!isTypicalDay) {
    await AsyncStorage.setItem(LAST_SCHEDULED_KEY, todayStr);
    return;
  }

  // Check if already logged a workout today
  const { data: todaySession } = await supabase
    .from('workout_sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('date', todayStr)
    .limit(1);

  if (todaySession?.length) {
    await AsyncStorage.setItem(LAST_SCHEDULED_KEY, todayStr);
    return;
  }

  // Schedule for 6pm if that's still in the future, else skip
  const fireAt = new Date(today);
  fireAt.setHours(18, 0, 0, 0);
  if (fireAt <= today) {
    await AsyncStorage.setItem(LAST_SCHEDULED_KEY, todayStr);
    return;
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Time to train 💪",
      body: `You usually work out on ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][todayDow]}s. Ready to log today's session?`,
      data: { screen: 'Workout' },
    },
    trigger: { date: fireAt },
  });

  await AsyncStorage.setItem(LAST_SCHEDULED_KEY, todayStr);
}

async function scheduleWeeklyRecap(userId) {
  const KEY = 'fitzo:weeklyRecapScheduled';
  const now = new Date();
  const weekKey = `${now.getFullYear()}-W${Math.ceil(now.getDate() / 7)}`;
  const last = await AsyncStorage.getItem(KEY);
  if (last === weekKey) return;

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // Schedule for next Sunday at 8pm
  const nextSunday = new Date(now);
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  nextSunday.setHours(20, 0, 0, 0);
  if (nextSunday <= now) return;

  // Get this week's stats for the notification
  const weekStart = localDateStr(new Date(Date.now() - now.getDay() * 86400000));
  const [sessions, steps, food] = await Promise.all([
    supabase.from('workout_sessions').select('id').eq('user_id', userId).gte('date', weekStart),
    supabase.from('step_logs').select('steps').eq('user_id', userId).gte('logged_at', `${weekStart}T00:00:00`),
    supabase.from('food_logs').select('calories').eq('user_id', userId).gte('logged_at', `${weekStart}T00:00:00`),
  ]);

  const sessionCount = sessions.data?.length ?? 0;
  const totalSteps = (steps.data ?? []).reduce((s, r) => s + (r.steps ?? 0), 0);
  const avgKcal = food.data?.length
    ? Math.round((food.data ?? []).reduce((s, r) => s + (r.calories ?? 0), 0) / food.data.length)
    : 0;

  const lines = [];
  if (sessionCount > 0) lines.push(`${sessionCount} workout${sessionCount > 1 ? 's' : ''}`);
  if (totalSteps > 0) lines.push(`${(totalSteps / 1000).toFixed(1)}k steps`);
  if (avgKcal > 0) lines.push(`~${avgKcal} kcal/day`);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Weekly Recap 📊",
      body: lines.length ? `This week: ${lines.join(' · ')}. Great work!` : "Check your weekly stats in Fitzo!",
      data: { screen: 'Home' },
    },
    trigger: { date: nextSunday },
  });

  await AsyncStorage.setItem(KEY, weekKey);
}

export default function useSmartReminders(userId) {
  useEffect(() => {
    if (!userId) return;
    scheduleSmartReminder(userId).catch(() => {});
    scheduleWeeklyRecap(userId).catch(() => {});
  }, [userId]);
}
