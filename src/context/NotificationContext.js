import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  requestNotificationPermissions,
  scheduleDailyReminder,
  cancelNotificationsByTag,
} from '../lib/notifications';

const PREFS_KEY = 'notificationPrefs';
const DEFAULT_PREFS = {
  dailyLogReminder: false, workoutReminder: false,
  weightReminder: false, stepsReminder: false, sleepReminder: false,
};

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then(raw => {
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
      setLoaded(true);
    });
  }, []);

  // Re-apply repeating reminders whose schedule doesn't depend on app data,
  // so they survive after a reinstall/permission re-grant without user action.
  useEffect(() => {
    if (!loaded) return;
    if (prefs.dailyLogReminder) {
      scheduleDailyReminder('dailyLog', 20, 0, 'Log today\'s progress', "Don't forget to log your food, weight, or workout today.");
    } else {
      cancelNotificationsByTag('dailyLog');
    }
  }, [loaded, prefs.dailyLogReminder]);

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

  return (
    <NotificationContext.Provider value={{ prefs, setPref }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotificationPrefs() {
  return useContext(NotificationContext);
}
