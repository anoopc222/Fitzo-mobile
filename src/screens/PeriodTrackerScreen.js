import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Rect } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { typography, weight } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import PaywallModal from '../components/ui/PaywallModal';
import CircularGauge from '../components/CircularGauge';
import MonthHeatmap from '../components/MonthHeatmap';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';

const PMS_CHECKLIST_ITEMS = [
  'Pads / tampons / cup stocked up',
  'Pain relief on hand',
  'Heating pad ready',
  'Comfortable clothes set aside',
  'Snacks & water stocked',
  'Track mood & symptoms daily',
];

const FLOWS = [
  { key: 'spotting', label: 'Spotting', color: '#f4a6c8' },
  { key: 'light',    label: 'Light',    color: '#ec7fb0' },
  { key: 'medium',   label: 'Medium',   color: '#e0529a' },
  { key: 'heavy',    label: 'Heavy',    color: '#c2186f' },
];
const FLOW_BY_KEY = Object.fromEntries(FLOWS.map(f => [f.key, f]));

const SYMPTOMS = [
  'Cramps', 'Headache', 'Bloating', 'Fatigue', 'Mood swings',
  'Backache', 'Acne', 'Tender breasts', 'Nausea', 'Food cravings',
];

const MOODS = ['Happy', 'Calm', 'Sensitive', 'Irritable', 'Sad', 'Anxious'];

export async function fetchPeriodLogs(userId) {
  const { data, error } = await supabase
    .from('period_logs')
    .select('id, start_date, end_date, flow, symptoms, mood, notes')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

export async function fetchCycleSettings(userId) {
  const { data, error } = await supabase
    .from('cycle_settings')
    .select('avg_cycle_length, avg_period_length')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { avg_cycle_length: 28, avg_period_length: 5 };
}

async function logPeriod(userId, values) {
  const { error } = await supabase.from('period_logs').insert({ user_id: userId, ...values });
  if (error) throw error;
}

async function deletePeriodLog(id) {
  const { error } = await supabase.from('period_logs').delete().eq('id', id);
  if (error) throw error;
}

async function upsertCycleSettings(userId, values) {
  const { error } = await supabase.from('cycle_settings').upsert({ user_id: userId, ...values });
  if (error) throw error;
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

function fmtDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function buildHeatmapData(logs) {
  const data = {};
  const typeColors = {};
  logs.forEach(log => {
    const start = log.start_date;
    const end = log.end_date || start;
    let cursor = start;
    let guard = 0;
    while (cursor <= end && guard < 15) {
      data[cursor] = 1;
      typeColors[cursor] = FLOW_BY_KEY[log.flow]?.color || FLOW_BY_KEY.medium.color;
      cursor = addDays(cursor, 1);
      guard++;
    }
  });
  return { data, typeColors };
}

function buildSymptomTrend(logs) {
  return [...logs]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(-8)
    .map(l => ({ date: l.start_date, count: (l.symptoms || []).length, mood: l.mood }));
}

function computeCycleInsights(logs, avgCycleLenSetting, avgPeriodLenSetting) {
  if (logs.length === 0) {
    return { avgCycleLength: avgCycleLenSetting, avgPeriodLength: avgPeriodLenSetting, nextPeriodStart: null, fertileStart: null, ovulationDay: null, cycleDay: null, phase: null };
  }
  const sorted = [...logs].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const cycleLengths = [];
  for (let i = 1; i < sorted.length; i++) {
    const len = daysBetween(sorted[i - 1].start_date, sorted[i].start_date);
    if (len > 10 && len < 60) cycleLengths.push(len);
  }
  const periodLengths = sorted
    .filter(l => l.end_date)
    .map(l => daysBetween(l.start_date, l.end_date) + 1)
    .filter(n => n > 0 && n < 12);

  const avgCycleLength = cycleLengths.length ? Math.round(cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length) : avgCycleLenSetting;
  const avgPeriodLength = periodLengths.length ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length) : avgPeriodLenSetting;

  const latest = sorted[sorted.length - 1];
  const nextPeriodStart = addDays(latest.start_date, avgCycleLength);
  const ovulationDay = addDays(nextPeriodStart, -14);
  const fertileStart = addDays(ovulationDay, -5);

  const todayStr = localDateStr(new Date());
  const cycleDay = daysBetween(latest.start_date, todayStr) + 1;

  let phase = 'Follicular';
  const sinceStart = daysBetween(latest.start_date, todayStr);
  if (latest.end_date && todayStr >= latest.start_date && todayStr <= latest.end_date) phase = 'Menstrual';
  else if (todayStr >= fertileStart && todayStr <= ovulationDay) phase = 'Ovulation';
  else if (sinceStart > daysBetween(latest.start_date, ovulationDay)) phase = 'Luteal';

  return { avgCycleLength, avgPeriodLength, nextPeriodStart, fertileStart, ovulationDay, cycleDay, phase };
}

function SymptomTrendChart({ trend, colors, width }) {
  const H = 110;
  const P = { t: 14, r: 8, b: 18, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  if (trend.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Log at least 2 cycles to see this trend</Text>
      </View>
    );
  }

  const maxCount = Math.max(1, ...trend.map(t => t.count));
  const barW = Math.min(28, pw / trend.length - 8);
  const gap = (pw - barW * trend.length) / Math.max(trend.length - 1, 1);

  return (
    <View>
      <Svg width={width} height={H}>
        {trend.map((t, i) => {
          const barH = (t.count / maxCount) * ph;
          const x = P.l + i * (barW + gap);
          const y = P.t + ph - barH;
          return <Rect key={t.date} x={x} y={y} width={barW} height={Math.max(2, barH)} rx={4} fill={colors.pink} />;
        })}
      </Svg>
      <View style={styles_trend.labelRow}>
        {trend.map(t => (
          <Text key={t.date} style={[styles_trend.label, { color: colors.textDim, width: barW + gap }]} numberOfLines={1}>
            {fmtDate(t.date)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles_trend = StyleSheet.create({
  labelRow: { flexDirection: 'row', marginTop: 4 },
  label: { fontSize: 8, textAlign: 'center' },
});

export default function PeriodTrackerScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { hasAccess } = useSubscription();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showCycleSettings, setShowCycleSettings] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  const [cycleLenInput, setCycleLenInput] = useState('');
  const [periodLenInput, setPeriodLenInput] = useState('');
  const [pmsChecked, setPmsChecked] = useState({});

  const [startDate, setStartDate] = useState(localDateStr(new Date()));
  const [endDate, setEndDate] = useState('');
  const [flow, setFlow] = useState('medium');
  const [symptoms, setSymptoms] = useState([]);
  const [mood, setMood] = useState(null);
  const [notes, setNotes] = useState('');

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['periodLogs', user?.id],
    queryFn: () => fetchPeriodLogs(user.id),
    enabled: !!user?.id,
  });

  const { data: cycleSettings } = useQuery({
    queryKey: ['cycleSettings', user?.id],
    queryFn: () => fetchCycleSettings(user.id),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const logMut = useMutation({
    mutationFn: (values) => logPeriod(user.id, values),
    onMutate: async (values) => {
      await qc.cancelQueries(['periodLogs', user.id]);
      const previous = qc.getQueryData(['periodLogs', user.id]);
      qc.setQueryData(['periodLogs', user.id], (old) => {
        const optimisticLog = { id: `optimistic-${values.start_date}`, ...values };
        return [optimisticLog, ...(old || [])].sort((a, b) => b.start_date.localeCompare(a.start_date));
      });
      setShowModal(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['periodLogs', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['periodLogs', user.id]);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deletePeriodLog,
    onMutate: async (id) => {
      await qc.cancelQueries(['periodLogs', user.id]);
      const previous = qc.getQueryData(['periodLogs', user.id]);
      qc.setQueryData(['periodLogs', user.id], (old) => old ? old.filter(l => l.id !== id) : old);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['periodLogs', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['periodLogs', user.id]);
    },
  });

  const cycleSettingsMut = useMutation({
    mutationFn: (values) => upsertCycleSettings(user.id, values),
    onMutate: async (values) => {
      await qc.cancelQueries(['cycleSettings', user.id]);
      const previous = qc.getQueryData(['cycleSettings', user.id]);
      qc.setQueryData(['cycleSettings', user.id], (old) => ({ ...old, ...values }));
      setShowCycleSettings(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['cycleSettings', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['cycleSettings', user.id]);
    },
  });

  const insights = useMemo(
    () => computeCycleInsights(logs, cycleSettings?.avg_cycle_length ?? 28, cycleSettings?.avg_period_length ?? 5),
    [logs, cycleSettings]
  );

  const { data: heatmapData, typeColors: heatmapColors } = useMemo(() => buildHeatmapData(logs), [logs]);
  const symptomTrend = useMemo(() => buildSymptomTrend(logs), [logs]);

  const daysUntilNext = insights.nextPeriodStart ? daysBetween(localDateStr(new Date()), insights.nextPeriodStart) : null;

  const pmsKey = insights.nextPeriodStart ? `pmsChecklist:${insights.nextPeriodStart}` : null;

  useEffect(() => {
    if (!pmsKey) return;
    AsyncStorage.getItem(pmsKey).then(raw => {
      setPmsChecked(raw ? JSON.parse(raw) : {});
    });
  }, [pmsKey]);

  const togglePmsItem = (item) => {
    setPmsChecked(prev => {
      const next = { ...prev, [item]: !prev[item] };
      if (pmsKey) AsyncStorage.setItem(pmsKey, JSON.stringify(next));
      return next;
    });
  };

  const openCycleSettings = () => {
    setCycleLenInput(String(cycleSettings?.avg_cycle_length ?? insights.avgCycleLength ?? 28));
    setPeriodLenInput(String(cycleSettings?.avg_period_length ?? insights.avgPeriodLength ?? 5));
    setShowCycleSettings(true);
  };

  const handleSaveCycleSettings = () => {
    const cycleLen = parseInt(cycleLenInput, 10);
    const periodLen = parseInt(periodLenInput, 10);
    if (!cycleLen || cycleLen < 10 || cycleLen > 60) return Alert.alert('Invalid', 'Cycle length must be between 10 and 60 days');
    if (!periodLen || periodLen < 1 || periodLen > 14) return Alert.alert('Invalid', 'Period length must be between 1 and 14 days');
    cycleSettingsMut.mutate({ avg_cycle_length: cycleLen, avg_period_length: periodLen });
  };

  const resetForm = () => {
    setStartDate(localDateStr(new Date()));
    setEndDate('');
    setFlow('medium');
    setSymptoms([]);
    setMood(null);
    setNotes('');
  };

  const toggleSymptom = (s) => {
    setSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSave = () => {
    if (!startDate) return Alert.alert('Required', 'Select a start date');
    if (endDate && endDate < startDate) return Alert.alert('Invalid', 'End date must be after start date');
    logMut.mutate({
      start_date: startDate,
      end_date: endDate || null,
      flow,
      symptoms,
      mood,
      notes: notes || null,
    });
  };

  const openProModal = (setter) => {
    if (!hasAccess) { setShowPaywall(true); return; }
    setter(true);
  };

  const phaseColor = {
    Menstrual: colors.pink, Follicular: colors.good, Ovulation: colors.warn, Luteal: colors.blue,
  }[insights.phase] || colors.textMuted;

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title="LADIES"
        colors={colors}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity onPress={() => openProModal(openCycleSettings)}>
            <Ionicons name="settings-outline" size={20} color={colors.text} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.pink} />}
      >
        {isLoading ? (
          <SkeletonScreen cards={3} linesPerCard={4} />
        ) : (
          <>
            {/* Cycle overview hero */}
            <View style={[styles.heroCard, { borderColor: colors.pink + '55' }]}>
              {logs.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="water-outline" size={48} color={colors.pink} />
                  <Text style={styles.emptyTitle}>Start tracking your cycle</Text>
                  <Text style={styles.emptySub}>Tap "Log Period" to record your first entry</Text>
                </View>
              ) : (
                <View style={styles.heroRow}>
                  <CircularGauge
                    percent={insights.cycleDay ? Math.min(100, (insights.cycleDay / insights.avgCycleLength) * 100) : 0}
                    size={84} strokeWidth={8} color={colors.pink} bgColor={colors.border}
                    value={insights.cycleDay ?? '--'} label={`DAY / ${insights.avgCycleLength}`}
                    valueStyle={{ color: colors.text }} labelStyle={{ color: colors.textMuted }}
                  />
                  <View style={styles.heroTextCol}>
                    <View style={[styles.phasePill, { backgroundColor: phaseColor + '22' }]}>
                      <Text style={[styles.phasePillText, { color: phaseColor }]}>{insights.phase} Phase</Text>
                    </View>
                    <Text style={styles.heroBig}>
                      {daysUntilNext != null ? (daysUntilNext <= 0 ? 'Period due' : `${daysUntilNext}d to next period`) : '--'}
                    </Text>
                    <Text style={styles.heroSub}>
                      {insights.nextPeriodStart ? `Expected ${fmtDate(insights.nextPeriodStart)}` : 'Log more to predict'}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* Reminder banner */}
            {daysUntilNext != null && daysUntilNext <= 3 && (
              <View style={[styles.reminderBanner, { borderColor: colors.pink + '55' }]}>
                <Ionicons name="notifications" size={18} color={colors.pink} />
                <Text style={styles.reminderText}>
                  {daysUntilNext <= 0
                    ? 'Your period is expected today'
                    : `Your period is expected in ${daysUntilNext} day${daysUntilNext === 1 ? '' : 's'}`}
                </Text>
              </View>
            )}

            {/* PMS prep checklist */}
            {daysUntilNext != null && daysUntilNext > 0 && daysUntilNext <= 5 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>PMS Prep Checklist</Text>
                {PMS_CHECKLIST_ITEMS.map(item => (
                  <TouchableOpacity key={item} style={styles.checklistRow} onPress={() => togglePmsItem(item)} activeOpacity={0.7}>
                    <Ionicons
                      name={pmsChecked[item] ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={pmsChecked[item] ? colors.pink : colors.textDim}
                    />
                    <Text style={[styles.checklistText, pmsChecked[item] && styles.checklistTextDone]}>{item}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Preview row */}
            <View style={styles.previewRow}>
              <TouchableOpacity style={styles.previewCard} activeOpacity={0.85} onPress={() => setShowCalendar(true)}>
                <View style={styles.previewTopRow}>
                  <Text style={styles.previewIcon}>🗓️</Text>
                </View>
                <Text style={styles.previewTitle}>Calendar</Text>
                <Text style={styles.previewSub}>Heatmap of logged cycles</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.previewCard} activeOpacity={0.85} onPress={() => openProModal(setShowInsights)}>
                <View style={styles.previewTopRow}>
                  <Text style={styles.previewIcon}>🔬</Text>
                  {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
                </View>
                <Text style={styles.previewTitle}>Insights</Text>
                <Text style={styles.previewSub}>Fertile window & predictions</Text>
              </TouchableOpacity>
            </View>

            {/* History */}
            {logs.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>History</Text>
                {logs.map((log) => (
                  <View key={log.id} style={styles.historyItem}>
                    <View style={[styles.flowDot, { backgroundColor: FLOW_BY_KEY[log.flow]?.color || colors.pink }]} />
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyDate}>
                        {fmtDate(log.start_date)}{log.end_date ? ` – ${fmtDate(log.end_date)}` : ''}
                      </Text>
                      <View style={styles.historyValues}>
                        <Text style={styles.historyValue}>{FLOW_BY_KEY[log.flow]?.label || 'Medium'} flow</Text>
                        {log.mood && <Text style={styles.historyValue}>· {log.mood}</Text>}
                        {(log.symptoms || []).slice(0, 3).map(s => (
                          <Text key={s} style={styles.historyValue}>· {s}</Text>
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => Alert.alert('Delete', 'Remove this period log?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                      ])}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => { resetForm(); setShowModal(true); }}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      {/* Log Modal */}
      <BottomSheet visible={showModal} onClose={() => setShowModal(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Log Period</Text>
          <TouchableOpacity onPress={() => setShowModal(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sheetScrollTall} keyboardShouldPersistTaps="handled">
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Start date</Text>
            <DatePickerField value={startDate} onChange={setStartDate} colors={colors} maxDate={localDateStr(new Date())} style={{ width: 140 }} />
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>End date (optional)</Text>
            <DatePickerField value={endDate} onChange={setEndDate} colors={colors} minDate={startDate} maxDate={localDateStr(new Date())} style={{ width: 140 }} />
          </View>

          <Text style={styles.groupLabel}>Flow</Text>
          <View style={styles.chipRow}>
            {FLOWS.map(f => (
              <TouchableOpacity
                key={f.key}
                style={[styles.flowChip, flow === f.key && { backgroundColor: f.color + '22', borderColor: f.color }]}
                onPress={() => setFlow(f.key)}
              >
                <View style={[styles.flowChipDot, { backgroundColor: f.color }]} />
                <Text style={[styles.flowChipText, flow === f.key && { color: f.color }]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.groupLabel}>Symptoms</Text>
          <View style={styles.chipRow}>
            {SYMPTOMS.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.tagChip, symptoms.includes(s) && styles.tagChipActive]}
                onPress={() => toggleSymptom(s)}
              >
                <Text style={[styles.tagChipText, symptoms.includes(s) && styles.tagChipTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.groupLabel}>Mood</Text>
          <View style={styles.chipRow}>
            {MOODS.map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.tagChip, mood === m && styles.tagChipActive]}
                onPress={() => setMood(mood === m ? null : m)}
              >
                <Text style={[styles.tagChipText, mood === m && styles.tagChipTextActive]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.groupLabel}>Notes</Text>
          <TextInput
            style={styles.notesInput}
            placeholder="Anything else to remember..."
            placeholderTextColor={colors.textDim}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </ScrollView>
        <View style={styles.sheetBtns}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.pink }]} onPress={handleSave} disabled={logMut.isPending}>
            {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Calendar / Heatmap modal */}
      <BottomSheet visible={showCalendar} onClose={() => setShowCalendar(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>🗓️ Cycle Calendar</Text>
          <TouchableOpacity onPress={() => setShowCalendar(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.monthNavRow}>
          <TouchableOpacity onPress={() => {
            const d = new Date(calYear, calMonth - 1, 1);
            setCalMonth(d.getMonth()); setCalYear(d.getFullYear());
          }}>
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.monthNavLabel}>
            {new Date(calYear, calMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
          <TouchableOpacity onPress={() => {
            const d = new Date(calYear, calMonth + 1, 1);
            setCalMonth(d.getMonth()); setCalYear(d.getFullYear());
          }}>
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>
        <MonthHeatmap
          data={heatmapData}
          typeColors={heatmapColors}
          color={colors.pink}
          month={calMonth}
          year={calYear}
          containerPad={32}
          emptyCellColor={colors.bgElevated}
          mutedTextColor={colors.textDim}
        />
        <View style={styles.legendRow}>
          {FLOWS.map(f => (
            <View key={f.key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: f.color }]} />
              <Text style={styles.legendText}>{f.label}</Text>
            </View>
          ))}
        </View>
      </BottomSheet>

      {/* Insights modal (Pro) */}
      <BottomSheet visible={showInsights} onClose={() => setShowInsights(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>🔬 Insights</Text>
          <TouchableOpacity onPress={() => setShowInsights(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sheetScrollTall} showsVerticalScrollIndicator={false}>
          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>📈 CYCLE STATS</Text>
            <View style={styles.statsGrid}>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{insights.avgCycleLength}d</Text>
                <Text style={styles.statLabel}>AVG CYCLE</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{insights.avgPeriodLength}d</Text>
                <Text style={styles.statLabel}>AVG PERIOD</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{logs.length}</Text>
                <Text style={styles.statLabel}>LOGGED</Text>
              </View>
            </View>
          </View>

          <View style={[styles.subCard, { borderColor: colors.warn + '55' }]}>
            <Text style={styles.subCardTitleCaps}>🌸 FERTILE WINDOW</Text>
            {insights.fertileStart ? (
              <Text style={styles.predictionText}>
                {fmtDate(insights.fertileStart)} – {fmtDate(insights.ovulationDay)} (ovulation est. {fmtDate(insights.ovulationDay)})
              </Text>
            ) : (
              <Text style={styles.muted}>Log at least 2 cycles to estimate this</Text>
            )}
          </View>

          <View style={[styles.subCard, { borderColor: colors.pink + '55' }]}>
            <Text style={styles.subCardTitleCaps}>🔮 NEXT PERIOD</Text>
            {insights.nextPeriodStart ? (
              <Text style={styles.predictionText}>Expected to start {fmtDate(insights.nextPeriodStart)}</Text>
            ) : (
              <Text style={styles.muted}>Log a period to start predicting</Text>
            )}
          </View>

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>📊 SYMPTOM TREND</Text>
            <SymptomTrendChart trend={symptomTrend} colors={colors} width={296} />
          </View>

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>😣 TOP SYMPTOMS</Text>
            {(() => {
              const counts = {};
              logs.forEach(l => (l.symptoms || []).forEach(s => { counts[s] = (counts[s] || 0) + 1; }));
              const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
              if (!sorted.length) return <Text style={styles.muted}>No symptoms logged yet</Text>;
              return sorted.map(([s, count]) => (
                <View key={s} style={styles.scoreBarRow}>
                  <Text style={styles.scoreBarLabel}>{s}</Text>
                  <View style={styles.scoreBarTrack}>
                    <View style={[styles.scoreBarFill, { width: `${Math.min(100, (count / logs.length) * 100)}%`, backgroundColor: colors.pink }]} />
                  </View>
                  <Text style={styles.scoreBarVal}>{count}x</Text>
                </View>
              ));
            })()}
          </View>
        </ScrollView>
      </BottomSheet>

      {/* Cycle Settings modal (Pro) */}
      <BottomSheet visible={showCycleSettings} onClose={() => setShowCycleSettings(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>⚙️ Cycle Settings</Text>
          <TouchableOpacity onPress={() => setShowCycleSettings(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Average cycle length (days)</Text>
          <TextInput
            style={styles.numInput}
            keyboardType="number-pad"
            value={cycleLenInput}
            onChangeText={setCycleLenInput}
            placeholder="28"
            placeholderTextColor={colors.textDim}
          />
        </View>
        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>Average period length (days)</Text>
          <TextInput
            style={styles.numInput}
            keyboardType="number-pad"
            value={periodLenInput}
            onChangeText={setPeriodLenInput}
            placeholder="5"
            placeholderTextColor={colors.textDim}
          />
        </View>
        <View style={styles.sheetBtns}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCycleSettings(false)}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.pink }]} onPress={handleSaveCycleSettings} disabled={cycleSettingsMut.isPending}>
            {cycleSettingsMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </BottomSheet>

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 90 },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.pink, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },

  heroCard: {
    backgroundColor: colors.bgCard, borderRadius: 16, padding: 16,
    borderWidth: 1, marginBottom: 14,
  },
  empty: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroTextCol: { flex: 1 },
  phasePill: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8 },
  phasePillText: { fontSize: 11, fontWeight: weight.bold },
  heroBig: { fontSize: typography.md, fontWeight: weight.black, color: colors.text },
  heroSub: { fontSize: typography.sm, color: colors.textMuted, marginTop: 2 },

  reminderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 12,
    borderWidth: 1, marginBottom: 14,
  },
  reminderText: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },

  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checklistText: { flex: 1, fontSize: typography.sm, color: colors.text },
  checklistTextDone: { color: colors.textDim, textDecorationLine: 'line-through' },

  numInput: {
    width: 80, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10,
    color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border, textAlign: 'center',
  },

  previewRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  previewCard: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  previewTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewIcon: { fontSize: 20 },
  previewTitle: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, marginTop: 6 },
  previewSub: { fontSize: 10, color: colors.textDim, marginTop: 8 },

  card: {
    backgroundColor: colors.bgCard, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
  },
  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text, marginBottom: 12 },

  historyItem: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  flowDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  historyLeft: { flex: 1 },
  historyDate: { fontSize: typography.xs, color: colors.pink, fontWeight: weight.semibold, marginBottom: 4 },
  historyValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  historyValue: { fontSize: 10, color: colors.textMuted },
  deleteBtn: { padding: 4 },

  sheet: { paddingBottom: 8 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  sheetScrollTall: { maxHeight: 480 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  fieldLabel: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },

  groupLabel: { fontSize: 11, fontWeight: weight.bold, letterSpacing: 1, color: colors.textMuted, marginTop: 14, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  flowChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  flowChipDot: { width: 8, height: 8, borderRadius: 4 },
  flowChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  tagChipActive: { backgroundColor: colors.pink + '22', borderColor: colors.pink },
  tagChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
  tagChipTextActive: { color: colors.pink },
  notesInput: {
    backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12,
    color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border,
    minHeight: 70, textAlignVertical: 'top',
  },

  sheetBtns: { flexDirection: 'row', gap: 12, paddingVertical: 16 },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold },

  monthNavRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  monthNavLabel: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: colors.textMuted },

  subCard: {
    backgroundColor: colors.bgElevated, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: colors.border, marginVertical: 6,
  },
  subCardTitleCaps: { fontSize: 11, fontWeight: weight.bold, letterSpacing: 1, color: colors.textMuted, marginBottom: 8 },
  muted: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', paddingVertical: 6 },
  predictionText: { fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },

  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statCell: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: typography.lg, fontWeight: weight.black, color: colors.pink },
  statLabel: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, marginTop: 2 },

  scoreBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  scoreBarLabel: { width: 110, fontSize: typography.xs, color: colors.textMuted },
  scoreBarTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  scoreBarFill: { height: 5, borderRadius: 3 },
  scoreBarVal: { width: 28, fontSize: typography.xs, color: colors.textMuted, textAlign: 'right' },
});
