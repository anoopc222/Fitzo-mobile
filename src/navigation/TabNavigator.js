import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

import HomeScreen from '../screens/HomeScreen';
import WorkoutScreen from '../screens/WorkoutScreen';
import FoodLogScreen from '../screens/FoodLogScreen';
import StepsScreen from '../screens/StepsScreen';
import WeightScreen from '../screens/WeightScreen';
import SleepScreen from '../screens/SleepScreen';
import MoreScreen from '../screens/MoreScreen';
import ProgressScreen from '../screens/ProgressScreen';
import MeasurementsScreen from '../screens/MeasurementsScreen';
import HealthLogScreen from '../screens/HealthLogScreen';
import CalculatorsScreen from '../screens/CalculatorsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const HomeStack = createNativeStackNavigator();

const TAB_CONFIG = {
  Home:    ['home',      'home-outline'],
  Workout: ['barbell',   'barbell-outline'],
  Log:     ['clipboard', 'clipboard-outline'],
  Steps:   ['footsteps', 'footsteps-outline'],
  Weight:  ['scale',     'scale-outline'],
  Sleep:   ['moon',      'moon-outline'],
};

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={{ headerShown: false }}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} />
      <HomeStack.Screen name="More" component={MoreScreen} />
      <HomeStack.Screen name="Progress" component={ProgressScreen} />
      <HomeStack.Screen name="Measurements" component={MeasurementsScreen} />
      <HomeStack.Screen name="HealthLog" component={HealthLogScreen} />
      <HomeStack.Screen name="Calculators" component={CalculatorsScreen} />
      <HomeStack.Screen name="Profile" component={ProfileScreen} />
      <HomeStack.Screen name="Settings" component={SettingsScreen} />
    </HomeStack.Navigator>
  );
}

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bgCard,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 10,
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
      <Tab.Screen name="Home" component={HomeStackNavigator} />
      <Tab.Screen name="Workout" component={WorkoutScreen} />
      <Tab.Screen name="Log" component={FoodLogScreen} />
      <Tab.Screen name="Steps" component={StepsScreen} />
      <Tab.Screen name="Weight" component={WeightScreen} />
      <Tab.Screen name="Sleep" component={SleepScreen} />
    </Tab.Navigator>
  );
}
