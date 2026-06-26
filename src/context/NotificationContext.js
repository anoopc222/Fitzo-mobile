import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  requestNotificationPermissions,
  scheduleDailyReminder,
  cancelNotificationsByTag,
} from '../lib/notifications';

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
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [times, setTimes] = useState(DEFAULT_TIMES);
  const [loaded, setLoaded] = useState(false);

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
