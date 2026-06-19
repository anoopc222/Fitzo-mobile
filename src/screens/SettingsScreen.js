import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch, Modal, TextInput, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import { exportBackup, restoreBackup } from '../lib/backupRestore';

const NOTIFICATION_ITEMS = [
  { key: 'weigh_in', label: 'Daily weigh-in reminder', icon: 'scale-outline' },
  { key: 'workout', label: 'Workout reminders', icon: 'barbell-outline' },
  { key: 'sleep', label: 'Sleep log reminder', icon: 'moon-outline' },
  { key: 'steps', label: 'Steps goal reminder', icon: 'footsteps-outline' },
];

async function fetchSettings(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('calorie_target, protein_target, carbs_target, fats_target, step_goal, sleep_goal_hours, weight_goal_kg')
    .eq('id', userId)
    .single();
  return data;
}

async function updateSettings(userId, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
}

export default function SettingsScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { colors, isDark, setIsDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [notifs, setNotifs] = useState({ weigh_in: false, workout: false, sleep: false, steps: false });
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [goalsForm, setGoalsForm] = useState({});

  const { data: settings } = useQuery({
    queryKey: ['settings', user?.id],
    queryFn: () => fetchSettings(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (settings) {
      setGoalsForm({
        calorie_target: settings.calorie_target ? String(settings.calorie_target) : '',
        protein_target: settings.protein_target ? String(settings.protein_target) : '',
        carbs_target: settings.carbs_target ? String(settings.carbs_target) : '',
        fats_target: settings.fats_target ? String(settings.fats_target) : '',
        step_goal: settings.step_goal ? String(settings.step_goal) : '',
        sleep_goal_hours: settings.sleep_goal_hours ? String(settings.sleep_goal_hours) : '',
      });
    }
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: (fields) => updateSettings(user.id, fields),
    onSuccess: () => {
      qc.invalidateQueries(['settings', user.id]);
      setShowGoalsModal(false);
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const handleSaveGoals = () => {
    const fields = {};
    if (goalsForm.calorie_target) fields.calorie_target = parseInt(goalsForm.calorie_target, 10);
    if (goalsForm.protein_target) fields.protein_target = parseInt(goalsForm.protein_target, 10);
    if (goalsForm.carbs_target) fields.carbs_target = parseInt(goalsForm.carbs_target, 10);
    if (goalsForm.fats_target) fields.fats_target = parseInt(goalsForm.fats_target, 10);
    if (goalsForm.step_goal) fields.step_goal = parseInt(goalsForm.step_goal, 10);
    if (goalsForm.sleep_goal_hours) fields.sleep_goal_hours = parseFloat(goalsForm.sleep_goal_hours);
    updateMut.mutate(fields);
  };

  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleExportData = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const backup = await exportBackup(user.id);
      const json = JSON.stringify(backup, null, 2);
      const d = new Date();
      const fname = `fitzo_backup_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`;

      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fname; a.click();
        URL.revokeObjectURL(url);
      } else {
        const fileUri = FileSystem.documentDirectory + fname;
        await FileSystem.writeAsStringAsync(fileUri, json, { encoding: FileSystem.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: 'application/json', dialogTitle: 'Save FitZo backup' });
        }
      }
      Alert.alert('Export Complete', 'Your full backup has been saved.');
    } catch (e) {
      Alert.alert('Export Failed', e.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportData = () => {
    if (isRestoring) return;
    Alert.alert(
      'Restore from Backup',
      'This will replace ALL current data (workouts, weight, sleep, food, measurements, diet, health log) with the contents of the backup file. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose File', onPress: pickAndRestoreFile },
      ]
    );
  };

  const pickAndRestoreFile = async () => {
    if (isRestoring) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled) return;
      const fileUri = result.assets?.[0]?.uri;
      if (!fileUri) return;

      setIsRestoring(true);
      const text = Platform.OS === 'web'
        ? await (await fetch(fileUri)).text()
        : await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.UTF8 });

      const backup = JSON.parse(text);
      const counts = await restoreBackup(user.id, backup);
      await qc.invalidateQueries();

      const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ');
      Alert.alert('Restore Complete', `All data restored successfully.\n${summary}`);
    } catch (e) {
      Alert.alert('Restore Failed', e.message);
    } finally {
      setIsRestoring(false);
    }
  };

  const handlePasswordReset = () => {
    Alert.alert('Reset Password', `A password reset link will be sent to ${user?.email}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => supabase.auth.resetPasswordForEmail(user?.email) },
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Account ─────────────────────────────────────────────── */}
        <SectionHeader title="Account" />
        <View style={styles.card}>
          <SettingRow icon="mail-outline" label="Email" value={user?.email} />
          <SettingRow icon="key-outline" label="Change Password" chevron onPress={handlePasswordReset} />
          <SettingRow icon="person-outline" label="Edit Profile" chevron last
            onPress={() => navigation.navigate('Profile')} />
        </View>

        {/* ── Goals ───────────────────────────────────────────────── */}
        <SectionHeader title="Daily Goals" />
        <View style={styles.card}>
          <SettingRow icon="flame-outline" label="Calories"
            value={settings?.calorie_target ? `${settings.calorie_target} kcal` : 'Not set'} />
          <SettingRow icon="barbell-outline" label="Protein"
            value={settings?.protein_target ? `${settings.protein_target}g` : 'Not set'} />
          <SettingRow icon="footsteps-outline" label="Steps"
            value={settings?.step_goal ? `${settings.step_goal.toLocaleString()}` : 'Not set'} />
          <SettingRow icon="moon-outline" label="Sleep"
            value={settings?.sleep_goal_hours ? `${settings.sleep_goal_hours}h` : 'Not set'}
            last chevron onPress={() => {
              if (settings) setGoalsForm({
                calorie_target: settings.calorie_target ? String(settings.calorie_target) : '',
                protein_target: settings.protein_target ? String(settings.protein_target) : '',
                carbs_target: settings.carbs_target ? String(settings.carbs_target) : '',
                fats_target: settings.fats_target ? String(settings.fats_target) : '',
                step_goal: settings.step_goal ? String(settings.step_goal) : '',
                sleep_goal_hours: settings.sleep_goal_hours ? String(settings.sleep_goal_hours) : '',
              });
              setShowGoalsModal(true);
            }}
          />
        </View>
        <TouchableOpacity style={styles.editGoalsBtn} onPress={() => setShowGoalsModal(true)}>
          <Ionicons name="create-outline" size={16} color={colors.accent} />
          <Text style={styles.editGoalsBtnText}>Edit All Goals</Text>
        </TouchableOpacity>

        {/* ── Theme ───────────────────────────────────────────────── */}
        <SectionHeader title="Appearance" />
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.themeOption, styles.rowBorder]}
            onPress={() => setIsDark(true)}
          >
            <Ionicons name="moon" size={18} color={isDark ? colors.accent : colors.textMuted} />
            <Text style={[styles.switchLabel, isDark && { color: colors.accent, fontWeight: weight.semibold }]}>
              Dark
            </Text>
            {isDark && <Ionicons name="checkmark-circle" size={18} color={colors.accent} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.themeOption}
            onPress={() => setIsDark(false)}
          >
            <Ionicons name="sunny" size={18} color={!isDark ? colors.accent : colors.textMuted} />
            <Text style={[styles.switchLabel, !isDark && { color: colors.accent, fontWeight: weight.semibold }]}>
              Light
            </Text>
            {!isDark && <Ionicons name="checkmark-circle" size={18} color={colors.accent} />}
          </TouchableOpacity>
        </View>

        {/* ── Notifications ───────────────────────────────────────── */}
        <SectionHeader title="Notifications" />
        <View style={styles.card}>
          {NOTIFICATION_ITEMS.map((item, i) => (
            <View key={item.key} style={[styles.switchRow, i < NOTIFICATION_ITEMS.length - 1 && styles.rowBorder]}>
              <Ionicons name={item.icon} size={18} color={colors.textMuted} />
              <Text style={styles.switchLabel}>{item.label}</Text>
              <Switch
                value={notifs[item.key]}
                onValueChange={v => setNotifs(p => ({ ...p, [item.key]: v }))}
                trackColor={{ false: colors.bgElevated, true: colors.accent + '88' }}
                thumbColor={notifs[item.key] ? colors.accent : colors.textDim}
              />
            </View>
          ))}
        </View>

        {/* ── Data ────────────────────────────────────────────────── */}
        <SectionHeader title="Data & Sync" />
        <View style={styles.card}>
          <View style={styles.syncStatus}>
            <View style={styles.syncDot} />
            <Text style={styles.syncText}>All data syncs live to Supabase cloud</Text>
          </View>
          <SettingRow icon="cloud-upload-outline" label={isExporting ? 'Exporting…' : 'Export Data'} chevron
            onPress={(isExporting || isRestoring) ? undefined : handleExportData} />
          <SettingRow icon="cloud-download-outline" label={isRestoring ? 'Restoring…' : 'Import / Restore'} chevron last
            onPress={(isExporting || isRestoring) ? undefined : handleImportData} />
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

        <Text style={styles.version}>FitZo v1.0.0 · Built with Supabase + Expo</Text>
      </ScrollView>

      {/* Goals Modal */}
      <Modal visible={showGoalsModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Edit Daily Goals</Text>
              <TouchableOpacity onPress={() => setShowGoalsModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {[
                { key: 'calorie_target', label: 'Calorie Target', unit: 'kcal', numeric: true },
                { key: 'protein_target', label: 'Protein Target', unit: 'g', numeric: true },
                { key: 'carbs_target', label: 'Carbs Target', unit: 'g', numeric: true },
                { key: 'fats_target', label: 'Fats Target', unit: 'g', numeric: true },
                { key: 'step_goal', label: 'Step Goal', unit: 'steps', numeric: true },
                { key: 'sleep_goal_hours', label: 'Sleep Goal', unit: 'hours', numeric: true },
              ].map(field => (
                <View key={field.key} style={styles.goalField}>
                  <Text style={styles.goalFieldLabel}>{field.label}</Text>
                  <View style={styles.goalFieldRow}>
                    <TextInput
                      style={styles.goalFieldInput}
                      placeholder="0"
                      placeholderTextColor={colors.textDim}
                      value={goalsForm[field.key] ?? ''}
                      onChangeText={v => setGoalsForm(p => ({ ...p, [field.key]: v }))}
                      keyboardType="numeric"
                    />
                    <Text style={styles.goalFieldUnit}>{field.unit}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowGoalsModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveGoals} disabled={updateMut.isPending}>
                <Text style={styles.saveBtnText}>{updateMut.isPending ? 'Saving…' : 'Save Goals'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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

  editGoalsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
    paddingVertical: 8, marginBottom: 4,
  },
  editGoalsBtnText: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.semibold },

  themeOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  switchLabel: { flex: 1, fontSize: typography.base, color: colors.text },

  syncStatus: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  syncText: { flex: 1, fontSize: typography.sm, color: colors.textMuted },

  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  dangerLabel: { fontSize: typography.base, color: colors.danger, fontWeight: weight.medium },

  version: { textAlign: 'center', fontSize: typography.xs, color: colors.textDim, marginTop: 24 },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: {
    backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 8, maxHeight: '80%',
  },
  sheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  goalField: { marginBottom: 14 },
  goalFieldLabel: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold, marginBottom: 6 },
  goalFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  goalFieldInput: {
    flex: 1, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 12,
    color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border,
  },
  goalFieldUnit: { fontSize: typography.sm, color: colors.textMuted, minWidth: 40 },
  sheetBtns: { flexDirection: 'row', gap: 12, paddingVertical: 16 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold },
});
