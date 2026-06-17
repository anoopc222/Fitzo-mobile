import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { typography, weight } from '../theme/typography';
import MonthHeatmap from '../components/MonthHeatmap';

const STEP_COLOR = '#22d3ee';
const KM_PER_STEP = 0.000762;

async function fetchSteps(userId) {
  const [logs, profile] = await Promise.all([
    supabase.from('step_logs').select('id, steps, goal, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(90),
    supabase.from('profiles').select('step_goal').eq('id', userId).single(),
  ]);
  return { logs: logs.data ?? [], profile: profile.data };
}

async function logSteps(userId, steps, goal) {
  const { error } = await supabase.from('step_logs').insert({
    user_id: userId, steps, goal: goal ?? 10000,
    logged_at: new Date().toISOString().split('T')[0],
  });
  if (error) throw error;
}

async function updateStepGoal(userId, goal) {
  const { error } = await supabase.from('profiles').update({ step_goal: goal }).eq('id', userId);
  if (error) throw error;
}

async function deleteStepLog(id) {
  const { error } = await supabase.from('step_logs').delete().eq('id', id);
  if (error) throw error;
}

function getWeekRange(offsetWeeks = 0) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() - offsetWeeks * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
}

export default function StepsScreen({ navigation }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [distUnit, setDistUnit] = useState('KM');
  const [showLogModal, setShowLogModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [stepsInput, setStepsInput] = useState('');
  const [goalInput, setGoalInput] = useState('');

  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(now.getFullYear());

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['steps', user?.id],
    queryFn: () => fetchSteps(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logMut = useMutation({
    mutationFn: ({ steps }) => logSteps(user.id, parseInt(steps, 10), defaultGoal),
    onSuccess: () => { qc.invalidateQueries(['steps', user.id]); qc.invalidateQueries(['home', user.id]); setShowLogModal(false); setStepsInput(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateStepGoal(user.id, parseInt(goal, 10)),
    onSuccess: () => { qc.invalidateQueries(['steps', user.id]); setShowGoalModal(false); setGoalInput(''); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteStepLog,
    onSuccess: () => { qc.invalidateQueries(['steps', user.id]); qc.invalidateQueries(['home', user.id]); },
  });

  const logs = data?.logs ?? [];
  const defaultGoal = data?.profile?.step_goal ?? logs[0]?.goal ?? 10000;
  const latest = logs[0];
  const latestSteps = latest?.steps ?? 0;
  const stepPct = Math.min(100, Math.round((latestSteps / defaultGoal) * 100));

  const distKm = (latestSteps * KM_PER_STEP).toFixed(2);
  const distMi = (latestSteps * KM_PER_STEP * 0.621371).toFixed(2);
  const distDisplay = distUnit === 'KM' ? `${distKm} km` : `${distMi} mi`;

  // Week comparisons
  const [thisWeekStart, thisWeekEnd] = getWeekRange(0);
  const [lastWeekStart, lastWeekEnd] = getWeekRange(1);
  const thisWeekLogs = logs.filter(l => l.logged_at >= thisWeekStart && l.logged_at <= thisWeekEnd);
  const lastWeekLogs = logs.filter(l => l.logged_at >= lastWeekStart && l.logged_at <= lastWeekEnd);
  const thisWeekTotal = thisWeekLogs.reduce((s, l) => s + l.steps, 0);
  const lastWeekTotal = lastWeekLogs.reduce((s, l) => s + l.steps, 0);
  const thisWeekGoalDays = thisWeekLogs.filter(l => l.steps >= (l.goal ?? defaultGoal)).length;
  const lastWeekGoalDays = lastWeekLogs.filter(l => l.steps >= (l.goal ?? defaultGoal)).length;

  // Personal best
  const personalBest = logs.length > 0 ? logs.reduce((max, l) => l.steps > max.steps ? l : max, logs[0]) : null;

  // Streak (consecutive days with steps goal met)
  const streak = (() => {
    let count = 0;
    const today = new Date().toISOString().split('T')[0];
    for (let i = 0; i < logs.length; i++) {
      const expected = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const log = logs.find(l => l.logged_at.startsWith(expected));
      if (log && log.steps >= (log.goal ?? defaultGoal)) count++;
      else break;
    }
    return count;
  })();

  // Heatmap
  const heatmapData = {};
  logs.forEach(l => { heatmapData[l.logged_at.split('T')[0]] = l.steps; });

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={{ width: 32 }} />
        <Text style={styles.title}>Steps</Text>
        <View style={styles.distToggle}>
          {['KM', 'MI'].map(u => (
            <TouchableOpacity key={u} style={[styles.distBtn, distUnit === u && styles.distBtnActive]} onPress={() => setDistUnit(u)}>
              <Text style={[styles.distBtnText, distUnit === u && styles.distBtnTextActive]}>{u}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}>
        {isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
          <>
            {/* Hero */}
            <View style={styles.hero}>
              <Text style={[styles.stepsNum, { color: STEP_COLOR }]}>{latestSteps.toLocaleString()}</Text>
              <Text style={styles.stepsLabel}>steps today</Text>
              <View style={styles.progressOuter}>
                <View style={[styles.progressFill, { width: `${stepPct}%` }]} />
              </View>
              <View style={styles.progressMeta}>
                <Text style={styles.progressPct}>{stepPct}%</Text>
                <Text style={styles.progressGoal}>Goal: {defaultGoal.toLocaleString()}</Text>
                <Text style={styles.progressDist}>{distDisplay}</Text>
              </View>
            </View>

            {/* Streak */}
            {streak > 0 && (
              <View style={styles.streakBanner}>
                <Ionicons name="flame" size={20} color={colors.warning} />
                <Text style={styles.streakText}>{streak} day streak! Goal hit {streak} days in a row</Text>
              </View>
            )}

            {/* Action row */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowLogModal(true)}>
                <Ionicons name="add" size={18} color={colors.bg} />
                <Text style={styles.primaryBtnText}>Log Steps</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setGoalInput(String(defaultGoal)); setShowGoalModal(true); }}>
                <Ionicons name="flag-outline" size={18} color={STEP_COLOR} />
                <Text style={[styles.secondaryBtnText, { color: STEP_COLOR }]}>Set Goal</Text>
              </TouchableOpacity>
            </View>

            {/* This Week vs Last Week */}
            <View style={styles.weekRow}>
              <WeekCard title="This Week" total={thisWeekTotal} goalDays={thisWeekGoalDays} color={STEP_COLOR} />
              <WeekCard title="Last Week" total={lastWeekTotal} goalDays={lastWeekGoalDays} color={colors.textMuted} />
            </View>

            {/* Personal Best */}
            {personalBest && (
              <View style={styles.pbCard}>
                <View style={styles.pbLeft}>
                  <Ionicons name="trophy" size={20} color={colors.warning} />
                  <View>
                    <Text style={styles.pbLabel}>Personal Best</Text>
                    <Text style={styles.pbDate}>{new Date(personalBest.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                  </View>
                </View>
                <Text style={[styles.pbVal, { color: colors.warning }]}>{personalBest.steps.toLocaleString()}</Text>
              </View>
            )}

            {/* Monthly heatmap */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <TouchableOpacity onPress={prevMonth}><Ionicons name="chevron-back" size={20} color={colors.textMuted} /></TouchableOpacity>
                <Text style={styles.cardTitle}>{monthName}</Text>
                <TouchableOpacity onPress={nextMonth}><Ionicons name="chevron-forward" size={20} color={colors.textMuted} /></TouchableOpacity>
              </View>
              <MonthHeatmap data={heatmapData} color={STEP_COLOR} month={viewMonth} year={viewYear} />
              <View style={styles.heatmapLegend}>
                <Text style={styles.legendLabel}>Fewer</Text>
                {[0.15, 0.4, 0.65, 0.9].map((op, i) => (
                  <View key={i} style={[styles.legendDot, { backgroundColor: `${STEP_COLOR}${Math.round(op * 200 + 35).toString(16).padStart(2, '0')}` }]} />
                ))}
                <Text style={styles.legendLabel}>More</Text>
              </View>
            </View>

            {/* History */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>History</Text>
              {logs.length === 0 && <Text style={styles.emptyText}>No step logs yet</Text>}
              {logs.slice(0, 30).map((log) => {
                const pct = Math.min(100, Math.round((log.steps / (log.goal ?? defaultGoal)) * 100));
                const goalMet = log.steps >= (log.goal ?? defaultGoal);
                return (
                  <View key={log.id} style={styles.histRow}>
                    <View style={styles.histDate}>
                      <Text style={styles.histDateTxt}>{new Date(log.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    </View>
                    <View style={styles.histBar}>
                      <View style={[styles.histBarFill, { width: `${pct}%`, backgroundColor: goalMet ? STEP_COLOR : colors.bgElevated }]} />
                    </View>
                    <Text style={[styles.histSteps, { color: goalMet ? STEP_COLOR : colors.text }]}>{log.steps.toLocaleString()}</Text>
                    {goalMet && <Ionicons name="checkmark-circle" size={14} color={colors.success} />}
                    <TouchableOpacity onPress={() => Alert.alert('Delete', 'Remove this entry?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                    ])}>
                      <Ionicons name="trash-outline" size={14} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* Log Modal */}
      <Modal visible={showLogModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Log Steps</Text>
            <TextInput style={styles.sheetInput} placeholder="Steps today"
              placeholderTextColor={colors.textDim} value={stepsInput}
              onChangeText={setStepsInput} keyboardType="numeric" autoFocus />
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowLogModal(false); setStepsInput(''); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: STEP_COLOR }]}
                onPress={() => { if (stepsInput) logMut.mutate({ steps: stepsInput }); }} disabled={logMut.isPending}>
                {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.confirmBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Goal Modal */}
      <Modal visible={showGoalModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Set Step Goal</Text>
            <View style={styles.presets}>
              {[5000, 7500, 10000, 12000, 15000].map(p => (
                <TouchableOpacity key={p} style={[styles.preset, goalInput === String(p) && styles.presetActive]}
                  onPress={() => setGoalInput(String(p))}>
                  <Text style={[styles.presetText, goalInput === String(p) && { color: colors.bg }]}>{(p / 1000).toFixed(1)}k</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.sheetInput} placeholder="Or type custom goal"
              placeholderTextColor={colors.textDim} value={goalInput}
              onChangeText={setGoalInput} keyboardType="numeric" />
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowGoalModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: STEP_COLOR }]}
                onPress={() => { if (goalInput) goalMut.mutate(goalInput); }} disabled={goalMut.isPending}>
                <Text style={styles.confirmBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function WeekCard({ title, total, goalDays, color }) {
  return (
    <View style={styles.weekCard}>
      <Text style={styles.weekTitle}>{title}</Text>
      <Text style={[styles.weekTotal, { color }]}>{total.toLocaleString()}</Text>
      <Text style={styles.weekSub}>steps total</Text>
      <Text style={styles.weekGoal}>{goalDays}/7 goal days</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  distToggle: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 20, padding: 2 },
  distBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 18 },
  distBtnActive: { backgroundColor: STEP_COLOR },
  distBtnText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
  distBtnTextActive: { color: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  hero: { alignItems: 'center', paddingVertical: 24 },
  stepsNum: { fontSize: 52, fontWeight: weight.black, lineHeight: 60 },
  stepsLabel: { fontSize: typography.sm, color: colors.textMuted, marginBottom: 16 },
  progressOuter: { width: '100%', height: 10, backgroundColor: colors.bgElevated, borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: STEP_COLOR, borderRadius: 5 },
  progressMeta: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', paddingHorizontal: 4 },
  progressPct: { fontSize: typography.xs, color: STEP_COLOR, fontWeight: weight.bold },
  progressGoal: { fontSize: typography.xs, color: colors.textMuted },
  progressDist: { fontSize: typography.xs, color: colors.textMuted },
  streakBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.warning + '18', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.warning + '44', marginBottom: 12 },
  streakText: { flex: 1, color: colors.warning, fontSize: typography.sm, fontWeight: weight.medium },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accent, borderRadius: 14, padding: 14 },
  primaryBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: STEP_COLOR, borderRadius: 14, padding: 14 },
  secondaryBtnText: { fontWeight: weight.semibold, fontSize: typography.base },
  weekRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  weekCard: { flex: 1, backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  weekTitle: { fontSize: 10, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.5, marginBottom: 4 },
  weekTotal: { fontSize: typography.xl, fontWeight: weight.black },
  weekSub: { fontSize: 9, color: colors.textMuted, marginBottom: 4 },
  weekGoal: { fontSize: typography.xs, color: colors.textMuted },
  pbCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.warning + '44', marginBottom: 12 },
  pbLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pbLabel: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  pbDate: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  pbVal: { fontSize: typography.xl, fontWeight: weight.black },
  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  heatmapLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 2 },
  legendLabel: { fontSize: 9, color: colors.textDim },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  histDate: { width: 44 },
  histDateTxt: { fontSize: 10, color: colors.text, fontWeight: weight.medium },
  histBar: { flex: 1, height: 6, backgroundColor: colors.bgElevated, borderRadius: 3, overflow: 'hidden' },
  histBarFill: { height: '100%', borderRadius: 3 },
  histSteps: { fontSize: typography.xs, fontWeight: weight.semibold, minWidth: 50, textAlign: 'right' },
  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: { backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, marginBottom: 16 },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 14, color: colors.text, fontSize: typography.base, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  sheetBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  confirmBtnText: { color: colors.bg, fontWeight: weight.bold },
  presets: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  preset: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  presetActive: { backgroundColor: STEP_COLOR, borderColor: STEP_COLOR },
  presetText: { fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold },
});
