import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  TextInput, KeyboardAvoidingView, Platform, PanResponder, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import ScreenHeader from '../components/ScreenHeader';
import { EXERCISE_IMAGES } from '../lib/exerciseImages';

const EX_ITEM_H = 48;

async function updatePlanTemplate(planId, exercises) {
  const { error } = await supabase
    .from('workout_plans')
    .update({ template_exercises: exercises })
    .eq('id', planId);
  if (error) throw error;
}

function getExerciseImgUrl(name) {
  const k = name.toLowerCase().trim();
  return EXERCISE_IMAGES[k] ?? (() => {
    const entry = Object.entries(EXERCISE_IMAGES).find(([key]) => key.includes(k) || k.includes(key));
    return entry ? entry[1] : null;
  })();
}

export default function WorkoutTemplateScreen({ navigation, route }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { plan, allSessions = [] } = route.params ?? {};

  const [exercises, setExercises] = useState(() => {
    if (Array.isArray(plan?.template_exercises) && plan.template_exercises.length > 0) {
      return plan.template_exercises.map(e => (typeof e === 'string' ? e : e.name));
    }
    const match = (allSessions)
      .filter(s => (s.notes ?? '').toLowerCase() === (plan?.name ?? '').toLowerCase() && (s.workout_exercises ?? []).length > 0)
      .slice().sort((a, b) => b.date.localeCompare(a.date))[0];
    if (match) {
      return (match.workout_exercises ?? []).slice().sort((a, b) => a.order_index - b.order_index).map(ex => ex.exercise_name);
    }
    return [];
  });

  const [newEx, setNewEx] = useState('');

  // Drag state
  const exDragFromIdx = useRef(-1);
  const exDragItemsRef = useRef(exercises);
  const [exDraggingIdx, setExDraggingIdx] = useState(-1);
  const [exHoverIdx, setExHoverIdx] = useState(-1);
  useEffect(() => { exDragItemsRef.current = exercises; }, [exercises]);

  const exDragPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => exDragFromIdx.current >= 0,
    onMoveShouldSetPanResponder: () => exDragFromIdx.current >= 0,
    onPanResponderGrant: () => { if (exDragFromIdx.current >= 0) setExDraggingIdx(exDragFromIdx.current); },
    onPanResponderMove: (_, gs) => {
      const from = exDragFromIdx.current;
      if (from < 0) return;
      const to = Math.max(0, Math.min(exDragItemsRef.current.length - 1, from + Math.round(gs.dy / EX_ITEM_H)));
      setExHoverIdx(to);
    },
    onPanResponderRelease: (_, gs) => {
      const from = exDragFromIdx.current;
      if (from < 0) return;
      const items = exDragItemsRef.current;
      const to = Math.max(0, Math.min(items.length - 1, from + Math.round(gs.dy / EX_ITEM_H)));
      if (from !== to) {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setExercises(next);
      }
      exDragFromIdx.current = -1;
      setExDraggingIdx(-1);
      setExHoverIdx(-1);
    },
  })).current;

  const allExNames = useMemo(() => {
    const pool = new Set();
    allSessions.forEach(s => (s.workout_exercises ?? []).forEach(e => pool.add(e.exercise_name)));
    return [...pool].sort();
  }, [allSessions]);

  const suggestions = useMemo(() => {
    const q = newEx.trim().toLowerCase();
    if (!q) return [];
    const matches = allExNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length || matches.some(n => n.toLowerCase() === q)) return [];
    return matches;
  }, [newEx, allExNames]);

  const saveMut = useMutation({
    mutationFn: (exs) => updatePlanTemplate(plan.id, exs),
    onSuccess: () => {
      qc.invalidateQueries(['workoutPlans', user?.id]);
      navigation.goBack();
    },
  });

  const clearMut = useMutation({
    mutationFn: () => updatePlanTemplate(plan.id, []),
    onSuccess: () => {
      qc.invalidateQueries(['workoutPlans', user?.id]);
      navigation.goBack();
    },
  });

  const confirmClear = () => {
    Alert.alert(
      'Delete Template',
      `Remove all exercises from "${plan?.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => clearMut.mutate() },
      ],
    );
  };

  const addEx = () => {
    if (!newEx.trim()) return;
    setExercises(prev => [...prev, newEx.trim()]);
    setNewEx('');
  };

  const removeEx = (idx) => setExercises(prev => prev.filter((_, i) => i !== idx));

  const hasTemplate = Array.isArray(plan?.template_exercises) && plan.template_exercises.length > 0;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={plan?.name ?? ''}
        onBack={() => navigation.goBack()}
        right={hasTemplate ? (
          <TouchableOpacity onPress={confirmClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
          </TouchableOpacity>
        ) : null}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16 }}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={exDraggingIdx < 0}
        >
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 12 }}>
            EXERCISES IN THIS PLAN
          </Text>

          {exercises.length === 0 && (
            <Text style={{ color: colors.textDim, fontSize: 14, paddingVertical: 16 }}>
              No exercises yet. Add one below.
            </Text>
          )}

          {exercises.map((ex, idx) => {
            const isDragging = exDraggingIdx === idx;
            const isHover = exHoverIdx === idx && exDraggingIdx !== idx;
            const imgUrl = getExerciseImgUrl(ex);
            return (
              <View key={idx} style={{
                flexDirection: 'row', alignItems: 'center', height: EX_ITEM_H,
                backgroundColor: isDragging ? colors.accent + '22' : isHover ? colors.card + 'ee' : colors.card,
                borderRadius: 10, marginBottom: 6,
                borderWidth: isDragging || isHover ? 1 : 0, borderColor: colors.accent + '66',
                opacity: isDragging ? 0.7 : 1,
              }}>
                <View
                  {...exDragPR.panHandlers}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  style={{ paddingHorizontal: 10, alignSelf: 'stretch', justifyContent: 'center' }}
                  onTouchStart={() => { exDragFromIdx.current = idx; }}
                >
                  <Ionicons name="reorder-three-outline" size={20} color={colors.textDim} />
                </View>
                <Text style={{ flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' }} numberOfLines={1}>{ex}</Text>
                {imgUrl && (
                  <Image source={{ uri: imgUrl }} style={{ width: 28, height: 28, borderRadius: 6, marginRight: 4 }} resizeMode="cover" />
                )}
                <TouchableOpacity onPress={() => removeEx(idx)} style={{ paddingHorizontal: 12, alignSelf: 'stretch', justifyContent: 'center' }}>
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                </TouchableOpacity>
              </View>
            );
          })}
          <View style={{ height: 8 }} />
        </ScrollView>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, maxHeight: 200 }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              {suggestions.map(n => (
                <TouchableOpacity key={n}
                  style={{ paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  onPress={() => setNewEx(n)}>
                  <Text style={{ fontSize: 14, color: colors.text }}>{n}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Bottom bar */}
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg }}>
          <TextInput
            style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border }}
            placeholder="Add exercise…"
            placeholderTextColor={colors.textDim}
            value={newEx}
            onChangeText={setNewEx}
            onSubmitEditing={addEx}
            returnKeyType="done"
          />
          <TouchableOpacity onPress={addEx}
            style={{ backgroundColor: colors.accent + '22', borderRadius: 12, width: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent + '44' }}>
            <Ionicons name="add" size={22} color={colors.accent} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => saveMut.mutate(exercises.map(name => ({ name })))}
          disabled={saveMut.isPending}
          style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginHorizontal: 14, marginBottom: 12 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.accentText }}>Save Template</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
