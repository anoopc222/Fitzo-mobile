import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, PanResponder, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { fontFamily } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import { EXERCISE_IMAGES } from '../lib/exerciseImages';

const PLAN_ORDER_KEY = 'fitzo:planOrder';
const ITEM_H = 52;

// ─── Data helpers ──────────────────────────────────────────────────────────────
async function fetchPlans(userId) {
  try {
    const { data, error } = await supabase
      .from('workout_plans')
      .select('id, name, created_at, template_exercises')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch { return []; }
}
async function createPlan(userId, name) {
  const { data, error } = await supabase.from('workout_plans').insert({ user_id: userId, name: name.trim() }).select().single();
  if (error) throw error;
  return data;
}
async function copyPlan(userId, plan) {
  const { data, error } = await supabase.from('workout_plans').insert({ user_id: userId, name: plan.name.trim() + '_copy', template_exercises: plan.template_exercises ?? null }).select().single();
  if (error) throw error;
  return data;
}
async function renamePlan(planId, newName) {
  const { error } = await supabase.from('workout_plans').update({ name: newName.trim() }).eq('id', planId);
  if (error) throw error;
  await supabase.from('workout_sessions').update({ notes: newName.trim() }).eq('plan_id', planId);
}
async function deletePlan(planId, planName) {
  const tag = (planName ?? '').trim() + '_Deleted';
  await supabase.from('workout_sessions').update({ notes: tag, plan_id: null }).eq('plan_id', planId);
  const { error } = await supabase.from('workout_plans').delete().eq('id', planId);
  if (error) throw error;
}
function usePlanOrder(plans) {
  const [ordered, setOrdered] = useState(plans);
  useEffect(() => {
    AsyncStorage.getItem(PLAN_ORDER_KEY).then(raw => {
      if (!raw) { setOrdered(plans); return; }
      try {
        const ids = JSON.parse(raw);
        const map = Object.fromEntries(plans.map(p => [p.id, p]));
        const sorted = ids.map(id => map[id]).filter(Boolean);
        const rest = plans.filter(p => !ids.includes(p.id));
        setOrdered([...sorted, ...rest]);
      } catch { setOrdered(plans); }
    });
  }, [plans]);
  const saveOrder = useCallback((newOrder) => {
    setOrdered(newOrder);
    AsyncStorage.setItem(PLAN_ORDER_KEY, JSON.stringify(newOrder.map(p => p.id)));
  }, []);
  return [ordered, saveOrder];
}

function getWorkoutIcon(name) {
  const n = (name ?? '').toLowerCase();
  if (n.includes('leg') || n.includes('squat') || n.includes('lunge')) return '🦵';
  if (n.includes('chest') || n.includes('bench') || n.includes('push')) return '💪';
  if (n.includes('back') || n.includes('row') || n.includes('pull')) return '🏋️';
  if (n.includes('shoulder') || n.includes('delt') || n.includes('press')) return '🔝';
  if (n.includes('arm') || n.includes('curl') || n.includes('tricep') || n.includes('bicep')) return '💪';
  if (n.includes('core') || n.includes('ab') || n.includes('plank')) return '🔥';
  if (n.includes('cardio') || n.includes('run') || n.includes('cycle')) return '🏃';
  return '🏋️';
}

function getExerciseImgUrl(name) {
  const k = name.toLowerCase().trim();
  return EXERCISE_IMAGES[k] ?? (() => {
    const entry = Object.entries(EXERCISE_IMAGES).find(([key]) => key.includes(k) || k.includes(key));
    return entry ? entry[1] : null;
  })();
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function WorkoutPlansScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const planKey = ['workoutPlans', user.id];

  const { data: plans = [] } = useQuery({
    queryKey: planKey,
    queryFn: () => fetchPlans(user.id),
    staleTime: 0, gcTime: 0,
  });

  // allSessions passed as route param from WorkoutScreen for template editor exercise name pool
  const allSessions = route.params?.allSessions ?? [];

  const [orderedPlans, saveOrder] = usePlanOrder(plans);
  const [newPlanName, setNewPlanName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Drag state
  const dragFromIdx = useRef(-1);
  const dragItemsRef = useRef(orderedPlans);
  const [draggingIdx, setDraggingIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  useEffect(() => { dragItemsRef.current = orderedPlans; }, [orderedPlans]);

  const dragPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => dragFromIdx.current >= 0,
    onMoveShouldSetPanResponder: () => dragFromIdx.current >= 0,
    onPanResponderGrant: () => { if (dragFromIdx.current >= 0) setDraggingIdx(dragFromIdx.current); },
    onPanResponderMove: (_, gs) => {
      const from = dragFromIdx.current;
      if (from < 0) return;
      const to = Math.max(0, Math.min(dragItemsRef.current.length - 1, from + Math.round(gs.dy / ITEM_H)));
      setHoverIdx(to);
    },
    onPanResponderRelease: (_, gs) => {
      const from = dragFromIdx.current;
      if (from < 0) return;
      const items = dragItemsRef.current;
      const to = Math.max(0, Math.min(items.length - 1, from + Math.round(gs.dy / ITEM_H)));
      if (from !== to) {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        saveOrder(next);
      }
      dragFromIdx.current = -1;
      setDraggingIdx(-1);
      setHoverIdx(-1);
    },
  })).current;

  // Mutations
  const createPlanMut = useMutation({
    mutationFn: (name) => createPlan(user.id, name),
    onMutate: async (name) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => [...(old ?? []), { id: '__tmp__' + Math.random(), name, template_exercises: null, created_at: new Date().toISOString() }]);
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => qc.invalidateQueries(planKey),
  });

  const renamePlanMut = useMutation({
    mutationFn: ({ planId, name }) => renamePlan(planId, name),
    onMutate: async ({ planId, name }) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => (old ?? []).map(p => p.id === planId ? { ...p, name } : p));
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => { qc.invalidateQueries(planKey); qc.invalidateQueries(['sessions', user.id]); },
  });

  const deletePlanMut = useMutation({
    mutationFn: ({ planId, planName }) => deletePlan(planId, planName),
    onMutate: async ({ planId }) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => (old ?? []).filter(p => p.id !== planId));
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => { qc.invalidateQueries(planKey); qc.invalidateQueries(['sessions', user.id]); },
  });

  const copyPlanMut = useMutation({
    mutationFn: (plan) => copyPlan(user.id, plan),
    onMutate: async (plan) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => [...(old ?? []), { id: '__tmp__' + Math.random(), name: plan.name + '_copy', template_exercises: plan.template_exercises ?? null, created_at: new Date().toISOString() }]);
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => qc.invalidateQueries(planKey),
  });

  const handleCreate = () => {
    const name = newPlanName.trim();
    if (!name) return;
    createPlanMut.mutate(name);
    setNewPlanName('');
  };

  const startEdit = (plan) => { setEditingId(plan.id); setEditingName(plan.name); };
  const submitEdit = () => {
    if (editingId && editingName.trim()) renamePlanMut.mutate({ planId: editingId, name: editingName });
    setEditingId(null); setEditingName('');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('workout.myWorkoutPlans')} onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12 }}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={draggingIdx < 0}
        >
          {/* Create new plan */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            <TextInput
              style={{ flex: 1, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border }}
              placeholder={t('workout.newPlanPlaceholder')}
              placeholderTextColor={colors.textDim}
              value={newPlanName}
              onChangeText={setNewPlanName}
              onSubmitEditing={handleCreate}
              returnKeyType="done"
            />
            <TouchableOpacity onPress={handleCreate}
              style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.accentText }}>{t('workout.addPlan')}</Text>
            </TouchableOpacity>
          </View>

          {orderedPlans.length === 0 && (
            <Text style={{ color: colors.textDim, fontSize: 13, paddingVertical: 24, textAlign: 'center' }}>
              {t('workout.noPlansYet')}
            </Text>
          )}

          <View>
            {orderedPlans.map((plan, idx) => {
              const isDragging = draggingIdx === idx;
              const isHover = hoverIdx === idx && draggingIdx !== -1 && hoverIdx !== draggingIdx;

              if (confirmDeleteId === plan.id) {
                return (
                  <View key={plan.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12 }}>Delete "{plan.name}"?</Text>
                    <TouchableOpacity onPress={() => { deletePlanMut.mutate({ planId: plan.id, planName: plan.name }); setConfirmDeleteId(null); }}
                      style={{ backgroundColor: colors.danger + '22', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Delete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setConfirmDeleteId(null)}
                      style={{ backgroundColor: colors.dim, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              if (editingId === plan.id) {
                return (
                  <View key={plan.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 10, padding: 8, marginBottom: 6, borderWidth: 1, borderColor: colors.accent }}>
                    <TextInput
                      style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.text }}
                      value={editingName}
                      onChangeText={setEditingName}
                      onSubmitEditing={submitEdit}
                      autoFocus
                      returnKeyType="done"
                    />
                    <TouchableOpacity onPress={submitEdit}
                      style={{ backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: colors.accentText }}>Save</Text>
                    </TouchableOpacity>
                  </View>
                );
              }

              const tmplCount = Array.isArray(plan.template_exercises) ? plan.template_exercises.length : 0;
              const lastMatch = tmplCount === 0 ? (allSessions)
                .filter(s => (s.notes ?? '').toLowerCase() === plan.name.toLowerCase() && (s.workout_exercises ?? []).length > 0)
                .slice().sort((a, b) => b.date.localeCompare(a.date))[0] : null;
              const exCount = tmplCount > 0 ? tmplCount : lastMatch ? (lastMatch.workout_exercises ?? []).length : 0;

              return (
                <View key={plan.id} style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: isDragging ? colors.accent + '18' : isHover ? colors.border : colors.card,
                  borderRadius: 10, marginBottom: 6,
                  borderWidth: 1,
                  borderColor: isDragging ? colors.accent + '66' : isHover ? colors.accent + '44' : colors.border,
                  opacity: isDragging ? 0.75 : 1,
                  height: ITEM_H,
                }}>
                  <View
                    {...dragPR.panHandlers}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    style={{ paddingHorizontal: 10, paddingVertical: 14, alignSelf: 'stretch', justifyContent: 'center' }}
                    onTouchStart={() => { dragFromIdx.current = idx; }}
                  >
                    <Ionicons name="reorder-three-outline" size={20} color={colors.textDim} />
                  </View>

                  <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 4 }}
                    onPress={() => {
                      let exs = [];
                      if (tmplCount > 0) {
                        exs = plan.template_exercises.map(e => (typeof e === 'string' ? e : e.name));
                      } else if (lastMatch) {
                        exs = (lastMatch.workout_exercises ?? []).slice().sort((a, b) => a.order_index - b.order_index).map(ex => ex.exercise_name);
                      }
                      navigation.navigate('WorkoutMain', { selectedPlan: { plan, exercises: exs } });
                    }} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>{plan.name}</Text>
                      {exCount > 0
                        ? <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>{exCount} exercise{exCount !== 1 ? 's' : ''}</Text>
                        : <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>No exercises</Text>}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => navigation.navigate('WorkoutTemplate', { plan, allSessions })} style={{ padding: 7 }}>
                    <Ionicons name="barbell-outline" size={16} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => copyPlanMut.mutate(plan)} style={{ padding: 7 }}>
                    <Ionicons name="copy-outline" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => startEdit(plan)} style={{ padding: 7 }}>
                    <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setConfirmDeleteId(plan.id)} style={{ padding: 7, paddingRight: 10 }}>
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
