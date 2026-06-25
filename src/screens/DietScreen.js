import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';

// ─── Data Layer ─────────────────────────────────────────────────────────────
export async function fetchDietPlans(userId) {
  const { data, error } = await supabase
    .from('diet_plans')
    .select('*')
    .eq('user_id', userId)
    .order('week_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function saveDietWeek(userId, weekNumber, fields) {
  const { error } = await supabase
    .from('diet_plans')
    .upsert({ user_id: userId, week_number: weekNumber, ...fields }, { onConflict: 'user_id,week_number' });
  if (error) throw error;
}

async function saveDietNotes(userId, weekNumber, { cals_burned, overview }) {
  const { error } = await supabase
    .from('diet_plans')
    .update({ cals_burned, overview })
    .eq('user_id', userId)
    .eq('week_number', weekNumber);
  if (error) throw error;
}

async function deleteDietWeek(userId, weekNumber) {
  const { error } = await supabase.from('diet_plans').delete().eq('user_id', userId).eq('week_number', weekNumber);
  if (error) throw error;
}

export default function DietScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [activeWeek, setActiveWeek] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorWeek, setEditorWeek] = useState(null); // null = new week

  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fats, setFats] = useState('');
  const [water, setWater] = useState('3L');
  const [stepsGoal, setStepsGoal] = useState('12,000');
  const [veggies, setVeggies] = useState('250-300g');
  const [cardioText, setCardioText] = useState('');
  const [sessionsNote, setSessionsNote] = useState('');

  const [calsBurned, setCalsBurned] = useState('');
  const [overview, setOverview] = useState('');

  const { data: plans = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['dietPlans', user?.id],
    queryFn: () => fetchDietPlans(user.id),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!plans.length) { setActiveWeek(null); return; }
    if (activeWeek === null || !plans.find(p => p.week_number === activeWeek)) {
      setActiveWeek(plans[plans.length - 1].week_number);
    }
  }, [plans]);

  const plan = plans.find(p => p.week_number === activeWeek) || null;

  useEffect(() => {
    if (plan) { setCalsBurned(plan.cals_burned || ''); setOverview(plan.overview || ''); }
  }, [plan?.id]);

  const weekMut = useMutation({
    mutationFn: ({ weekNumber, fields }) => saveDietWeek(user.id, weekNumber, fields),
    onMutate: async ({ weekNumber, fields }) => {
      await qc.cancelQueries(['dietPlans', user.id]);
      const previous = qc.getQueryData(['dietPlans', user.id]);
      qc.setQueryData(['dietPlans', user.id], (old) => {
        if (!old) return old;
        const idx = old.findIndex(p => p.week_number === weekNumber);
        if (idx === -1) {
          const merged = [...old, { id: `optimistic-${weekNumber}`, user_id: user.id, week_number: weekNumber, ...fields }];
          return merged.sort((a, b) => a.week_number - b.week_number);
        }
        const updated = [...old];
        updated[idx] = { ...updated[idx], ...fields };
        return updated;
      });
      setActiveWeek(weekNumber);
      setShowEditor(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['dietPlans', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['dietPlans', user.id]);
    },
  });

  const notesMut = useMutation({
    mutationFn: ({ weekNumber, fields }) => saveDietNotes(user.id, weekNumber, fields),
    onMutate: async ({ weekNumber, fields }) => {
      await qc.cancelQueries(['dietPlans', user.id]);
      const previous = qc.getQueryData(['dietPlans', user.id]);
      qc.setQueryData(['dietPlans', user.id], (old) => {
        if (!old) return old;
        return old.map(p => p.week_number === weekNumber ? { ...p, ...fields } : p);
      });
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['dietPlans', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['dietPlans', user.id]);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (weekNumber) => deleteDietWeek(user.id, weekNumber),
    onMutate: async (weekNumber) => {
      await qc.cancelQueries(['dietPlans', user.id]);
      const previous = qc.getQueryData(['dietPlans', user.id]);
      qc.setQueryData(['dietPlans', user.id], (old) => {
        if (!old) return old;
        return old.filter(p => p.week_number !== weekNumber);
      });
      setShowEditor(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['dietPlans', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['dietPlans', user.id]);
    },
  });

  const calories = useMemo(() => {
    const p = parseFloat(protein) || 0, c = parseFloat(carbs) || 0, f = parseFloat(fats) || 0;
    const cal = Math.round(p * 4 + c * 4 + f * 9);
    return cal > 0 ? cal : 0;
  }, [protein, carbs, fats]);

  const openEditor = (weekNum) => {
    setEditorWeek(weekNum);
    if (weekNum) {
      const p = plans.find(w => w.week_number === weekNum);
      setProtein(String(p?.protein ?? ''));
      setCarbs(String(p?.carbs ?? ''));
      setFats(String(p?.fats ?? ''));
      setWater(p?.water ?? '3L');
      setStepsGoal(p?.steps_goal ?? '12,000');
      setVeggies(p?.veggies ?? '250-300g');
      setCardioText((p?.cardio ?? []).join('\n'));
      setSessionsNote(p?.sessions_note ?? '');
    } else {
      setProtein(''); setCarbs(''); setFats('');
      setWater('3L'); setStepsGoal('12,000'); setVeggies('250-300g');
      setCardioText(''); setSessionsNote('');
    }
    setShowEditor(true);
  };

  const copyLastWeek = () => {
    if (!plans.length) return;
    let src;
    if (editorWeek) {
      const idx = plans.findIndex(p => p.week_number === editorWeek);
      src = idx > 0 ? plans[idx - 1] : plans[plans.length - 1 !== idx ? plans.length - 1 : 0];
    } else {
      src = plans[plans.length - 1];
    }
    if (!src) return;
    setProtein(String(src.protein ?? ''));
    setCarbs(String(src.carbs ?? ''));
    setFats(String(src.fats ?? ''));
    setWater(src.water ?? '3L');
    setStepsGoal(src.steps_goal ?? '12,000');
    setVeggies(src.veggies ?? '250-300g');
    setCardioText((src.cardio ?? []).join('\n'));
    setSessionsNote(src.sessions_note ?? '');
  };

  const saveWeek = () => {
    const weekNumber = editorWeek || (plans.length ? Math.max(...plans.map(p => p.week_number)) + 1 : 1);
    const cardio = cardioText.trim() ? cardioText.split('\n').map(s => s.trim()).filter(Boolean) : [];
    weekMut.mutate({
      weekNumber,
      fields: {
        calories,
        protein: parseInt(protein) || 0,
        carbs: parseInt(carbs) || 0,
        fats: parseInt(fats) || 0,
        water: water.trim() || '3L',
        steps_goal: stepsGoal.trim() || '12,000',
        veggies: veggies.trim() || '250-300g',
        cardio,
        sessions_note: sessionsNote.trim(),
      },
    });
  };

  const confirmDelete = () => {
    if (!editorWeek) { setShowEditor(false); return; }
    if (plans.length <= 1) { Alert.alert('Cannot delete', 'Cannot delete the only week'); return; }
    Alert.alert('Delete Week', `Delete Week ${editorWeek}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(editorWeek) },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="DIET PLAN" colors={colors} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        <Text style={styles.titleRow}>
          <Text style={styles.titleWhite}>DIET </Text>
          <Text style={styles.titleAccent}>PLAN</Text>
        </Text>

        {isLoading ? (
          <SkeletonScreen cards={4} linesPerCard={3} />
        ) : !plans.length ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <Text style={{ fontSize: 36 }}>🥗</Text>
            <Text style={styles.emptyText}>No weeks yet. Tap + New Week.</Text>
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekNavScroll} contentContainerStyle={styles.weekNav}>
              {plans.map(w => (
                <TouchableOpacity
                  key={w.week_number}
                  onPress={() => setActiveWeek(w.week_number)}
                  style={[styles.weekPill, activeWeek === w.week_number && styles.weekPillActive]}
                >
                  <Text style={[styles.weekPillText, activeWeek === w.week_number && styles.weekPillTextActive]}>
                    Week {w.week_number}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.editWeekBtn} onPress={() => openEditor(activeWeek)}>
              <Text style={styles.editWeekBtnText}>✏️ Edit Week {activeWeek}</Text>
            </TouchableOpacity>

            {plan && (
              <>
                <View style={styles.calBar}>
                  <Text style={styles.calLbl}>Daily Target</Text>
                  <Text style={styles.calVal}>{plan.calories} kcal</Text>
                </View>

                <View style={styles.macroRow}>
                  <View style={styles.macroTile}>
                    <Text style={styles.macroIcon}>🍞</Text>
                    <Text style={[styles.macroG, { color: '#fbbf24' }]}>{plan.carbs}g</Text>
                    <Text style={styles.macroNm}>CARBS</Text>
                  </View>
                  <View style={styles.macroTile}>
                    <Text style={styles.macroIcon}>🍗</Text>
                    <Text style={[styles.macroG, { color: '#f472b6' }]}>{plan.protein}g</Text>
                    <Text style={styles.macroNm}>PROTEIN</Text>
                  </View>
                  <View style={styles.macroTile}>
                    <Text style={styles.macroIcon}>🧀</Text>
                    <Text style={[styles.macroG, { color: '#38bdf8' }]}>{plan.fats}g</Text>
                    <Text style={styles.macroNm}>FATS</Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <View style={styles.infoTile}>
                    <Text style={styles.infoIcon}>🥒</Text>
                    <Text style={styles.infoVal}>{plan.veggies}</Text>
                    <Text style={styles.infoLbl}>VEGGIES</Text>
                  </View>
                  <View style={styles.infoTile}>
                    <Text style={styles.infoIcon}>💧</Text>
                    <Text style={styles.infoVal}>{plan.water}</Text>
                    <Text style={styles.infoLbl}>WATER</Text>
                  </View>
                  <View style={styles.infoTile}>
                    <Text style={styles.infoIcon}>🚶</Text>
                    <Text style={styles.infoVal}>{plan.steps_goal}</Text>
                    <Text style={styles.infoLbl}>STEPS GOAL</Text>
                  </View>
                </View>

                <View style={styles.cardioTile}>
                  <Text style={styles.cardioHead}>🏃 CARDIO PLAN</Text>
                  {(plan.cardio ?? []).map((c, i) => (
                    <View key={i} style={styles.cardioLine}>
                      <View style={styles.cardioDot} />
                      <Text style={styles.cardioLineText}>{c}</Text>
                    </View>
                  ))}
                  {!!plan.sessions_note && (
                    <Text style={styles.cardioNote}>{plan.sessions_note}</Text>
                  )}
                </View>

                <View style={styles.dietLogTile}>
                  <Text style={styles.weekNotesLabel}>WEEK NOTES</Text>
                  <Text style={styles.formLabel}>CALORIES BURNED</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 840 kcal"
                    placeholderTextColor={colors.textDim}
                    value={calsBurned}
                    onChangeText={setCalsBurned}
                  />
                  <Text style={[styles.formLabel, { marginTop: 12 }]}>OVERVIEW</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="How did the week go?"
                    placeholderTextColor={colors.textDim}
                    value={overview}
                    onChangeText={setOverview}
                  />
                  <TouchableOpacity
                    style={styles.saveNotesBtn}
                    onPress={() => notesMut.mutate({ weekNumber: activeWeek, fields: { cals_burned: calsBurned.trim(), overview: overview.trim() } })}
                    disabled={notesMut.isPending}
                  >
                    {notesMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveNotesBtnText}>Save Notes</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
        <View style={{ height: 90 }} />
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => openEditor(null)}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      <BottomSheet visible={showEditor} onClose={() => setShowEditor(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{editorWeek ? `Edit Week ${editorWeek}` : `New Week ${plans.length ? Math.max(...plans.map(p => p.week_number)) + 1 : 1}`}</Text>
          <TouchableOpacity onPress={() => setShowEditor(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 480 }}>
          <View style={styles.sheetFieldRow}>
            <View style={styles.sheetFieldCol}>
              <View style={styles.calLabelRow}>
                <Text style={styles.sheetFieldLabel}>CALORIES</Text>
                <View style={styles.autoChip}><Text style={styles.autoChipText}>AUTO</Text></View>
              </View>
              <View style={[styles.sheetInput, styles.disabledInput]}>
                <Text style={{ color: colors.textDim }}>{calories || 'auto'}</Text>
              </View>
            </View>
            <View style={styles.sheetFieldCol}>
              <Text style={styles.sheetFieldLabel}>PROTEIN (G)</Text>
              <TextInput style={styles.sheetInput} value={protein} onChangeText={setProtein} keyboardType="numeric" placeholderTextColor={colors.textDim} />
            </View>
          </View>

          <View style={styles.sheetFieldRow}>
            <View style={styles.sheetFieldCol}>
              <Text style={styles.sheetFieldLabel}>CARBS (G)</Text>
              <TextInput style={styles.sheetInput} value={carbs} onChangeText={setCarbs} keyboardType="numeric" placeholderTextColor={colors.textDim} />
            </View>
            <View style={styles.sheetFieldCol}>
              <Text style={styles.sheetFieldLabel}>FATS (G)</Text>
              <TextInput style={styles.sheetInput} value={fats} onChangeText={setFats} keyboardType="numeric" placeholderTextColor={colors.textDim} />
            </View>
          </View>

          <View style={styles.sheetFieldRow}>
            <View style={styles.sheetFieldCol}>
              <Text style={styles.sheetFieldLabel}>WATER</Text>
              <TextInput style={styles.sheetInput} value={water} onChangeText={setWater} placeholderTextColor={colors.textDim} />
            </View>
            <View style={styles.sheetFieldCol}>
              <Text style={styles.sheetFieldLabel}>STEPS GOAL</Text>
              <TextInput style={styles.sheetInput} value={stepsGoal} onChangeText={setStepsGoal} placeholderTextColor={colors.textDim} />
            </View>
          </View>

          <View style={styles.sheetFieldColFull}>
            <Text style={styles.sheetFieldLabel}>VEGGIES</Text>
            <TextInput style={styles.sheetInput} value={veggies} onChangeText={setVeggies} placeholderTextColor={colors.textDim} />
          </View>

          <View style={styles.sheetFieldColFull}>
            <Text style={styles.sheetFieldLabel}>CARDIO PLAN (ONE PER LINE)</Text>
            <TextInput
              style={[styles.sheetInput, styles.multiline]}
              value={cardioText}
              onChangeText={setCardioText}
              multiline
              placeholderTextColor={colors.textDim}
            />
          </View>

          <View style={styles.sheetFieldColFull}>
            <Text style={styles.sheetFieldLabel}>SESSIONS NOTE</Text>
            <TextInput
              style={[styles.sheetInput, styles.multiline]}
              value={sessionsNote}
              onChangeText={setSessionsNote}
              multiline
              placeholderTextColor={colors.textDim}
            />
          </View>

          <View style={styles.sheetActionRow}>
            <TouchableOpacity style={styles.copyBtn} onPress={copyLastWeek} disabled={!plans.length}>
              <Text style={styles.copyBtnText}>📋 Copy Last Week</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={saveWeek} disabled={weekMut.isPending}>
              {weekMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Week</Text>}
            </TouchableOpacity>
          </View>

          {!!editorWeek && (
            <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
              <Text style={styles.deleteBtnText}>🗑️ Delete This Week</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  appHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  },
  logoText: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.accent },
  screenLabel: { fontSize: typography.xs, fontWeight: weight.bold, letterSpacing: 2, color: colors.textMuted },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },

  content: { paddingHorizontal: 16, paddingBottom: 16 },

  titleRow: { marginTop: 8, marginBottom: 16 },
  titleWhite: { fontSize: typography.xxl, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  titleAccent: { fontSize: typography.xxl, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent },

  emptyText: { color: colors.textDim, marginTop: 12, fontSize: typography.sm },

  weekNavScroll: { marginBottom: 12 },
  weekNav: { flexDirection: 'row', gap: 8 },
  weekPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.bgElevated },
  weekPillActive: { backgroundColor: colors.accent },
  weekPillText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted },
  weekPillTextActive: { color: colors.bg },

  editWeekBtn: { backgroundColor: colors.bgElevated, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: colors.border },
  editWeekBtnText: { color: colors.text, fontWeight: weight.bold, fontSize: typography.sm },

  calBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.3)', borderWidth: 1,
    borderRadius: 16, paddingHorizontal: 18, paddingVertical: 18, marginBottom: 12,
  },
  calLbl: { color: colors.textMuted, fontSize: typography.sm },
  calVal: { color: colors.accent, fontSize: typography.xl, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', fontWeight: weight.bold },

  macroRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  macroTile: { flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, paddingVertical: 18, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  macroIcon: { fontSize: 22, marginBottom: 6 },
  macroG: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', fontWeight: weight.bold },
  macroNm: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.5, marginTop: 4 },

  infoRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  infoTile: { flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  infoIcon: { fontSize: 18, marginBottom: 6 },
  infoVal: { fontSize: typography.sm, color: colors.text, fontWeight: weight.bold },
  infoLbl: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.5, marginTop: 4 },

  cardioTile: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardioHead: { color: '#f472b6', fontSize: 10, fontWeight: weight.bold, letterSpacing: 1.5, marginBottom: 12, fontFamily: fontFamily.mono },
  cardioLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardioDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#f472b6' },
  cardioLineText: { color: colors.text, fontSize: typography.sm, flex: 1 },
  cardioNote: { color: colors.textDim, fontSize: typography.xs, marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, lineHeight: 17 },

  dietLogTile: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  weekNotesLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 2, marginBottom: 12, fontFamily: fontFamily.mono },
  formLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  input: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  saveNotesBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  saveNotesBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },

  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  sheetFieldRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sheetFieldCol: { flex: 1 },
  sheetFieldColFull: { marginBottom: 16 },
  sheetFieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  disabledInput: { justifyContent: 'center' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  calLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  autoChip: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  autoChipText: { fontSize: 8, fontWeight: weight.bold, color: colors.bg, letterSpacing: 0.5 },

  sheetActionRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  copyBtn: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: 14, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  copyBtnText: { color: colors.text, fontWeight: weight.bold, fontSize: typography.sm },
  saveBtn: { flex: 1, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },

  deleteBtn: { backgroundColor: 'rgba(248,113,113,0.10)', borderColor: 'rgba(248,113,113,0.4)', borderWidth: 1, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 8 },
  deleteBtnText: { color: '#f87171', fontWeight: weight.bold, fontSize: typography.sm },
});
