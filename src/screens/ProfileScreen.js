import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import DatePickerField from '../components/ui/DatePickerField';
import SkeletonScreen from '../components/Skeleton';

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const GOALS = [
  'Weight Loss', 'Fat Loss', 'Muscle Gain', 'Recomposition',
  'Fat Loss & Recomp', 'Maintain & Tone', 'Strength & Power',
  'Athletic Performance', 'Endurance', 'General Health',
];

const GOAL_KEYS = {
  'Weight Loss': 'goalWeightLoss',
  'Fat Loss': 'goalFatLoss',
  'Muscle Gain': 'goalMuscleGain',
  'Recomposition': 'goalRecomposition',
  'Fat Loss & Recomp': 'goalFatLossRecomp',
  'Maintain & Tone': 'goalMaintainTone',
  'Strength & Power': 'goalStrengthPower',
  'Athletic Performance': 'goalAthleticPerformance',
  'Endurance': 'goalEndurance',
  'General Health': 'goalGeneralHealth',
};

const SEX_OPTIONS = ['Male', 'Female', 'Other'];

const SEX_KEYS = {
  Male: 'sexMale',
  Female: 'sexFemale',
  Other: 'sexOther',
};

export async function fetchProfile(userId) {
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
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [showGoalPicker, setShowGoalPicker] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => fetchProfile(user.id),
    enabled: !!user?.id,
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
    onMutate: async (fields) => {
      await qc.cancelQueries(['profile', user.id]);
      const previous = qc.getQueryData(['profile', user.id]);
      qc.setQueryData(['profile', user.id], (old) => old ? { ...old, profile: { ...old.profile, ...fields } } : old);
      setEditing(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['profile', user.id], context.previous);
      Alert.alert(t('profile.error'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['profile', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
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

  const profile = data?.profile;
  const initial = (form.full_name?.[0] ?? user?.email?.[0] ?? 'F').toUpperCase();
  const weightLost = (data?.firstWeightKg && data?.currentWeightKg)
    ? (data.firstWeightKg - data.currentWeightKg).toFixed(1)
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title={t('profile.title')}
        colors={colors}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity onPress={() => editing ? handleSave() : setEditing(true)} disabled={updateMut.isPending}>
            {updateMut.isPending
              ? <ActivityIndicator color={colors.accent} />
              : <Text style={styles.editBtn}>{editing ? t('profile.save') : t('profile.edit')}</Text>
            }
          </TouchableOpacity>
        )}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <SkeletonScreen cards={4} linesPerCard={3} />
        ) : (
          <>
            {/* Avatar */}
            <View style={styles.avatarSection}>
              <View style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
              </View>
              {editing ? (
                <TextInput style={styles.nameInput} placeholder={t('profile.fullNamePlaceholder')} placeholderTextColor={colors.textDim}
                  value={form.full_name} onChangeText={v => setForm(p => ({ ...p, full_name: v }))} />
              ) : (
                <Text style={styles.profileName}>{form.full_name || t('profile.addYourName')}</Text>
              )}
              <Text style={styles.profileEmail}>{user?.email}</Text>
            </View>

            {/* Stats tiles */}
            <View style={styles.statsRow}>
              <StatTile label={t('profile.sessions')} value={data?.sessionCount ?? 0} icon="barbell" color={colors.accent} />
              <StatTile label={t('profile.weightLogs')} value={data?.weightLogCount ?? 0} icon="scale" color="#e879f9" />
              {weightLost !== null && (
                <StatTile label={t('profile.weightLost')} value={`${Math.abs(weightLost)}kg`} icon="trending-down" color={colors.success} />
              )}
            </View>

            {/* Goal */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('profile.fitnessGoal')}</Text>
              {editing ? (
                <>
                  <TouchableOpacity style={styles.goalSelector} onPress={() => setShowGoalPicker(!showGoalPicker)}>
                    <Text style={[styles.goalSelectorText, !form.goal && { color: colors.textDim }]}>
                      {form.goal ? t(`profile.${GOAL_KEYS[form.goal]}`) : t('profile.selectYourGoal')}
                    </Text>
                    <Ionicons name={showGoalPicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  {showGoalPicker && (
                    <View style={styles.goalList}>
                      {GOALS.map(g => (
                        <TouchableOpacity key={g} style={[styles.goalOption, form.goal === g && styles.goalOptionActive]}
                          onPress={() => { setForm(p => ({ ...p, goal: g })); setShowGoalPicker(false); }}>
                          <Text style={[styles.goalOptionText, form.goal === g && { color: colors.bg }]}>{t(`profile.${GOAL_KEYS[g]}`)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.goalDisplay}>
                  <Ionicons name="trophy" size={16} color={colors.accent} />
                  <Text style={styles.goalDisplayText}>{form.goal ? t(`profile.${GOAL_KEYS[form.goal]}`) : t('profile.notSet')}</Text>
                </View>
              )}
            </View>

            {/* Body stats */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('profile.bodyStats')}</Text>
              <View style={styles.bodyGrid}>
                <BodyField
                  label={t('profile.heightCm')} value={form.height_cm}
                  editing={editing} onChange={v => setForm(p => ({ ...p, height_cm: v }))}
                  placeholder="175" numeric
                />
                <View style={styles.bodyField}>
                  <Text style={styles.bodyFieldLabel}>{t('profile.dateOfBirth')}</Text>
                  {editing ? (
                    <DatePickerField
                      value={form.date_of_birth}
                      onChange={v => setForm(p => ({ ...p, date_of_birth: v }))}
                      colors={colors}
                      maxDate={localDateStr(new Date())}
                    />
                  ) : (
                    <Text style={styles.bodyFieldValue}>{form.date_of_birth || '--'}</Text>
                  )}
                </View>
              </View>
              <View style={styles.bodyGrid}>
                <View style={styles.bodyField}>
                  <Text style={styles.bodyFieldLabel}>{t('profile.sex')}</Text>
                  {editing ? (
                    <View style={styles.sexPicker}>
                      {SEX_OPTIONS.map(s => (
                        <TouchableOpacity key={s} style={[styles.sexOpt, form.sex === s && styles.sexOptActive]}
                          onPress={() => setForm(p => ({ ...p, sex: s }))}>
                          <Text style={[styles.sexOptText, form.sex === s && { color: colors.bg }]}>{t(`profile.${SEX_KEYS[s]}`)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.bodyFieldValue}>{form.sex ? t(`profile.${SEX_KEYS[form.sex]}`) : '--'}</Text>
                  )}
                </View>
              </View>
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

});
