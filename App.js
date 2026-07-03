import React, { useEffect, useRef } from 'react';
import { View, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { PostHogProvider, usePostHog } from 'posthog-react-native';
import { queryClient, CACHE_MAX_AGE } from './src/lib/queryClient';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { MoreMenuProvider } from './src/context/MoreMenuContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { useAppFonts } from './src/theme/useAppFonts';
import AppNavigator from './src/navigation/AppNavigator';
import MoreSheetModal from './src/components/MoreSheetModal';
import { navigate } from './src/navigation/navigationRef';
import { requestNotificationPermissions, scheduleDailyReminder } from './src/lib/notifications';
import { POSTHOG_API_KEY, POSTHOG_HOST } from './src/config/analytics';
import './src/i18n';
import { loadStoredLanguage } from './src/i18n';

const REMINDER_TAG_TO_TAB = {
  dailyLog: 'Log',
  workoutReminder: 'Workout',
  weightReminder: 'Weight',
  stepsReminder: 'Steps',
  sleepReminder: 'Sleep',
};

function navigateForNotification(response) {
  const tag = response?.notification?.request?.content?.data?.tag;
  const tab = REMINDER_TAG_TO_TAB[tag];
  if (tab) navigate(tab);
}

// RN doesn't fire the browser `visibilitychange`/`focus` events React Query
// listens for by default, so foreground-refetch needs AppState wired in manually.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => sub.remove();
});

const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'fitzo-query-cache',
});

function Root() {
  const { isDark } = useTheme();
  const { user } = useAuth();
  const posthog = usePostHog();
  const notifScheduledRef = useRef(false);

  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) navigateForNotification(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(navigateForNotification);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    loadStoredLanguage();
  }, []);

  // Tie events to the logged-in user (or reset to anonymous on sign-out) so
  // PostHog can group sessions by account instead of just by device.
  useEffect(() => {
    if (user?.id) {
      posthog?.identify(user.id, { email: user.email });
    } else {
      posthog?.reset();
    }
  }, [user?.id, posthog]);

  // Schedule daily reminders once per sign-in session.
  useEffect(() => {
    if (!user?.id) return;
    if (notifScheduledRef.current) return;
    notifScheduledRef.current = true;
    (async () => {
      try {
        await requestNotificationPermissions();
        await scheduleDailyReminder('dailyLog', 20, 0, '📊 Log your day', "Don't forget to log weight, steps & food!");
        await scheduleDailyReminder('sleepReminder', 22, 0, '😴 Bedtime soon', 'Log your sleep goal for tonight!');
        await scheduleDailyReminder('weightReminder', 8, 0, '⚖️ Morning weigh-in', 'Start the day by logging your weight!');
      } catch (_e) {
        // never throw
      }
    })();
  }, [user?.id]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AppNavigator />
      <MoreSheetModal />
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0c0c0f' }} />;
  }

  return (
    <PostHogProvider apiKey={POSTHOG_API_KEY} options={{ host: POSTHOG_HOST }} autocapture>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: CACHE_MAX_AGE,
            buster: 'v1',
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => query.state.status === 'success',
            },
          }}
        >
          <ThemeProvider>
            <AuthProvider>
              <SubscriptionProvider>
                <NotificationProvider>
                  <MoreMenuProvider>
                    <Root />
                  </MoreMenuProvider>
                </NotificationProvider>
              </SubscriptionProvider>
            </AuthProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </PostHogProvider>
  );
}
