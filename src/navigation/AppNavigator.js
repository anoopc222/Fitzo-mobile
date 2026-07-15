import React, { useRef, useState, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { usePostHog } from 'posthog-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
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
    if (!user) { setOnboarded(null); return; }
    // AsyncStorage can be wiped on Android after a Play Store update.
    // Fall back to the DB: if the profile already has a goal or step_goal set,
    // the user has completed onboarding before — skip it and repair the local flag.
    AsyncStorage.getItem('fitzo:onboarded').then(async val => {
      if (val === 'true') { setOnboarded(true); return; }
      const { data } = await supabase
        .from('profiles')
        .select('goal, step_goal, height_cm')
        .eq('id', user.id)
        .single();
      const alreadyOnboarded = !!(data?.goal || data?.step_goal || data?.height_cm);
      if (alreadyOnboarded) {
        await AsyncStorage.setItem('fitzo:onboarded', 'true');
      }
      setOnboarded(alreadyOnboarded);
    });
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
