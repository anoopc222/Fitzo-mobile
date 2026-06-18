import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';

const GOALS = [
  'Weight Loss', 'Fat Loss', 'Muscle Gain', 'Recomposition',
  'Fat Loss & Recomp', 'Maintain & Tone', 'Strength & Power',
  'Athletic Performance', 'Endurance', 'General Health',
];

const SEX_OPTIONS = ['Male', 'Female', 'Other'];

async function fetchProfile(userId) {
  const [profile, stats] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).single(),
    Promise.all([
      supabase.from('workout_sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('weight_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('weight_logs').select('weight').eq('user_id', userId).order('logged_at', { ascending: true }).limit(1),
      supabase.from('weight_logs').select('weight').eq('user_id', userId).order('logged_at', { ascending: false }).limit(1),
    ]),
  ]);
  const [sessCount, weightCount, firstWeight, lastWeight] = stats;
  return {
    profile: profile.data,
    sessionCount: sessCount.count ?? 0,
    weightLogCount: weightCount.count ?? 0,
    firstWeightKg: firstWeight.data?.[0]?.weight ?? null,
    currentWeightKg: lastWeight.data?.[0]?.weight ?? null,
  };
}

async function updateProfile(userId, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', userId);
  if (error) throw error;
}

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [showGoalPicker, setShowGoalPicker] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (data?.profile && !editing) {
      setForm({
        full_name: data.profile.full_name ?? '',
        goal: data.profile.goal ?? '',
        height_cm: data.profile.height_cm ? String(data.profile.height_cm) : '',
        date_of_birth: data.profile.date_of_birth ?? '',
        sex: data.profile.sex ?? '',
        bio: data.profile.bio ?? '',
      });
    }
  }, [data, editing]);

  const updateMut = useMutation({
    mutationFn: (fields) => updateProfile(user.id, fields),
    onSuccess: () => {
      qc.invalidateQueries(['profile', user.id]);
      qc.invalidateQueries(['home', user.id]);
      setEditing(false);
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const handleSave = () => {
    const fields = {
      full_name: form.full_name || null,
      goal: form.goal || null,
      height_cm: form.height_cm ? parseFloat(form.height_cm) : null,
      date_of_birth: form.date_of_birth || null,
      sex: form.sex || null,
      bio: form.bio || null,
    };
    updateMut.mutate(fields);
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete Account', 'This will permanently delete your account and all data. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Account', style: 'destructive', onPress: async () => {
          try {
            await supabase.rpc('delete_user');
            await signOut();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const profile = data?.profile;
  const initial = (form.full_name?.[0] ?? user?.email?.[0] ?? 'F').toUpperCase();
  const weightLost = (data?.firstWeightKg && data?.currentWeightKg)
    ? (data.firstWeightKg - data.currentWeightKg).toFixed(1)
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={() => editing ? handleSave() : setEditing(true)} disabled={updateMut.isPending}>
          {updateMut.isPending
            ? <ActivityIndicator color={colors.accent} />
            : <Text style={styles.editBtn}>{editing ? 'Save' : 'Edit'}</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
          <>
            {/* Avatar */}
            <View style={styles.avatarSection}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
              </View>
              {editing ? (
                <TextInput style={styles.nameInput} placeholder="Full Name" placeholderTextColor={colors.textDim}
                  value={form.full_name} onChangeText={v => setForm(p => ({ ...p, full_name: v }))} />
              ) : (
                <Text style={styles.profileName}>{form.full_name || 'Add your name'}</Text>
              )}
              <Text style={styles.profileEmail}>{user?.email}</Text>
            </View>

            {/* Stats tiles */}
            <View style={styles.statsRow}>
              <StatTile label="Sessions" value={data?.sessionCount ?? 0} icon="barbell" color={colors.accent} />
              <StatTile label="Weight Logs" value={data?.weightLogCount ?? 0} icon="scale" color="#e879f9" />
              {weightLost !== null && (
                <StatTile label="Weight Lost" value={`${Math.abs(weightLost)}kg`} icon="trending-down" color={colors.success} />
              )}
            </View>

            {/* Goal */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Fitness Goal</Text>
              {editing ? (
                <>
                  <TouchableOpacity style={styles.goalSelector} onPress={() => setShowGoalPicker(!showGoalPicker)}>
                    <Text style={[styles.goalSelectorText, !form.goal && { color: colors.textDim }]}>
                      {form.goal || 'Select your goal'}
                    </Text>
                    <Ionicons name={showGoalPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  {showGoalPicker && (
                    <View style={styles.goalList}>
                      {GOALS.map(g => (
                        <TouchableOpacity key={g} style={[styles.goalOption, form.goal === g && styles.goalOptionActive]}
                          onPress={() => { setForm(p => ({ ...p, goal: g })); setShowGoalPicker(false); }}>
                          <Text style={[styles.goalOptionText, form.goal === g && { color: colors.bg }]}>{g}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.goalDisplay}>
                  <Ionicons name="trophy" size={16} color={colors.accent} />
                  <Text style={styles.goalDisplayText}>{form.goal || 'Not set'}</Text>
                </View>
              )}
            </View>

            {/* Body stats */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Body Stats</Text>
              <View style={styles.bodyGrid}>
                <BodyField
                  label="Height (cm)" value={form.height_cm}
                  editing={editing} onChange={v => setForm(p => ({ ...p, height_cm: v }))}
                  placeholder="175" numeric
                />
                <BodyField
                  label="Date of Birth" value={form.date_of_birth}
                  editing={editing} onChange={v => setForm(p => ({ ...p, date_of_birth: v }))}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View style={styles.bodyGrid}>
                <View style={styles.bodyField}>
                  <Text style={styles.bodyFieldLabel}>Sex</Text>
                  {editing ? (
                    <View style={styles.sexPicker}>
                      {SEX_OPTIONS.map(s => (
                        <TouchableOpacity key={s} style={[styles.sexOpt, form.sex === s && styles.sexOptActive]}
                          onPress={() => setForm(p => ({ ...p, sex: s }))}>
                          <Text style={[styles.sexOptText, form.sex === s && { color: colors.bg }]}>{s}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.bodyFieldValue}>{form.sex || '--'}</Text>
                  )}
                </View>
              </View>
            </View>

            {/* Sign out + Delete */}
            <View style={styles.dangerSection}>
              <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
                <Ionicons name="log-out-outline" size={18} color={colors.text} />
                <Text style={styles.signOutText}>Sign Out</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={styles.deleteBtnText}>Delete Account</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ label, value, icon, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.statTile}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.statTileVal, { color }]}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

function BodyField({ label, value, editing, onChange, placeholder, numeric }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.bodyField}>
      <Text style={styles.bodyFieldLabel}>{label}</Text>
      {editing ? (
        <TextInput style={styles.bodyFieldInput} placeholder={placeholder} placeholderTextColor={colors.textDim}
          value={value} onChangeText={onChange} keyboardType={numeric ? 'numeric' : 'default'} />
      ) : (
        <Text style={styles.bodyFieldValue}>{value || '--'}</Text>
      )}
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  editBtn: { fontSize: typography.base, color: colors.accent, fontWeight: weight.semibold },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatarWrap: { padding: 3, borderRadius: 42, borderWidth: 2.5, borderColor: colors.accent, marginBottom: 12 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, fontWeight: weight.black, color: colors.bg },
  profileName: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text, marginBottom: 4 },
  profileEmail: { fontSize: typography.xs, color: colors.textMuted },
  nameInput: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text, textAlign: 'center', borderBottomWidth: 1, borderBottomColor: colors.accent, paddingBottom: 4, marginBottom: 4, minWidth: 200 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statTile: { flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border },
  statTileVal: { fontSize: typography.lg, fontWeight: weight.bold },
  statTileLabel: { fontSize: 10, color: colors.textDim, textAlign: 'center' },

  section: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 12, textTransform: 'uppercase' },

  goalSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.bgElevated, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
  goalSelectorText: { fontSize: typography.base, color: colors.text },
  goalList: { backgroundColor: colors.bgElevated, borderRadius: 10, marginTop: 6, overflow: 'hidden' },
  goalOption: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  goalOptionActive: { backgroundColor: colors.accent },
  goalOptionText: { fontSize: typography.sm, color: colors.text },
  goalDisplay: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  goalDisplayText: { fontSize: typography.base, color: colors.text, fontWeight: weight.medium },

  bodyGrid: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  bodyField: { flex: 1 },
  bodyFieldLabel: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold, marginBottom: 6 },
  bodyFieldValue: { fontSize: typography.base, color: colors.text, fontWeight: weight.medium },
  bodyFieldInput: { backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10, color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border },

  sexPicker: { flexDirection: 'row', gap: 6 },
  sexOpt: { flex: 1, padding: 8, borderRadius: 8, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  sexOptActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  sexOptText: { fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold },

  dangerSection: { gap: 10, marginTop: 8 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  signOutText: { fontSize: typography.base, color: colors.text, fontWeight: weight.medium },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.danger + '18', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.danger + '44' },
  deleteBtnText: { fontSize: typography.base, color: colors.danger, fontWeight: weight.medium },
});
