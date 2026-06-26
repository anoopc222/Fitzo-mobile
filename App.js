import React, { useEffect } from 'react';
import { View, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { queryClient, CACHE_MAX_AGE } from './src/lib/queryClient';
import { AuthProvider } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { MoreMenuProvider } from './src/context/MoreMenuContext';
import { NotificationProvider } from './src/context/NotificationContext';
import { useAppFonts } from './src/theme/useAppFonts';
import AppNavigator from './src/navigation/AppNavigator';
import MoreSheetModal from './src/components/MoreSheetModal';
import { navigate } from './src/navigation/navigationRef';

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

  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) navigateForNotification(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(navigateForNotification);
    return () => sub.remove();
  }, []);

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
  );
}
