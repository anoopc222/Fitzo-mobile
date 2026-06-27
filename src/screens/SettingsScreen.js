import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch, Platform, Share, Modal, Pressable, FlatList,
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
import PaywallModal from '../components/ui/PaywallModal';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, ALL_LANGUAGES } from '../i18n';

const LANGUAGE_NAMES = ALL_LANGUAGES.reduce((acc, l) => ({ ...acc, [l.code]: l.name }), {});

function formatTime(hour, minute) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${ampm}`;
}

export default function SettingsScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { colors } = useTheme();
  const { isPro, isInTrial, manageSubscriptions, ready: subReady } = useSubscription() ?? {};
  const { prefs: notifPrefs, times: notifTimes, setPref: setNotifPref, setReminderTime } =
    useNotificationPrefs() ?? { prefs: {}, times: {}, setPref: () => {}, setReminderTime: () => {} };
  const [showPaywall, setShowPaywall] = useState(false);
  const [editingTimeKey, setEditingTimeKey] = useState(null);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const { t, i18n } = useTranslation();

  const handleSelectLanguage = (code) => {
    setAppLanguage(code);
    setShowLanguagePicker(false);
  };

  const handleToggleNotif = async (key, value) => {
    const ok = await setNotifPref(key, value);
    if (!ok) Alert.alert('Permission needed', 'Enable notifications for FitZo in your device settings to use reminders.');
  };

  const handleEditTime = (key) => {
    if (!isPro) { setShowPaywall(true); return; }
    setEditingTimeKey(key);
  };

  const handleInviteFriends = async () => {
    try {
      await Share.share({
        message: "I've been tracking my workouts, sleep, and nutrition with FitZo — thought you'd like it too. https://www.myfitzo.com",
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
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

        {/* ── Language ───────────────────────────────────────────── */}
        <SectionHeader title={t('settings.language')} />
        <View style={styles.card}>
          <SettingRow icon="globe-outline" label={t('settings.language')}
            value={LANGUAGE_NAMES[i18n.language] ?? i18n.language} chevron last
            onPress={() => setShowLanguagePicker(true)} />
        </View>

        {/* ── Invite Friends ─────────────────────────────────────── */}
        <SectionHeader title="Invite Friends" />
        <View style={styles.card}>
          <SettingRow icon="people-outline" label="Share FitZo with a friend" chevron last
            onPress={handleInviteFriends} />
        </View>

        {/* ── Notifications ──────────────────────────────────────── */}
        <SectionHeader title="Notifications" />
        <Text style={styles.sectionHint}>
          {isPro ? 'Tap the time to customize when a reminder fires.' : 'Pro unlocks custom reminder times.'}
        </Text>
        <View style={styles.card}>
          <SwitchRow
            icon="clipboard-outline" label="Daily log reminder"
            time={notifTimes.dailyLogReminder} isPro={isPro}
            onPressTime={() => handleEditTime('dailyLogReminder')}
            value={!!notifPrefs.dailyLogReminder}
            onValueChange={(v) => handleToggleNotif('dailyLogReminder', v)}
          />
          <SwitchRow
            icon="barbell-outline" label="Workout reminder"
            time={notifTimes.workoutReminder} isPro={isPro}
            onPressTime={() => handleEditTime('workoutReminder')}
            value={!!notifPrefs.workoutReminder}
            onValueChange={(v) => handleToggleNotif('workoutReminder', v)}
          />
          <SwitchRow
            icon="scale-outline" label="Remind me if weight isn't logged"
            time={notifTimes.weightReminder} isPro={isPro}
            onPressTime={() => handleEditTime('weightReminder')}
            value={!!notifPrefs.weightReminder}
            onValueChange={(v) => handleToggleNotif('weightReminder', v)}
          />
          <SwitchRow
            icon="footsteps-outline" label="Remind me if steps aren't logged"
            time={notifTimes.stepsReminder} isPro={isPro}
            onPressTime={() => handleEditTime('stepsReminder')}
            value={!!notifPrefs.stepsReminder}
            onValueChange={(v) => handleToggleNotif('stepsReminder', v)}
          />
          <SwitchRow
            icon="moon-outline" label="Remind me if sleep isn't logged"
            time={notifTimes.sleepReminder} isPro={isPro}
            onPressTime={() => handleEditTime('sleepReminder')}
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

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />

      <LanguagePickerModal
        visible={showLanguagePicker}
        colors={colors}
        current={i18n.language}
        onSelect={handleSelectLanguage}
        onClose={() => setShowLanguagePicker(false)}
      />

      {editingTimeKey && (
        <TimePickerModal
          colors={colors}
          initial={notifTimes[editingTimeKey]}
          onClose={() => setEditingTimeKey(null)}
          onSave={(hour, minute) => {
            setReminderTime(editingTimeKey, hour, minute);
            setEditingTimeKey(null);
          }}
        />
      )}
    </SafeAreaView>
  );
}

function TimePickerModal({ colors, initial, onClose, onSave }) {
  const DateTimePicker = require('@react-native-community/datetimepicker').default;
  const styles = createStyles(colors);
  const initialDate = useMemo(() => {
    const d = new Date();
    d.setHours(initial?.hour ?? 8, initial?.minute ?? 0, 0, 0);
    return d;
  }, [initial]);
  const [pending, setPending] = useState(initialDate);

  const handleChange = (event, selected) => {
    if (event.type === 'dismissed') { onClose(); return; }
    if (selected) {
      if (Platform.OS === 'android') {
        onSave(selected.getHours(), selected.getMinutes());
      } else {
        setPending(selected);
      }
    }
  };

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker value={pending} mode="time" display="default" onChange={handleChange} />
    );
  }

  return (
    <View style={styles.pickerOverlay}>
      <View style={styles.pickerSheet}>
        <DateTimePicker value={pending} mode="time" display="spinner" onChange={handleChange}
          textColor={colors.text} />
        <View style={styles.pickerActions}>
          <TouchableOpacity style={styles.pickerCancelBtn} onPress={onClose}>
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.pickerSaveBtn}
            onPress={() => onSave(pending.getHours(), pending.getMinutes())}
          >
            <Text style={styles.pickerSaveText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function LanguagePickerModal({ visible, colors, current, onSelect, onClose }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.langOverlay} onPress={onClose}>
        <Pressable style={styles.langSheet} onPress={() => {}}>
          <View style={styles.langHeader}>
            <Text style={styles.langTitle}>Select Language</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={ALL_LANGUAGES}
            keyExtractor={(item) => item.code}
            style={styles.langList}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.langRow}
                onPress={() => onSelect(item.code)}
              >
                <Text style={styles.langRowText}>{item.name}</Text>
                {current === item.code && (
                  <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                )}
              </TouchableOpacity>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
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

function SwitchRow({ icon, label, value, onValueChange, last, time, isPro, onPressTime }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.settingRow, !last && styles.rowBorder]}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <Text style={styles.settingLabel}>{label}</Text>
      {time && (
        <TouchableOpacity style={styles.timeChip} onPress={onPressTime}>
          <Text style={styles.timeChipText}>{formatTime(time.hour, time.minute)}</Text>
          {isPro
            ? <Ionicons name="pencil" size={11} color={colors.accent} />
            : <Ionicons name="lock-closed" size={11} color={colors.textDim} />}
        </TouchableOpacity>
      )}
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
  sectionHint: { fontSize: typography.xs, color: colors.textDim, marginTop: -4, marginBottom: 8 },
  timeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    backgroundColor: colors.bgElevated, marginRight: 8,
  },
  timeChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },
  pickerOverlay: {
    position: 'absolute', left: 0, right: 0, bottom: 0, top: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  pickerSheet: { backgroundColor: colors.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  pickerActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pickerCancelBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  pickerCancelText: { color: colors.textMuted, fontWeight: weight.medium },
  pickerSaveBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: colors.accent },
  pickerSaveText: { color: colors.bg, fontWeight: weight.bold },
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

  langOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  langSheet: {
    width: '100%', maxWidth: 360, maxHeight: '70%', borderRadius: 20,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  langHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  langTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  langList: { paddingHorizontal: 4 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  langRowText: { fontSize: typography.base, color: colors.text },
});
