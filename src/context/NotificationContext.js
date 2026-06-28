import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import {
  requestNotificationPermissions,
  scheduleDailyReminder,
  cancelNotificationsByTag,
  syncConditionalReminder,
} from '../lib/notifications';

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const REMINDER_COPY = {
  weightReminder: { title: "Log today's weight", body: "Don't forget to log your weight today." },
  stepsReminder: { title: "Log today's steps", body: "Don't forget to log your steps today." },
  sleepReminder: { title: "Log last night's sleep", body: "Don't forget to log how much you slept." },
  workoutReminder: { title: "Log today's workout", body: "Haven't logged a workout today — keep the streak going." },
};

// Mirrors the per-screen "logged today/yesterday" checks (Weight/Steps/Sleep/
// Workout screens) so these conditional reminders get (re)scheduled reliably
// once per app session/foreground, regardless of which screen the user opens.
async function checkLoggedConditions(userId) {
  const today = localDateStr(new Date());
  const yesterday = localDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const [weightRes, stepsRes, sleepRes, workoutRes] = await Promise.all([
    supabase.from('weight_logs').select('logged_at').eq('user_id', userId).eq('logged_at', yesterday).maybeSingle(),
    supabase.from('step_logs').select('logged_at').eq('user_id', userId).eq('logged_at', today).maybeSingle(),
    supabase.from('sleep_logs').select('logged_at').eq('user_id', userId).in('logged_at', [today, yesterday]).maybeSingle(),
    supabase.from('workout_sessions').select('date').eq('user_id', userId).eq('date', today).maybeSingle(),
  ]);

  return {
    weightReminder: !!weightRes.data,
    stepsReminder: !!stepsRes.data,
    sleepReminder: !!sleepRes.data,
    workoutReminder: !!workoutRes.data,
  };
}

const PREFS_KEY = 'notificationPrefs';
const TIMES_KEY = 'notificationTimes';
const DEFAULT_PREFS = {
  dailyLogReminder: true, workoutReminder: true,
  weightReminder: true, stepsReminder: true, sleepReminder: true,
};
const ALL_OFF_PREFS = {
  dailyLogReminder: false, workoutReminder: false,
  weightReminder: false, stepsReminder: false, sleepReminder: false,
};
// Real fire times each reminder uses — kept separate from the on/off prefs
// above so Pro users can override them per-type without touching that state.
const DEFAULT_TIMES = {
  dailyLogReminder: { hour: 20, minute: 0 },
  workoutReminder: { hour: 22, minute: 0 },
  weightReminder: { hour: 8, minute: 0 },
  stepsReminder: { hour: 22, minute: 0 },
  sleepReminder: { hour: 8, minute: 0 },
};

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [times, setTimes] = useState(DEFAULT_TIMES);
  const [loaded, setLoaded] = useState(false);
  const prefsRef = useRef(prefs);
  const timesRef = useRef(times);
  prefsRef.current = prefs;
  timesRef.current = times;

  // First launch: reminders are on by default, but that only sticks if the
  // user actually grants permission — otherwise stay off until they opt in
  // from Settings. Once a choice is stored, always respect it as-is.
  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then(async raw => {
      if (raw) {
        setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      } else {
        const granted = await requestNotificationPermissions();
        const initial = granted ? DEFAULT_PREFS : ALL_OFF_PREFS;
        setPrefs(initial);
        AsyncStorage.setItem(PREFS_KEY, JSON.stringify(initial));
      }
      setLoaded(true);
    });
    AsyncStorage.getItem(TIMES_KEY).then(raw => {
      if (raw) setTimes({ ...DEFAULT_TIMES, ...JSON.parse(raw) });
    });
  }, []);

  // Re-apply repeating reminders whose schedule doesn't depend on app data,
  // so they survive after a reinstall/permission re-grant without user action.
  useEffect(() => {
    if (!loaded) return;
    const { hour, minute } = times.dailyLogReminder;
    if (prefs.dailyLogReminder) {
      scheduleDailyReminder('dailyLog', hour, minute, 'Log today\'s progress', "Don't forget to log your food, weight, or workout today.");
    } else {
      cancelNotificationsByTag('dailyLog');
    }
  }, [loaded, prefs.dailyLogReminder, times.dailyLogReminder]);

  // Centrally (re)sync the data-dependent reminders — these need a fresh
  // one-shot trigger scheduled each day, which previously only happened if
  // the matching screen (Weight/Steps/Sleep/Workout) happened to be opened
  // before its reminder time. Running it here covers every app open/resume.
  const syncDataReminders = useCallback(async () => {
    if (!loaded || !user?.id) return;
    let logged;
    try {
      logged = await checkLoggedConditions(user.id);
    } catch {
      return;
    }
    for (const key of ['weightReminder', 'stepsReminder', 'sleepReminder', 'workoutReminder']) {
      const time = timesRef.current[key];
      if (!prefsRef.current[key]) {
        syncConditionalReminder(key, true, time.hour, time.minute, '', '');
        continue;
      }
      const { title, body } = REMINDER_COPY[key];
      syncConditionalReminder(key, logged[key], time.hour, time.minute, title, body);
    }
  }, [loaded, user?.id]);

  useEffect(() => {
    syncDataReminders();
  }, [
    syncDataReminders,
    prefs.weightReminder, prefs.stepsReminder, prefs.sleepReminder, prefs.workoutReminder,
    times.weightReminder, times.stepsReminder, times.sleepReminder, times.workoutReminder,
  ]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncDataReminders();
    });
    return () => sub.remove();
  }, [syncDataReminders]);

  const setPref = useCallback(async (key, value) => {
    if (value) {
      const granted = await requestNotificationPermissions();
      if (!granted) return false;
    }
    setPrefs(prev => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
    if (!value) {
      const tag = {
        weightReminder: 'weightReminder', stepsReminder: 'stepsReminder',
        sleepReminder: 'sleepReminder', workoutReminder: 'workoutReminder',
      }[key];
      if (tag) cancelNotificationsByTag(tag);
    }
    return true;
  }, []);

  const setReminderTime = useCallback((key, hour, minute) => {
    setTimes(prev => {
      const next = { ...prev, [key]: { hour, minute } };
      AsyncStorage.setItem(TIMES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <NotificationContext.Provider value={{ prefs, times, setPref, setReminderTime }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationPrefs() {
  return useContext(NotificationContext);
}
