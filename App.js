import React from 'react';
import { View, AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { AuthProvider } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { MoreMenuProvider } from './src/context/MoreMenuContext';
import { useAppFonts } from './src/theme/useAppFonts';
import AppNavigator from './src/navigation/AppNavigator';
import MoreSheetModal from './src/components/MoreSheetModal';

// RN doesn't fire the browser `visibilitychange`/`focus` events React Query
// listens for by default, so foreground-refetch needs AppState wired in manually.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => sub.remove();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is fetched fresh on every screen-mount-after-mutation via explicit
      // invalidateQueries() calls, so a non-zero staleTime here only avoids
      // redundant refetches on quick re-mounts/focus, it never serves data the
      // app itself just changed.
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnReconnect: true,
    },
  },
});

function Root() {
  const { isDark } = useTheme();
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
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <MoreMenuProvider>
                <Root />
              </MoreMenuProvider>
            </SubscriptionProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
