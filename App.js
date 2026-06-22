import React from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './src/context/AuthContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { MoreMenuProvider } from './src/context/MoreMenuContext';
import { useAppFonts } from './src/theme/useAppFonts';
import AppNavigator from './src/navigation/AppNavigator';
import MoreSheetModal from './src/components/MoreSheetModal';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 0,
      staleTime: 0,
      retry: 1,
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
