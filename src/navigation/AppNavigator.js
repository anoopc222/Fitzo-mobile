import React, { useRef, useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { usePostHog } from 'posthog-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import AuthNavigator from './AuthNavigator';
import TabNavigator from './TabNavigator';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import { navigationRef } from './navigationRef';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { user, loading, isRecovering } = useAuth();
  const { colors, isDark } = useTheme();
  const posthog = usePostHog();
  const routeNameRef = useRef(null);
  const [onboarded, setOnboarded] = useState(null);

  useEffect(() => {
    if (user) {
      AsyncStorage.getItem('fitzo:onboarded').then(val => {
        setOnboarded(val === 'true');
      });
    } else {
      setOnboarded(null);
    }
  }, [user]);

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.bg,
      card: colors.bgCard,
      text: colors.text,
      border: colors.border,
      primary: colors.accent,
    },
  };

  if (loading || (user && onboarded === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={() => {
        routeNameRef.current = navigationRef.getCurrentRoute()?.name;
      }}
      onStateChange={() => {
        const prevName = routeNameRef.current;
        const currentRoute = navigationRef.getCurrentRoute();
        const currentName = currentRoute?.name;
        if (currentName && currentName !== prevName) {
          posthog?.screen(currentName, { params: currentRoute?.params });
        }
        routeNameRef.current = currentName;
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isRecovering ? (
          <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
        ) : user && !onboarded ? (
          <Stack.Screen name="Onboarding">
            {() => <OnboardingScreen onComplete={() => setOnboarded(true)} />}
          </Stack.Screen>
        ) : user ? (
          <Stack.Screen name="App" component={TabNavigator} />
        ) : (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
