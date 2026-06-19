import React from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './src/context/AuthContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { useAppFonts } from './src/theme/useAppFonts';
import AppNavigator from './src/navigation/AppNavigator';

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
    </>
  );
}

export default function App() {
  const [fontsLoaded] = useAppFonts();

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#0c0c0f' }} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
