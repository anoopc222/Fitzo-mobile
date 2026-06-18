import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import CircularGauge from '../components/CircularGauge';
import CustomCalendar from '../components/CustomCalendar';

const W = Dimensions.get('window').width - 32;
const QUALITY_OPTIONS = ['Poor', 'Fair', 'Good', 'Great'];

const QUALITY_SCORE = { Poor: 25, Fair: 50, Good: 75, Great: 100 };
const getQualityColor = (colors) => ({ Poor: colors.danger, Fair: colors.warning, Good: colors.success, Great: colors.accent });

async function fetchSleep(userId) {
  const [logs, profile] = await Promise.all([
    supabase.from('sleep_logs').select('id, hours, quality, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(90),
    supabase.from('profiles').select('sleep_goal_hours').eq('id', userId).single(),
  ]);
  return { logs: logs.data ?? [], profile: profile.data };
}

async function logSleep(userId, hours, quality) {
  const { error } = await supabase.from('sleep_logs').insert({
    user_id: userId, hours: parseFloat(hours), quality,
    logged_at: new Date().toISOString().split('T')[0],
  });
  if (error) throw error;
}

async function updateSleepGoal(userId, hours) {
  const { error } = await supabase.from('profiles').update({ sleep_goal_hours: parseFloat(hours) }).eq('id', userId);
  if (error) throw error;
}

async function deleteSleepLog(id) {
  const { error } = await supabase.from('sleep_logs').delete().eq('id', id);
  if (error) throw error;
}

function SleepTrendChart({ data, goal, width }) {
  const { colors } = useTheme();
  const SLEEP_COLOR = colors.purple;
  if (!data || data.length < 2) return null;
  const h = 120;
  const pad = { top: 8, bottom: 20, left: 28, right: 8 };
  const cw = width - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const vals = data.map(d => d.val);
  const min = Math.max(0, Math.min(...vals) - 1);
  const max = Math.max(...vals) + 1;
  const range = max - min || 1;

  const pts = data.map((d, i) => {
    const x = pad.left + (i / (data.length - 1)) * cw;
    const y = pad.top + ch - ((d.val - min) / range) * ch;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const goalY = goal ? pad.top + ch - ((goal - min) / range) * ch : null;

  return (
    <Svg width={width} height={h}>
      {[min, (min + max) / 2, max].map((val, i) => {
        const y = pad.top + ch - ((val - min) / range) * ch;
        return (
          <React.Fragment key={i}>
            <Line x1={pad.left} y1={y} x2={width - pad.right} y2={y} stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3" />
            <SvgText x={pad.left - 3} y={y + 4} fontSize={8} fill={colors.textDim} textAnchor="end">{val.toFixed(0)}h</SvgText>
          </React.Fragment>
        );
      })}
      {goalY && (
        <Line x1={pad.left} y1={goalY} x2={width - pad.right} y2={goalY} stroke={colors.accent} strokeWidth={1} strokeDasharray="5,3" />
      )}
      <Polyline points={pts} fill="none" stroke={SLEEP_COLOR} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export default function SleepScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const SLEEP_COLOR = colors.purple;
  const QUALITY_COLOR = useMemo(() => getQualityColor(colors), [colors]);
  const qc = useQueryClient();
  const [chartRange, setChartRange] = useState('1M');
  const [showLogModal, setShowLogModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [hoursInput, setHoursInput] = useState('');
  const [qualityInput, setQualityInput] = useState('Good');
  const [goalInput, setGoalInput] = useState('');

  const now = new Date();
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(now.getFullYear());

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sleep', user?.id],
    queryFn: () => fetchSleep(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logMut = useMutation({
    mutationFn: () => logSleep(user.id, hoursInput, qualityInput),
    onSuccess: () => { qc.invalidateQueries(['sleep', user.id]); qc.invalidateQueries(['home', user.id]); setShowLogModal(false); setHoursInput(''); },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const goalMut = useMutation({
    mutationFn: (h) => updateSleepGoal(user.id, h),
    onSuccess: () => { qc.invalidateQueries(['sleep', user.id]); setShowGoalModal(false); setGoalInput(''); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteSleepLog,
    onSuccess: () => { qc.invalidateQueries(['sleep', user.id]); qc.invalidateQueries(['home', user.id]); },
  });

  const logs = data?.logs ?? [];
  const sleepGoal = data?.profile?.sleep_goal_hours ?? 8;
  const latest = logs[0];
  const latestHours = latest?.hours ?? 0;
  const latestQuality = latest?.quality ?? null;
  const qualityColor = QUALITY_COLOR[latestQuality] ?? colors.textMuted;

  // Recovery score (0-100) based on hours vs goal + quality
  const recoveryScore = latest ? Math.min(100, Math.round(
    (Math.min(latestHours / sleepGoal, 1) * 70) + ((QUALITY_SCORE[latestQuality] ?? 0) * 0.3)
  )) : 0;

  // Sleep debt (hours below goal in last 7 days)
  const week7 = logs.slice(0, 7);
  const week7Total = week7.reduce((s, l) => s + l.hours, 0);
  const sleepDebt = Math.max(0, (sleepGoal * 7) - week7Total).toFixed(1);
  const week7Avg = week7.length > 0 ? (week7Total / week7.length).toFixed(1) : '--';

  // Consistency % (days within ±1h of goal in last 30)
  const month30 = logs.slice(0, 30);
  const consistentDays = month30.filter(l => Math.abs(l.hours - sleepGoal) <= 1).length;
  const consistencyPct = month30.length > 0 ? Math.round((consistentDays / month30.length) * 100) : 0;

  // Streak (consecutive days logged)
  const streak = (() => {
    let count = 0;
    for (let i = 0; i < logs.length; i++) {
      const expected = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      if (logs[i]?.logged_at?.startsWith(expected)) count++;
      else break;
    }
    return count;
  })();

  // Chart data
  const rangeDays = { '1M': 30, '3M': 90, '6M': 180, ALL: 9999 }[chartRange];
  const cutoff = new Date(Date.now() - rangeDays * 86400000);
  const chartData = logs.filter(l => new Date(l.logged_at) >= cutoff).slice().reverse().map(l => ({ val: l.hours }));

  // Calendar data
  const heatmapData = {};
  logs.forEach(l => {
    heatmapData[l.logged_at.split('T')[0]] = {
      color: SLEEP_COLOR,
      label: l.hours + ' hours',
    };
  });

  const monthName = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); } else setViewMonth(m => m + 1); };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={{ width: 32 }} />
        <Text style={styles.title}>Sleep</Text>
        <TouchableOpacity style={styles.goalBtn} onPress={() => { setGoalInput(String(sleepGoal)); setShowGoalModal(true); }}>
          <Ionicons name="flag-outline" size={16} color={SLEEP_COLOR} />
          <Text style={styles.goalBtnText}>{sleepGoal}h goal</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}>
        {isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
          <>
            {/* Hero + Recovery Score */}
            <View style={styles.hero}>
              <CircularGauge percent={recoveryScore} size={130} strokeWidth={12} color={SLEEP_COLOR}
                bgColor={colors.bgElevated} value={recoveryScore} label="RECOVERY" sublabel="/ 100" />
              <View style={styles.heroRight}>
                <View style={styles.heroMain}>
                  <Text style={[styles.heroHours, { color: SLEEP_COLOR }]}>{latestHours}h</Text>
                  {latestQuality && (
                    <View style={[styles.qualityBadge, { backgroundColor: qualityColor + '33', borderColor: qualityColor + '66' }]}>
                      <Text style={[styles.qualityText, { color: qualityColor }]}>{latestQuality}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.heroStats}>
                  <HeroStat label="7-day avg" value={`${week7Avg}h`} />
                  <HeroStat label="Sleep debt" value={`${sleepDebt}h`} color={parseFloat(sleepDebt) > 2 ? colors.warning : colors.success} />
                  <HeroStat label="Consistency" value={`${consistencyPct}%`} />
                  {streak > 1 && <HeroStat label="Streak" value={`${streak}d`} color={colors.accent} />}
                </View>
              </View>
            </View>

            {/* Log button */}
            <TouchableOpacity style={styles.logBtn} onPress={() => { setHoursInput(''); setQualityInput('Good'); setShowLogModal(true); }}>
              <Ionicons name="add" size={18} color={colors.bg} />
              <Text style={styles.logBtnText}>Log Sleep</Text>
            </TouchableOpacity>

            {/* Trend chart */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>Trend</Text>
                <View style={styles.rangeToggle}>
                  {['1M', '3M', '6M', 'ALL'].map(r => (
                    <TouchableOpacity key={r} style={[styles.rangeBtn, chartRange === r && styles.rangeBtnActive]} onPress={() => setChartRange(r)}>
                      <Text style={[styles.rangeBtnText, chartRange === r && styles.rangeBtnTextActive]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {chartData.length >= 2
                ? <SleepTrendChart data={chartData} goal={sleepGoal} width={W - 28} />
                : <Text style={styles.emptyChart}>Log at least 2 entries to see the trend</Text>
              }
              <View style={styles.chartLegend}>
                <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: SLEEP_COLOR }]} /><Text style={styles.legendText}>Hours slept</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendLine, { backgroundColor: colors.accent }]} /><Text style={styles.legendText}>{sleepGoal}h goal</Text></View>
              </View>
            </View>

            {/* Monthly calendar */}
            <CustomCalendar
              month={viewMonth}
              year={viewYear}
              isDark={isDark}
              data={heatmapData}
              onMonthChange={({ month, year }) => {
                setViewMonth(month);
                setViewYear(year);
              }}
            />

            {/* History */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>History</Text>
              {logs.length === 0 && <Text style={styles.emptyText}>No sleep logs yet</Text>}
              {logs.slice(0, 30).map((log) => {
                const qc2 = QUALITY_COLOR[log.quality] ?? colors.textMuted;
                const goalMet = log.hours >= sleepGoal;
                return (
                  <View key={log.id} style={styles.histRow}>
                    <View style={styles.histDate}>
                      <Text style={styles.histDateTxt}>{new Date(log.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                    </View>
                    <Text style={[styles.histHours, { color: goalMet ? SLEEP_COLOR : colors.text }]}>{log.hours}h</Text>
                    {log.quality && (
                      <View style={[styles.histQuality, { backgroundColor: qc2 + '22' }]}>
                        <Text style={[styles.histQualityText, { color: qc2 }]}>{log.quality}</Text>
                      </View>
                    )}
                    <TouchableOpacity style={{ marginLeft: 'auto' }} onPress={() => Alert.alert('Delete', 'Remove this entry?', [
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
            <Text style={styles.sheetTitle}>Log Sleep</Text>
            <Text style={styles.fieldLabel}>Hours slept</Text>
            <TextInput style={styles.sheetInput} placeholder="e.g. 7.5"
              placeholderTextColor={colors.textDim} value={hoursInput}
              onChangeText={setHoursInput} keyboardType="numeric" autoFocus />
            <Text style={styles.fieldLabel}>Sleep quality</Text>
            <View style={styles.qualityPicker}>
              {QUALITY_OPTIONS.map(q => (
                <TouchableOpacity key={q}
                  style={[styles.qualityOpt, qualityInput === q && { backgroundColor: QUALITY_COLOR[q], borderColor: QUALITY_COLOR[q] }]}
                  onPress={() => setQualityInput(q)}>
                  <Text style={[styles.qualityOptText, qualityInput === q && { color: '#fff' }]}>{q}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowLogModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: SLEEP_COLOR }]}
                onPress={() => { if (hoursInput) logMut.mutate(); }} disabled={logMut.isPending}>
                {logMut.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Goal Modal */}
      <Modal visible={showGoalModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Set Sleep Goal</Text>
            <View style={styles.presets}>
              {[6, 7, 7.5, 8, 9].map(h => (
                <TouchableOpacity key={h} style={[styles.preset, goalInput === String(h) && styles.presetActive]}
                  onPress={() => setGoalInput(String(h))}>
                  <Text style={[styles.presetText, goalInput === String(h) && { color: '#fff' }]}>{h}h</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.sheetInput} placeholder="Or type custom goal (hours)"
              placeholderTextColor={colors.textDim} value={goalInput}
              onChangeText={setGoalInput} keyboardType="numeric" />
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowGoalModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: SLEEP_COLOR }]}
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

function HeroStat({ label, value, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.heroStatItem}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={[styles.heroStatVal, color && { color }]}>{value}</Text>
    </View>
  );
}

const createStyles = (colors) => {
  const SLEEP_COLOR = colors.purple;
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  goalBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: SLEEP_COLOR + '66' },
  goalBtnText: { fontSize: typography.xs, color: SLEEP_COLOR, fontWeight: weight.semibold },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 16 },
  heroRight: { flex: 1 },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  heroHours: { fontSize: 42, fontWeight: weight.black, lineHeight: 48 },
  qualityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  qualityText: { fontSize: typography.xs, fontWeight: weight.bold },
  heroStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  heroStatItem: { minWidth: 70 },
  heroStatLabel: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.5 },
  heroStatVal: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text, marginTop: 1 },
  logBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 14, padding: 14, marginBottom: 14 },
  logBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  rangeToggle: { flexDirection: 'row', gap: 4 },
  rangeBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: colors.bgElevated },
  rangeBtnActive: { backgroundColor: SLEEP_COLOR },
  rangeBtnText: { fontSize: 10, color: colors.textMuted, fontWeight: weight.semibold },
  rangeBtnTextActive: { color: '#fff' },
  emptyChart: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },
  chartLegend: { flexDirection: 'row', gap: 14, marginTop: 6, justifyContent: 'flex-end' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLine: { width: 16, height: 2, borderRadius: 1 },
  legendText: { fontSize: 9, color: colors.textDim },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  histDate: { width: 50 },
  histDateTxt: { fontSize: 10, color: colors.text, fontWeight: weight.medium },
  histHours: { fontSize: typography.base, fontWeight: weight.bold, minWidth: 36 },
  histQuality: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  histQualityText: { fontSize: 10, fontWeight: weight.semibold },
  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: { backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, marginBottom: 16 },
  fieldLabel: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold, marginBottom: 8 },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 14, color: colors.text, fontSize: typography.base, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  qualityPicker: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  qualityOpt: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated },
  qualityOptText: { fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold },
  sheetBtns: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: weight.bold },
  presets: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  preset: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  presetActive: { backgroundColor: SLEEP_COLOR, borderColor: SLEEP_COLOR },
  presetText: { fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold },
  });
};
