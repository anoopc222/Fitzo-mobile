import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://42e684a3b993b4091e0d11e3cd8b384a@o4511737932152832.ingest.us.sentry.io/4511737934249987',
  enableNative: true, // native crash handler persists reports to disk before the process dies — needed to capture instant-kill fatals like the expo-updates-error-recovery HomeScreen crash
  tracesSampleRate: 0.2,
});

import React, { useEffect, useRef, Component } from 'react';
import { View, AppState, Text, TouchableOpacity } from 'react-native';
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
import UpdateBanner from './src/components/UpdateBanner';
import { navigate } from './src/navigation/navigationRef';
import { requestNotificationPermissions, scheduleDailyReminder, scheduleWeeklySummary, registerPushToken } from './src/lib/notifications';
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

// Wrap AsyncStorage so any read/write/parse error never crashes the app.
// Stale or corrupted cache from a previous build is silently discarded.
const safeAsyncStorage = {
  getItem: async (key) => {
    try { return await AsyncStorage.getItem(key); } catch { return null; }
  },
  setItem: async (key, value) => {
    try { await AsyncStorage.setItem(key, value); } catch { /* ignore */ }
  },
  removeItem: async (key) => {
    try { await AsyncStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const persister = createAsyncStoragePersister({
  storage: safeAsyncStorage,
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
        await registerPushToken(user.id);
        await scheduleDailyReminder('dailyLog', 20, 0, '📊 Log your day', "Don't forget to log weight, steps & food!");
        await scheduleDailyReminder('sleepReminder', 22, 0, '😴 Bedtime soon', 'Log your sleep goal for tonight!');
        await scheduleDailyReminder('weightReminder', 8, 0, '⚖️ Morning weigh-in', 'Start the day by logging your weight!');
        await scheduleWeeklySummary();
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
      <UpdateBanner />
    </>
  );
}

function App() {
  const [fontsLoaded, fontError] = useAppFonts();

  // Proceed even if fonts fail — native fallbacks render fine and a black
  // screen is far worse than a slightly different typeface on restart.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: '#0c0c0f' }} />;
  }

  return (
    <PostHogProvider apiKey={POSTHOG_API_KEY} options={{ host: POSTHOG_HOST }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: CACHE_MAX_AGE,
            buster: 'v3',
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => query.state.status === 'success',
              // Only cache query data, never queue mutations for later replay —
              // a paused quick-log mutation resuming on an unrelated later
              // launch is surprising and can write stale/out-of-context data.
              shouldDehydrateMutation: () => false,
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

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    Sentry.captureException(error, { extra: info });
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0c0c0f', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ color: '#d4ff00', fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>Something went wrong</Text>
          <Text style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
            {this.state.error?.message || 'Unknown error'}
          </Text>
          <Text style={{ color: '#555', fontSize: 11, textAlign: 'center', marginBottom: 24 }}>
            {this.state.error?.stack?.slice(0, 300)}
          </Text>
          <TouchableOpacity onPress={() => this.setState({ error: null })} style={{ backgroundColor: '#d4ff00', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}>
            <Text style={{ color: '#000', fontWeight: 'bold' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function AppRoot() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
