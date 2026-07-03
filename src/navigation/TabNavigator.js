import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMoreMenu } from '../context/MoreMenuContext';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import HomeScreen from '../screens/HomeScreen';
import WorkoutScreen from '../screens/WorkoutScreen';
import FoodLogScreen from '../screens/FoodLogScreen';
import StepsScreen from '../screens/StepsScreen';
import WeightScreen from '../screens/WeightScreen';
import SleepScreen from '../screens/SleepScreen';
import DietScreen from '../screens/DietScreen';
import ProgressScreen from '../screens/ProgressScreen';
import MeasurementsScreen from '../screens/MeasurementsScreen';
import CalculatorsScreen from '../screens/CalculatorsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import SocialScreen from '../screens/SocialScreen';
import PublicProfileScreen from '../screens/PublicProfileScreen';
import GameZoneScreen from '../screens/GameZoneScreen';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();

const TAB_CONFIG = {
  Home:    ['home',      'home-outline'],
  Workout: ['barbell',   'barbell-outline'],
  Steps:   ['footsteps', 'footsteps-outline'],
  Weight:  ['scale',     'scale-outline'],
  Sleep:   ['moon',      'moon-outline'],
  MoreTab: ['ellipsis-horizontal', 'ellipsis-horizontal-outline'],
};

function BlankScreen() {
  return <View style={{ flex: 1 }} />;
}

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="Diet" component={DietScreen} />
      <HomeStack.Screen name="Progress" component={ProgressScreen} />
      <HomeStack.Screen name="Measurements" component={MeasurementsScreen} />
      <HomeStack.Screen name="Calculators" component={CalculatorsScreen} />
      <HomeStack.Screen name="Profile" component={ProfileScreen} />
      <HomeStack.Screen name="Settings" component={SettingsScreen} />
      <HomeStack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
      <HomeStack.Screen name="Subscription" component={SubscriptionScreen} />
      <HomeStack.Screen name="PublicProfile" component={PublicProfileScreen} />
      <HomeStack.Screen name="GameZone" component={GameZoneScreen} />
    </HomeStack.Navigator>
  );
}

export default function TabNavigator() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { open: openMore } = useMoreMenu();
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        // Mount all tab screens up front instead of lazily on first focus, so
        // their useQuery calls fire in parallel at launch and switching tabs
        // never shows a cold loading spinner.
        lazy: false,
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 54 + insets.bottom,
          paddingBottom: Math.max(10, insets.bottom),
          paddingTop: 4,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
        tabBarIcon: ({ focused, color }) => {
          const [active, inactive] = TAB_CONFIG[route.name] ?? ['ellipsis-horizontal', 'ellipsis-horizontal-outline'];
          return <Ionicons name={focused ? active : inactive} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeStackNavigator} options={{ tabBarLabel: t('tabs.home') }} />
      <Tab.Screen name="Workout" component={WorkoutScreen} options={{ tabBarLabel: t('tabs.workout') }} />
      <Tab.Screen name="Steps" component={StepsScreen} options={{ tabBarLabel: t('tabs.steps') }} />
      <Tab.Screen name="Weight" component={WeightScreen} options={{ tabBarLabel: t('tabs.weight') }} />
      <Tab.Screen name="Sleep" component={SleepScreen} options={{ tabBarLabel: t('tabs.sleep') }} />
      <Tab.Screen
        name="Log"
        component={FoodLogScreen}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="Social"
        component={SocialScreen}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="MoreTab"
        component={BlankScreen}
        options={{ tabBarLabel: t('tabs.more') }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            openMore();
          },
        }}
      />
    </Tab.Navigator>
  );
}
