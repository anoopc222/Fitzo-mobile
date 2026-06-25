import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

export default function SettingsScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { colors } = useTheme();
  const { isPro, isInTrial, manageSubscriptions, ready: subReady } = useSubscription() ?? {};
  const { prefs: notifPrefs, setPref: setNotifPref } = useNotificationPrefs() ?? { prefs: {}, setPref: () => {} };

  const handleToggleNotif = async (key, value) => {
    const ok = await setNotifPref(key, value);
    if (!ok) Alert.alert('Permission needed', 'Enable notifications for FitZo in your device settings to use reminders.');
  };

  const handleManageSubscription = async () => {
    try {
      await manageSubscriptions();
    } catch (e) {
      Alert.alert('Error', "Couldn't open subscription management. Please manage your subscription directly from the App Store / Play Store.");
    }
  };
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handlePasswordReset = () => {
    Alert.alert('Reset Password', `A password reset link will be sent to ${user?.email}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: () => supabase.auth.resetPasswordForEmail(user?.email, {
          redirectTo: Linking.createURL('auth/callback'),
        }),
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This permanently deletes your account and ALL data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever', style: 'destructive',
          onPress: async () => {
            try {
              await supabase.rpc('delete_user');
              await signOut();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="SETTINGS" colors={colors} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Account ─────────────────────────────────────────────── */}
        <SectionHeader title="Account" />
        <View style={styles.card}>
          <SettingRow icon="mail-outline" label="Email" value={user?.email} />
          <SettingRow icon="key-outline" label="Change Password" chevron onPress={handlePasswordReset} />
          <SettingRow icon="person-outline" label="Edit Profile" chevron last
            onPress={() => navigation.navigate('Profile')} />
        </View>

        {/* ── Subscription ───────────────────────────────────────── */}
        <SectionHeader title="Subscription" />
        <View style={styles.card}>
          <SettingRow icon="card-outline" label="Status" value={isPro ? 'Pro' : isInTrial ? 'Free Trial' : 'Free'} />
          {subReady && !isPro && (
            <SettingRow icon="rocket-outline" label="Upgrade to Pro" chevron
              onPress={() => navigation.navigate('Subscription')} />
          )}
          <SettingRow icon="settings-outline" label="Manage / Cancel Subscription" chevron last
            onPress={handleManageSubscription} />
        </View>

        {/* ── Notifications ──────────────────────────────────────── */}
        <SectionHeader title="Notifications" />
        <View style={styles.card}>
          <SwitchRow
            icon="water-outline" label="Period & ovulation reminders"
            value={!!notifPrefs.periodReminders}
            onValueChange={(v) => handleToggleNotif('periodReminders', v)}
          />
          <SwitchRow
            icon="clipboard-outline" label="Daily log reminder (8 PM)"
            value={!!notifPrefs.dailyLogReminder}
            onValueChange={(v) => handleToggleNotif('dailyLogReminder', v)}
          />
          <SwitchRow
            icon="barbell-outline" label="Workout reminder (6 PM)"
            value={!!notifPrefs.workoutReminder}
            onValueChange={(v) => handleToggleNotif('workoutReminder', v)}
          />
          <SwitchRow
            icon="scale-outline" label="Remind me if weight isn't logged"
            value={!!notifPrefs.weightReminder}
            onValueChange={(v) => handleToggleNotif('weightReminder', v)}
          />
          <SwitchRow
            icon="footsteps-outline" label="Remind me if steps aren't logged"
            value={!!notifPrefs.stepsReminder}
            onValueChange={(v) => handleToggleNotif('stepsReminder', v)}
          />
          <SwitchRow
            icon="moon-outline" label="Remind me if sleep isn't logged"
            value={!!notifPrefs.sleepReminder}
            onValueChange={(v) => handleToggleNotif('sleepReminder', v)}
            last
          />
        </View>

        {/* ── Danger Zone ─────────────────────────────────────────── */}
        <SectionHeader title="Danger Zone" />
        <View style={[styles.card, { borderColor: colors.danger + '44' }]}>
          <TouchableOpacity style={[styles.dangerRow, styles.rowBorder]} onPress={signOut}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.dangerLabel}>Sign Out</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerRow} onPress={handleDeleteAccount}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={styles.dangerLabel}>Delete Account & All Data</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.version}>FitZo v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function SettingRow({ icon, label, value, chevron, onPress, last, danger }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity
      style={[styles.settingRow, !last && styles.rowBorder]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Ionicons name={icon} size={18} color={danger ? colors.danger : colors.textMuted} />
      <Text style={[styles.settingLabel, danger && { color: colors.danger }]}>{label}</Text>
      {value && <Text style={styles.settingValue}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={15} color={colors.textDim} />}
    </TouchableOpacity>
  );
}

function SwitchRow({ icon, label, value, onValueChange, last }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.settingRow, !last && styles.rowBorder]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 20, marginBottom: 8,
  },
  card: {
    backgroundColor: colors.bgCard, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 4,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  settingLabel: { flex: 1, fontSize: typography.base, color: colors.text },
  settingValue: { fontSize: typography.sm, color: colors.textMuted },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  dangerLabel: { fontSize: typography.base, color: colors.danger, fontWeight: weight.medium },

  version: { textAlign: 'center', fontSize: typography.xs, color: colors.textDim, marginTop: 24 },
});
