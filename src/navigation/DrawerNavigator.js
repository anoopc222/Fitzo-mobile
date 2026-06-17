import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { typography, weight } from '../theme/typography';
import { useAuth } from '../context/AuthContext';
import TabNavigator from './TabNavigator';
import FoodLogScreen from '../screens/FoodLogScreen';
import SleepScreen from '../screens/SleepScreen';
import MeasurementsScreen from '../screens/MeasurementsScreen';
import HealthLogScreen from '../screens/HealthLogScreen';
import CalculatorsScreen from '../screens/CalculatorsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Drawer = createDrawerNavigator();

function CustomDrawerContent({ navigation }) {
  const { user, signOut } = useAuth();

  const items = [
    { name: 'MainTabs', label: 'Dashboard', icon: 'grid' },
    { name: 'FoodLog', label: 'Food Log', icon: 'nutrition' },
    { name: 'Sleep', label: 'Sleep', icon: 'moon' },
    { name: 'Measurements', label: 'Measurements', icon: 'body' },
    { name: 'HealthLog', label: 'Health Log', icon: 'heart-half' },
    { name: 'Calculators', label: 'Calculators', icon: 'calculator' },
    { name: 'Profile', label: 'Profile', icon: 'person' },
    { name: 'Settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <View style={styles.drawer}>
      <View style={styles.drawerHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.user_metadata?.full_name?.[0]?.toUpperCase() ?? 'F'}
          </Text>
        </View>
        <Text style={styles.userName}>{user?.user_metadata?.full_name ?? 'FitZo User'}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
      </View>

      <View style={styles.drawerItems}>
        {items.map((item) => (
          <TouchableOpacity
            key={item.name}
            style={styles.drawerItem}
            onPress={() => navigation.navigate(item.name)}
          >
            <Ionicons name={item.icon} size={20} color={colors.accent} />
            <Text style={styles.drawerLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={signOut}>
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function DrawerNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerStyle: { backgroundColor: colors.bgCard, width: 280 },
      }}
    >
      <Drawer.Screen name="MainTabs" component={TabNavigator} />
      <Drawer.Screen name="FoodLog" component={FoodLogScreen} />
      <Drawer.Screen name="Sleep" component={SleepScreen} />
      <Drawer.Screen name="Measurements" component={MeasurementsScreen} />
      <Drawer.Screen name="HealthLog" component={HealthLogScreen} />
      <Drawer.Screen name="Calculators" component={CalculatorsScreen} />
      <Drawer.Screen name="Profile" component={ProfileScreen} />
      <Drawer.Screen name="Settings" component={SettingsScreen} />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1, backgroundColor: colors.bgCard, padding: 20 },
  drawerHeader: { paddingTop: 40, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: colors.border },
  avatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarText: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.bg },
  userName: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  userEmail: { fontSize: typography.sm, color: colors.textMuted, marginTop: 2 },
  drawerItems: { flex: 1, paddingTop: 20 },
  drawerItem: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  drawerLabel: { fontSize: typography.base, color: colors.text },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 },
  signOutText: { fontSize: typography.base, color: colors.danger },
});
