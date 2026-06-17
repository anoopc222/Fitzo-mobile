import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { typography, weight } from '../theme/typography';
import MonthHeatmap from '../components/MonthHeatmap';
import CircularGauge from '../components/CircularGauge';

const W = Dimensions.get('window').width - 32;
const KG_TO_LBS = 2.20462;

async function fetchWeightData(userId) {
  const [logs, profile] = await Promise.all([
    supabase.from('weight_logs').select('id, weight, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(90),
    supabase.from('profiles').select('weight_goal_kg, full_name').eq('id', userId).single(),
  ]);
  return { logs: logs.data ?? [], profile: profile.data };
}

async function logWeight(userId, weightKg) {
  const { error } = await supabase.from('weight_logs').insert({ user_id: userId, weight: weightKg, logged_at: new Date().toISOString() });
  if (error) throw error;
}

async function deleteWeightLog(id) {
  const { error } = await supabase.from('weight_logs').delete().eq('id', id);
  if (error) throw error;
}

async function updateGoal(userId, goalKg) {
  const { error } = await supabase.from('profiles').update({ weight_goal_kg: goalKg }).eq('id', userId);
  if (error) throw error;
}

function WeightTrendChart({ data, width }) {
  if (!data || data.length < 2) return null;
  const h = 140;
  const pad = { top: 10, bottom: 24, left: 38, right: 10 };
  const cw = width - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const vals = data.map(d => d.val);
  const min = Math.min(...vals) * 0.998;
  const max = Math.max(...vals) * 1.002;
  const range = max - min || 1;

  const toXY = (val, i, len) => ({
    x: pad.left + (i / (len - 1)) * cw,
    y: pad.top + ch - ((val - min) / range) * ch,
  });

  const pts = data.map((d, i) => { const p = toXY(d.val, i, data.length); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');

  const avgPts = data.map((d, i) => {
    const slice = data.slice(Math.max(0, i - 3), i + 4).map(x => x.val);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const p = toXY(avg, i, data.length);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');

  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => (min + f * range).toFixed(1));

  return (
    <Svg width={width} height={h}>
      {yLabels.map((label, i) => {
        const yPos = pad.top + ch - i * (ch / 4);
        return (
          <React.Fragment key={i}>
            <Line x1={pad.left} y1={yPos} x2={width - pad.right} y2={yPos} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
            <SvgText x={pad.left - 4} y={yPos + 4} fontSize={8} fill={colors.textDim} textAnchor="end">{label}</SvgText>
          </React.Fragment>
        );
      })}
      <Polyline points={pts} fill="none" stroke="#e879f9" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points={avgPts} fill="none" stroke="#e879f9" strokeWidth={1} strokeDasharray="4,2" strokeOpacity={0.6} />
    </Svg>
  );
}

export default function WeightScreen({ navigation }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [unit, setUnit] = useState('KG');
  const [chartRange, setChartRange] = useState('30D');
  const [showLogModal, setShowLogModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [goalInput, setGoalInput] = useState('');

  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(now.getFullYear());

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['weight', user?.id],
    queryFn: () => fetchWeightData(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logMut = useMutation({
    mutationFn: (kg) => logWeight(user.id, kg),
    onSuccess: () => { qc.invalidateQueries(['weight', user.id]); qc.invalidateQueries(['home', user.id]); setShowLogModal(false); setWeightInput(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteWeightLog,
    onSuccess: () => { qc.invalidateQueries(['weight', user.id]); qc.invalidateQueries(['home', user.id]); },
  });

  const goalMut = useMutation({
    mutationFn: (goalKg) => updateGoal(user.id, goalKg),
    onSuccess: () => { qc.invalidateQueries(['weight', user.id]); setShowGoalModal(false); setGoalInput(''); },
  });

  const logs = data?.logs ?? [];
  const goalKg = data?.profile?.weight_goal_kg;
  const toDisplay = (kg) => unit === 'KG' ? kg : kg * KG_TO_LBS;
  const unitLabel = unit === 'KG' ? 'kg' : 'lbs';
  const latest = logs[0];
  const currentVal = latest ? toDisplay(latest.weight) : null;
  const goalVal = goalKg ? toDisplay(goalKg) : null;

  const startWeight = logs.length > 0 ? logs[logs.length - 1]?.weight : null;
  const goalPercent = (goalKg && startWeight && latest) ?
    Math.min(100, Math.max(0, Math.round(
      (Math.abs(latest.weight - startWeight) / Math.abs(goalKg - startWeight)) * 100
    ))) : 0;
  const toGo = (goalKg && latest) ? Math.abs(latest.weight - goalKg) : null;

  const rateKgWeek = (() => {
    if (logs.length < 2) return null;
    const newest = logs[0]; const oldest = logs[logs.length - 1];
    const days = (new Date(newest.logged_at) - new Date(oldest.logged_at)) / 86400000;
    if (days < 1) return null;
    return (newest.weight - oldest.weight) / days * 7;
  })();

  const weeksToGoal = (() => {
    if (!rateKgWeek || !goalKg || !latest || rateKgWeek === 0) return null;
    const weeks = (goalKg - latest.weight) / rateKgWeek;
    return weeks > 0 ? Math.ceil(weeks) : null;
  })();

  const rangeDays = { '30D': 30, '60D': 60, '90D': 90, ALL: 9999 }[chartRange];
  const cutoff = new Date(Date.now() - rangeDays * 86400000);
  const chartData = logs.filter(l => new Date(l.logged_at) >= cutoff).slice().reverse().map(l => ({ val: toDisplay(l.weight) }));

  const heatmapData = {};
  logs.forEach(l => { heatmapData[l.logged_at.split('T')[0]] = l.weight; });

  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const weekLogs = logs.filter(l => new Date(l.logged_at) >= weekAgo);
  const weekAvg = weekLogs.length > 0 ? weekLogs.reduce((s, l) => s + l.weight, 0) / weekLogs.length : null;

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  const handleLogSave = () => {
    if (!weightInput) return;
    const kg = unit === 'KG' ? parseFloat(weightInput) : parseFloat(weightInput) / KG_TO_LBS;
    if (isNaN(kg) || kg <= 0) return Alert.alert('Error', 'Enter a valid weight');
    logMut.mutate(kg);
  };

  const handleGoalSave = () => {
    if (!goalInput) return;
    const kg = unit === 'KG' ? parseFloat(goalInput) : parseFloat(goalInput) / KG_TO_LBS;
    if (isNaN(kg) || kg <= 0) return Alert.alert('Error', 'Enter a valid goal weight');
    goalMut.mutate(kg);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={{ width: 32 }} />
        <Text style={styles.title}>Weight</Text>
        <View style={styles.unitToggle}>
          {['KG', 'LBS'].map(u => (
            <TouchableOpacity key={u} style={[styles.unitBtn, unit === u && styles.unitBtnActive]} onPress={() => setUnit(u)}>
              <Text style={[styles.unitBtnText, unit === u && styles.unitBtnTextActive]}>{u}</Text>
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
              <CircularGauge percent={goalPercent} size={120} strokeWidth={10} color="#e879f9"
                value={currentVal ? currentVal.toFixed(1) : '--'} label={unitLabel}
                sublabel={goalPercent > 0 ? `${goalPercent}% to goal` : undefined} />
              <View style={styles.heroStats}>
                <HeroStat label="NOW" value={currentVal ? `${currentVal.toFixed(1)} ${unitLabel}` : '--'} color="#e879f9" />
                <HeroStat label="TARGET" value={goalVal ? `${goalVal.toFixed(1)} ${unitLabel}` : 'Not set'} color={colors.textMuted} />
                <HeroStat label="TO GO" value={toGo ? `${toDisplay(toGo).toFixed(1)} ${unitLabel}` : '--'} color={colors.accent} />
              </View>
            </View>

            {/* Meta row */}
            {(rateKgWeek !== null || weekAvg !== null || weeksToGoal !== null) && (
              <View style={styles.metaRow}>
                {rateKgWeek !== null && (
                  <View style={styles.metaItem}>
                    <Text style={styles.metaVal}>{Math.abs(rateKgWeek).toFixed(2)}</Text>
                    <Text style={styles.metaLabel}>{unitLabel}/wk {rateKgWeek < 0 ? '↓ loss' : '↑ gain'}</Text>
                  </View>
                )}
                {weekAvg !== null && (
                  <View style={styles.metaItem}>
                    <Text style={styles.metaVal}>{toDisplay(weekAvg).toFixed(1)}</Text>
                    <Text style={styles.metaLabel}>7-day avg ({unitLabel})</Text>
                  </View>
                )}
                {weeksToGoal !== null && (
                  <View style={styles.metaItem}>
                    <Text style={styles.metaVal}>{weeksToGoal}w</Text>
                    <Text style={styles.metaLabel}>Est. to goal</Text>
                  </View>
                )}
              </View>
            )}

            {/* Action row */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowLogModal(true)}>
                <Ionicons name="add" size={18} color={colors.bg} />
                <Text style={styles.primaryBtnText}>Log Weight</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setGoalInput(goalKg ? String(goalKg.toFixed(1)) : ''); setShowGoalModal(true); }}>
                <Ionicons name="flag-outline" size={18} color="#e879f9" />
                <Text style={[styles.secondaryBtnText, { color: '#e879f9' }]}>Set Goal</Text>
              </TouchableOpacity>
            </View>

            {/* Trend chart */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Trend</Text>
                <View style={styles.rangeToggle}>
                  {['30D', '60D', '90D', 'ALL'].map(r => (
                    <TouchableOpacity key={r} style={[styles.rangeBtn, chartRange === r && styles.rangeBtnActive]} onPress={() => setChartRange(r)}>
                      <Text style={[styles.rangeBtnText, chartRange === r && styles.rangeBtnTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {chartData.length >= 2
                ? <WeightTrendChart data={chartData} width={W - 28} />
                : <Text style={styles.emptyChart}>Log at least 2 entries to see the trend</Text>
              }
              <View style={styles.chartLegend}>
                <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: '#e879f9' }]} /><Text style={styles.legendText}>Daily</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: '#e879f9', opacity: 0.5 }]} /><Text style={styles.legendText}>7-day avg</Text></View>
              </View>
            </View>

            {/* Monthly heatmap */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <TouchableOpacity onPress={prevMonth}><Ionicons name="chevron-back" size={20} color={colors.textMuted} /></TouchableOpacity>
                <Text style={styles.cardTitle}>{monthName}</Text>
                <TouchableOpacity onPress={nextMonth}><Ionicons name="chevron-forward" size={20} color={colors.textMuted} /></TouchableOpacity>
              </View>
              <MonthHeatmap data={heatmapData} color="#e879f9" month={viewMonth} year={viewYear} />
            </View>

            {/* History */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>History</Text>
              {logs.length === 0 && <Text style={styles.emptyText}>No entries yet. Tap "Log Weight" to start.</Text>}
              {logs.slice(0, 25).map((log, idx) => {
                const next = logs[idx + 1];
                const diff = next ? (log.weight - next.weight) : null;
                return (
                  <View key={log.id} style={styles.historyRow}>
                    <View style={styles.historyDate}>
                      <Text style={styles.historyDateTxt}>{new Date(log.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                      <Text style={styles.historyYear}>{new Date(log.logged_at).getFullYear()}</Text>
                    </View>
                    <Text style={styles.historyVal}>{toDisplay(log.weight).toFixed(1)} <Text style={styles.historyUnit}>{unitLabel}</Text></Text>
                    {diff !== null && (
                      <Text style={[styles.historyDiff, { color: diff > 0 ? colors.danger : colors.success }]}>
                        {diff > 0 ? '+' : ''}{toDisplay(diff).toFixed(1)}
                      </Text>
                    )}
                    <TouchableOpacity onPress={() => Alert.alert('Delete', 'Remove this entry?', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                    ])}>
                      <Ionicons name="trash-outline" size={15} color={colors.textDim} />
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
            <Text style={styles.sheetTitle}>Log Weight</Text>
            <TextInput style={styles.sheetInput} placeholder={`Weight (${unitLabel})`}
              placeholderTextColor={colors.textDim} value={weightInput}
              onChangeText={setWeightInput} keyboardType="numeric" autoFocus />
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowLogModal(false); setWeightInput(''); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleLogSave} disabled={logMut.isPending}>
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
            <Text style={styles.sheetTitle}>Set Goal Weight</Text>
            <TextInput style={styles.sheetInput} placeholder={`Goal (${unitLabel})`}
              placeholderTextColor={colors.textDim} value={goalInput}
              onChangeText={setGoalInput} keyboardType="numeric" autoFocus />
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowGoalModal(false); setGoalInput(''); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleGoalSave} disabled={goalMut.isPending}>
                {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.confirmBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function HeroStat({ label, value, color }) {
  return (
    <View style={styles.heroStatItem}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={[styles.heroStatVal, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  unitToggle: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 20, padding: 2 },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 18 },
  unitBtnActive: { backgroundColor: '#e879f9' },
  unitBtnText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
  unitBtnTextActive: { color: '#fff' },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 20, marginVertical: 16, paddingHorizontal: 8 },
  heroStats: { flex: 1, gap: 12 },
  heroStatItem: { gap: 2 },
  heroStatLabel: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.8 },
  heroStatVal: { fontSize: typography.base, fontWeight: weight.bold },
  metaRow: { flexDirection: 'row', gap: 8, marginBottom: 14, backgroundColor: colors.bgCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  metaItem: { flex: 1, alignItems: 'center' },
  metaVal: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  metaLabel: { fontSize: 9, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  primaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.accent, borderRadius: 14, padding: 14 },
  primaryBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
  secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#e879f9', borderRadius: 14, padding: 14 },
  secondaryBtnText: { fontWeight: weight.semibold, fontSize: typography.base },
  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  rangeToggle: { flexDirection: 'row', gap: 4 },
  rangeBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.bgElevated },
  rangeBtnActive: { backgroundColor: '#e879f9' },
  rangeBtnText: { fontSize: 10, color: colors.textMuted, fontWeight: weight.semibold },
  rangeBtnTextActive: { color: '#fff' },
  emptyChart: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },
  chartLegend: { flexDirection: 'row', gap: 14, marginTop: 6, justifyContent: 'flex-end' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendText: { fontSize: 9, color: colors.textDim },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyDate: { width: 50 },
  historyDateTxt: { fontSize: typography.xs, color: colors.text, fontWeight: weight.medium },
  historyYear: { fontSize: 10, color: colors.textDim },
  historyVal: { flex: 1, fontSize: typography.base, fontWeight: weight.bold, color: colors.text },
  historyUnit: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.normal },
  historyDiff: { fontSize: typography.xs, fontWeight: weight.bold, minWidth: 40, textAlign: 'right' },
  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: { backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, marginBottom: 16 },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 14, color: colors.text, fontSize: typography.base, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  sheetBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#e879f9', alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: weight.bold },
});
