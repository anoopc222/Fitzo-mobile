import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { scheduleDateReminder, cancelNotificationsByTag, scheduleDailyReminder } from '../lib/notifications';
import { typography, weight } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import PaywallModal from '../components/ui/PaywallModal';
import CircularGauge from '../components/CircularGauge';
import MonthHeatmap from '../components/MonthHeatmap';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';
import Sparkline from '../components/Sparkline';

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
const MOOD_COLORS = {
  Happy: '#5fd97a', Calm: '#5fb7d9', Sensitive: '#c98ae0',
  Irritable: '#e0a346', Sad: '#6a7be0', Anxious: '#e05a5a',
};

const PAIN_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const CYCLE_GUIDE = [
  {
    key: 'phases',
    icon: '🌙',
    title: 'Cycle Phase Guide',
    body: [
      { h: 'Menstrual (Days 1–5)', t: 'Estrogen & progesterone are at their lowest. The uterine lining sheds. Common: cramps, fatigue, low energy. Tips: gentle movement, iron-rich food, rest.' },
      { h: 'Follicular (Days ~1–13)', t: 'Estrogen rises as follicles mature. Energy and mood typically improve. Tips: good window for strength training and trying new things.' },
      { h: 'Ovulation (~Day 14)', t: 'LH surge triggers egg release. Estrogen peaks, libido often rises. Tips: peak fertility window — track if trying to conceive or avoid.' },
      { h: 'Luteal (Days ~15–28)', t: 'Progesterone rises then falls if no pregnancy, causing PMS in the late phase. Common: bloating, mood swings, cravings. Tips: magnesium-rich food, prioritize sleep.' },
    ],
  },
  {
    key: 'ovulation',
    icon: '🥚',
    title: 'Ovulation Signs',
    body: [
      { h: 'Cervical mucus', t: 'Becomes clear, stretchy and slippery (egg-white-like) near ovulation — the most fertile sign.' },
      { h: 'Basal body temperature (BBT)', t: 'Rises slightly (~0.3–0.5°C) right after ovulation due to progesterone; track each morning before getting up.' },
      { h: 'Mittelschmerz', t: 'A one-sided mild pelvic twinge or ache some people feel around ovulation.' },
      { h: 'Libido & energy', t: 'Often increases in the day or two surrounding ovulation.' },
    ],
  },
  {
    key: 'symptoms',
    icon: '💊',
    title: 'Symptom Care Guide',
    body: [
      { h: 'Cramps', t: 'Caused by uterine contractions (prostaglandins). Ease with heat, gentle stretching, ibuprofen, or magnesium.' },
      { h: 'Headache', t: 'Often linked to the estrogen drop before/during a period. Stay hydrated, manage caffeine intake, rest in a dark room.' },
      { h: 'Bloating', t: 'Progesterone and water retention. Reduce salt, increase potassium-rich foods, light movement helps.' },
      { h: 'Fatigue', t: 'Low iron from blood loss plus hormone shifts. Prioritize sleep and iron-rich meals during your period.' },
      { h: 'Mood swings', t: 'Hormone fluctuations affect serotonin. Light exercise, sleep, and reducing sugar/caffeine can help.' },
      { h: 'Tender breasts', t: 'Caused by rising progesterone in the luteal phase; usually eases once the period starts.' },
    ],
  },
  {
    key: 'flow',
    icon: '🩸',
    title: 'Flow & Color Guide',
    body: [
      { h: 'Bright/dark red', t: 'Normal — fresh blood (bright) early on, older blood (darker) later in the period.' },
      { h: 'Brown/spotting', t: 'Usually old blood at the very start/end of a period — normal in small amounts.' },
      { h: 'Pink', t: 'Can mean mixing with cervical fluid, often around ovulation or a lighter flow day.' },
      { h: 'Grey or with strong odor', t: 'Atypical — can indicate infection. Worth checking with a doctor.' },
      { h: 'Heavy clots / soaking through hourly', t: 'May indicate heavy menstrual bleeding — worth discussing with a doctor if it happens repeatedly.' },
    ],
  },
  {
    key: 'redflags',
    icon: '🚩',
    title: 'When to See a Doctor',
    body: [
      { h: 'Severe pain', t: 'Pain that stops daily activities or doesn’t respond to OTC pain relief.' },
      { h: 'Very heavy bleeding', t: 'Soaking a pad/tampon every hour for several hours, or passing large clots.' },
      { h: 'Irregular cycles', t: 'Cycles consistently shorter than 21 days or longer than 35 days, or missed periods (when not pregnant).' },
      { h: 'Bleeding between periods', t: 'Or bleeding after sex — should be evaluated.' },
      { h: 'No period by age 15', t: 'Or periods stopping for 3+ months without pregnancy/menopause.' },
    ],
  },
  {
    key: 'myths',
    icon: '❓',
    title: 'Myths vs. Facts',
    body: [
      { h: 'Myth: You can’t get pregnant during your period', t: 'Fact: It’s less likely but possible, especially with shorter cycles or longer periods.' },
      { h: 'Myth: A 28-day cycle is "normal" for everyone', t: 'Fact: Healthy cycles range from about 21 to 35 days — what matters is your own consistency.' },
      { h: 'Myth: Exercise should stop during your period', t: 'Fact: Light-to-moderate exercise can actually ease cramps and improve mood.' },
      { h: 'Myth: PMS is "just in your head"', t: 'Fact: PMS is driven by real hormonal fluctuations and is a recognized physiological pattern.' },
    ],
  },
];

export async function fetchPeriodLogs(userId) {
  const { data, error } = await supabase
    .from('period_logs')
    .select('id, start_date, end_date, flow, symptoms, mood, notes, pain_level, bbt')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

export async function fetchCycleSettings(userId) {
  const { data, error } = await supabase
    .from('cycle_settings')
    .select('avg_cycle_length, avg_period_length, pill_reminder_enabled, pill_reminder_time, ttc_mode')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ?? { avg_cycle_length: 28, avg_period_length: 5, pill_reminder_enabled: false, pill_reminder_time: '08:00', ttc_mode: false };
}

export async function fetchTodayMedicationLog(userId, todayStr) {
  const { data, error } = await supabase
    .from('medication_logs')
    .select('id, date, taken')
    .eq('user_id', userId)
    .eq('date', todayStr)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function upsertMedicationLog(userId, dateStr, taken) {
  const { error } = await supabase
    .from('medication_logs')
    .upsert({ user_id: userId, date: dateStr, taken }, { onConflict: 'user_id,date' });
  if (error) throw error;
}

async function logPeriod(userId, values, editingId) {
  if (editingId) {
    const { error } = await supabase.from('period_logs').update(values).eq('id', editingId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('period_logs').insert({ user_id: userId, ...values });
    if (error) throw error;
  }
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
    const start = log.start_date?.slice(0, 10);
    const end = log.end_date?.slice(0, 10) || start;
    if (!start) return;
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

function buildMoodHeatmapData(logs) {
  const data = {};
  const typeColors = {};
  logs.forEach(log => {
    if (!log.mood) return;
    const start = log.start_date?.slice(0, 10);
    const end = log.end_date?.slice(0, 10) || start;
    if (!start) return;
    let cursor = start;
    let guard = 0;
    while (cursor <= end && guard < 15) {
      data[cursor] = 1;
      typeColors[cursor] = MOOD_COLORS[log.mood] || '#9d4edd';
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
    return { avgCycleLength: avgCycleLenSetting, avgPeriodLength: avgPeriodLenSetting, nextPeriodStart: null, fertileStart: null, ovulationDay: null, cycleDay: null, phase: null, regularity: null, streak: 0, cycleLengths: [], upcoming: [], irregularAlert: false };
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

  let regularity = null;
  if (cycleLengths.length >= 2) {
    const spread = Math.max(...cycleLengths) - Math.min(...cycleLengths);
    regularity = { spread, label: spread <= 4 ? 'Regular' : spread <= 9 ? 'Slightly irregular' : 'Irregular' };
  }

  // Irregularity alert: flag if 3+ of the most recent cycle-to-cycle gaps deviate
  // from the average by more than the "regular" threshold (mirrors the spread logic above).
  let irregularAlert = false;
  if (cycleLengths.length >= 3) {
    const recent = cycleLengths.slice(-4);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const offCount = recent.filter(len => Math.abs(len - recentAvg) > 4).length;
    irregularAlert = offCount >= 3;
  }

  // Tracking streak: consecutive logged cycles (newest-first) with no gap > 45 days between starts.
  const newestFirst = [...sorted].reverse();
  let streak = newestFirst.length ? 1 : 0;
  for (let i = 1; i < newestFirst.length; i++) {
    const gap = daysBetween(newestFirst[i].start_date, newestFirst[i - 1].start_date);
    if (gap > 45) break;
    streak++;
  }

  const upcoming = [];
  let cursorStart = latest.start_date;
  for (let i = 0; i < 3; i++) {
    const periodStart = i === 0 ? nextPeriodStart : addDays(cursorStart, avgCycleLength);
    const ovDay = addDays(periodStart, -14);
    const fertStart = addDays(ovDay, -5);
    upcoming.push({ periodStart, fertileStart: fertStart, ovulationDay: ovDay });
    cursorStart = periodStart;
  }

  return { avgCycleLength, avgPeriodLength, nextPeriodStart, fertileStart, ovulationDay, cycleDay, phase, regularity, streak, cycleLengths, upcoming, irregularAlert };
}

function SymptomTrendChart({ trend, colors, width }) {
  const H = 110;
  const P = { t: 14, r: 8, b: 18, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  if (trend.length < 2 || trend.every(t => t.count === 0)) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm, textAlign: 'center' }}>
          {trend.length < 2 ? 'Log at least 2 cycles to see this trend' : 'No symptoms logged yet for recent cycles'}
        </Text>
      </View>
    );
  }

  const maxCount = Math.max(1, ...trend.map(t => t.count));
  const slot = pw / trend.length;
  const barW = Math.min(28, slot - 8);
  const labelW = Math.min(48, slot);

  return (
    <View>
      <Text style={[styles_trend.axisCaption, { color: colors.textDim }]}>Symptoms logged per cycle</Text>
      <Svg width={width} height={H}>
        {trend.map((t, i) => {
          const barH = (t.count / maxCount) * ph;
          const cx = P.l + i * slot + slot / 2;
          const x = cx - barW / 2;
          const y = P.t + ph - barH;
          return (
            <React.Fragment key={t.date}>
              <Rect x={x} y={y} width={barW} height={Math.max(2, barH)} rx={4} fill={colors.pink} />
              <SvgText x={cx} y={y - 4} fontSize={10} fontWeight="700" fill={colors.text} textAnchor="middle">
                {t.count}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
      <View style={[styles_trend.labelRow, { width }]}>
        {trend.map((t, i) => {
          const cx = P.l + i * slot + slot / 2;
          return (
            <View key={t.date} style={{ position: 'absolute', left: cx - labelW / 2, width: labelW, alignItems: 'center' }}>
              <Text style={[styles_trend.label, { color: colors.textDim }]} numberOfLines={1}>{fmtDate(t.date)}</Text>
              {t.mood ? <Text style={[styles_trend.moodLabel, { color: colors.textDim }]} numberOfLines={1}>{t.mood}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles_trend = StyleSheet.create({
  axisCaption: { fontSize: 9, marginBottom: 2 },
  labelRow: { height: 26, marginTop: 4 },
  label: { fontSize: 8, textAlign: 'center' },
  moodLabel: { fontSize: 8, textAlign: 'center', marginTop: 1 },
});

export default function PeriodTrackerScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { hasAccess, isPro, isAdmin } = useSubscription();
  const isProOnly = isPro || isAdmin;
  const { prefs: notifPrefs } = useNotificationPrefs() ?? { prefs: {} };
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showCycleSettings, setShowCycleSettings] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMode, setCalMode] = useState('flow');
  const [openGuide, setOpenGuide] = useState(null);

  const [cycleLenInput, setCycleLenInput] = useState('');
  const [periodLenInput, setPeriodLenInput] = useState('');
  const [pmsChecked, setPmsChecked] = useState({});
  const [pillReminderEnabled, setPillReminderEnabled] = useState(false);
  const [pillReminderTime, setPillReminderTime] = useState('08:00');
  const [ttcMode, setTtcMode] = useState(false);
  const [irregularBannerDismissed, setIrregularBannerDismissed] = useState(false);

  const [startDate, setStartDate] = useState(localDateStr(new Date()));
  const [endDate, setEndDate] = useState('');
  const [flow, setFlow] = useState('medium');
  const [symptoms, setSymptoms] = useState([]);
  const [mood, setMood] = useState(null);
  const [notes, setNotes] = useState('');
  const [painLevel, setPainLevel] = useState(null);
  const [bbt, setBbt] = useState('');
  const [editingId, setEditingId] = useState(null);

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

  const todayStr = localDateStr(new Date());
  const { data: todayMedicationLog } = useQuery({
    queryKey: ['medicationLog', user?.id, todayStr],
    queryFn: () => fetchTodayMedicationLog(user.id, todayStr),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const logMut = useMutation({
    mutationFn: ({ values, editingId }) => logPeriod(user.id, values, editingId),
    onMutate: async ({ values, editingId }) => {
      await qc.cancelQueries(['periodLogs', user.id]);
      const previous = qc.getQueryData(['periodLogs', user.id]);
      qc.setQueryData(['periodLogs', user.id], (old) => {
        if (editingId) {
          return (old || []).map(l => (l.id === editingId ? { ...l, ...values } : l))
            .sort((a, b) => b.start_date.localeCompare(a.start_date));
        }
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

  const medicationMut = useMutation({
    mutationFn: (taken) => upsertMedicationLog(user.id, todayStr, taken),
    onMutate: async (taken) => {
      await qc.cancelQueries(['medicationLog', user.id, todayStr]);
      const previous = qc.getQueryData(['medicationLog', user.id, todayStr]);
      qc.setQueryData(['medicationLog', user.id, todayStr], { id: previous?.id, date: todayStr, taken });
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous !== undefined) qc.setQueryData(['medicationLog', user.id, todayStr], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['medicationLog', user.id, todayStr]);
    },
  });

  const insights = useMemo(
    () => computeCycleInsights(logs, cycleSettings?.avg_cycle_length ?? 28, cycleSettings?.avg_period_length ?? 5),
    [logs, cycleSettings]
  );

  const { data: heatmapData, typeColors: heatmapColors } = useMemo(() => buildHeatmapData(logs), [logs]);
  const { data: moodHeatmapData, typeColors: moodHeatmapColors } = useMemo(() => buildMoodHeatmapData(logs), [logs]);
  const symptomTrend = useMemo(() => buildSymptomTrend(logs), [logs]);

  const daysUntilNext = insights.nextPeriodStart ? daysBetween(localDateStr(new Date()), insights.nextPeriodStart) : null;
  const daysUntilOvulation = insights.ovulationDay ? daysBetween(localDateStr(new Date()), insights.ovulationDay) : null;

  const pmsKey = insights.nextPeriodStart ? `pmsChecklist:${insights.nextPeriodStart}` : null;

  useEffect(() => {
    if (!pmsKey) return;
    AsyncStorage.getItem(pmsKey).then(raw => {
      setPmsChecked(raw ? JSON.parse(raw) : {});
    });
  }, [pmsKey]);

  useEffect(() => {
    if (!notifPrefs.periodReminders) return;
    cancelNotificationsByTag('periodReminder');
    cancelNotificationsByTag('ovulationReminder');
    cancelNotificationsByTag('pmsReminder');
    if (insights.nextPeriodStart) {
      scheduleDateReminder('periodReminder', addDays(insights.nextPeriodStart, -2), 9, 0,
        'Period coming up', 'Your period is expected in 2 days — time to get prepared.');
    }
    if (insights.ovulationDay) {
      scheduleDateReminder('ovulationReminder', insights.ovulationDay, 9, 0,
        'Ovulation day', 'Today is your estimated ovulation day — peak fertility window.');
    }
    if (daysUntilNext != null && daysUntilNext >= 1 && daysUntilNext <= 5) {
      const loggedToday = logs.some(l => l.start_date === todayStr);
      if (!loggedToday) {
        scheduleDateReminder('pmsReminder', todayStr, 19, 0,
          'PMS check-in', 'You may be in your PMS window — log how your mood and symptoms feel today.');
      }
    }
  }, [notifPrefs.periodReminders, insights.nextPeriodStart, insights.ovulationDay, daysUntilNext, logs, todayStr]);

  useEffect(() => {
    if (!cycleSettings?.pill_reminder_enabled) {
      cancelNotificationsByTag('pillReminder');
      return;
    }
    const [hourStr, minuteStr] = (cycleSettings.pill_reminder_time || '08:00').split(':');
    scheduleDailyReminder('pillReminder', parseInt(hourStr, 10) || 8, parseInt(minuteStr, 10) || 0,
      'Pill reminder', "Don't forget to take today's pill.");
  }, [cycleSettings?.pill_reminder_enabled, cycleSettings?.pill_reminder_time]);

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
    setPillReminderEnabled(!!cycleSettings?.pill_reminder_enabled);
    setPillReminderTime(cycleSettings?.pill_reminder_time || '08:00');
    setTtcMode(!!cycleSettings?.ttc_mode);
    setShowCycleSettings(true);
  };

  const handleSaveCycleSettings = () => {
    const cycleLen = parseInt(cycleLenInput, 10);
    const periodLen = parseInt(periodLenInput, 10);
    if (!cycleLen || cycleLen < 10 || cycleLen > 60) return Alert.alert('Invalid', 'Cycle length must be between 10 and 60 days');
    if (!periodLen || periodLen < 1 || periodLen > 14) return Alert.alert('Invalid', 'Period length must be between 1 and 14 days');
    cycleSettingsMut.mutate({
      avg_cycle_length: cycleLen,
      avg_period_length: periodLen,
      pill_reminder_enabled: pillReminderEnabled,
      pill_reminder_time: pillReminderTime || '08:00',
      ttc_mode: ttcMode,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setStartDate(localDateStr(new Date()));
    setEndDate('');
    setFlow('medium');
    setSymptoms([]);
    setMood(null);
    setNotes('');
    setPainLevel(null);
    setBbt('');
  };

  const openEdit = (log) => {
    setEditingId(log.id);
    setStartDate(log.start_date);
    setEndDate(log.end_date || '');
    setFlow(log.flow || 'medium');
    setSymptoms(log.symptoms || []);
    setMood(log.mood || null);
    setNotes(log.notes || '');
    setPainLevel(log.pain_level ?? null);
    setBbt(log.bbt != null ? String(log.bbt) : '');
    setShowModal(true);
  };

  const toggleSymptom = (s) => {
    setSymptoms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const handleSave = () => {
    if (!startDate) return Alert.alert('Required', 'Select a start date');
    if (endDate && endDate < startDate) return Alert.alert('Invalid', 'End date must be after start date');
    logMut.mutate({
      editingId,
      values: {
        start_date: startDate,
        end_date: endDate || null,
        flow,
        symptoms,
        mood,
        notes: notes || null,
        pain_level: painLevel,
        bbt: ttcMode && bbt ? parseFloat(bbt) : null,
      },
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
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={openCycleSettings}>
              <Ionicons name="settings-outline" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
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
                    <View style={styles.pillRow}>
                      <View style={[styles.phasePill, { backgroundColor: phaseColor + '22' }]}>
                        <Text style={[styles.phasePillText, { color: phaseColor }]}>{insights.phase} Phase</Text>
                      </View>
                      {insights.regularity && (
                        <View style={[styles.phasePill, { backgroundColor: colors.bgElevated }]}>
                          <Text style={[styles.phasePillText, { color: colors.textMuted }]}>{insights.regularity.label}</Text>
                        </View>
                      )}
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

            {/* Ovulation countdown banner */}
            {daysUntilOvulation != null && daysUntilOvulation >= 0 && daysUntilOvulation <= 3 && insights.phase !== 'Menstrual' && (
              <View style={[styles.reminderBanner, { borderColor: colors.warn + '55' }]}>
                <Ionicons name="sparkles" size={18} color={colors.warn} />
                <Text style={styles.reminderText}>
                  {daysUntilOvulation === 0
                    ? 'Ovulation expected today — peak fertility'
                    : `Ovulation expected in ${daysUntilOvulation} day${daysUntilOvulation === 1 ? '' : 's'}`}
                </Text>
              </View>
            )}

            {/* Irregularity alert */}
            {insights.irregularAlert && !irregularBannerDismissed && (
              <View style={[styles.reminderBanner, { borderColor: colors.warn + '55' }]}>
                <Ionicons name="alert-circle" size={18} color={colors.warn} />
                <Text style={styles.reminderText}>
                  Your last few cycles have varied quite a bit in length. If this continues, it may be worth checking in with a doctor.
                </Text>
                <TouchableOpacity onPress={() => setIrregularBannerDismissed(true)}>
                  <Ionicons name="close" size={18} color={colors.textDim} />
                </TouchableOpacity>
              </View>
            )}

            {/* Fertile window banner (TTC mode) */}
            {cycleSettings?.ttc_mode && insights.fertileStart && insights.ovulationDay
              && todayStr >= insights.fertileStart && todayStr <= insights.ovulationDay && (
              <View style={[styles.reminderBanner, { borderColor: colors.good + '55' }]}>
                <Ionicons name="heart" size={18} color={colors.good} />
                <Text style={styles.reminderText}>Fertile window today</Text>
              </View>
            )}

            {/* Medication check-off */}
            {cycleSettings?.pill_reminder_enabled && (
              <TouchableOpacity
                style={[styles.reminderBanner, { borderColor: colors.border }]}
                activeOpacity={0.7}
                onPress={() => medicationMut.mutate(!todayMedicationLog?.taken)}
              >
                <Ionicons
                  name={todayMedicationLog?.taken ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={todayMedicationLog?.taken ? colors.pink : colors.textDim}
                />
                <Text style={styles.reminderText}>Took pill today?</Text>
              </TouchableOpacity>
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

            {/* Period Calendar — monthly heatmap */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitleCaps}>PERIOD CALENDAR</Text>
                <View style={styles.monthNav}>
                  <TouchableOpacity onPress={() => {
                    const d = new Date(calYear, calMonth - 1, 1);
                    setCalMonth(d.getMonth()); setCalYear(d.getFullYear());
                  }}>
                    <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                  <Text style={styles.monthNavLabel}>
                    {new Date(calYear, calMonth, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </Text>
                  <TouchableOpacity onPress={() => {
                    const d = new Date(calYear, calMonth + 1, 1);
                    setCalMonth(d.getMonth()); setCalYear(d.getFullYear());
                  }}>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              </View>
              <View style={styles.calModeRow}>
                {['flow', 'mood'].map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.calModeChip, calMode === m && { backgroundColor: colors.pink + '22', borderColor: colors.pink }]}
                    onPress={() => setCalMode(m)}
                  >
                    <Text style={[styles.calModeChipText, calMode === m && { color: colors.pink }]}>{m === 'flow' ? 'Flow' : 'Mood'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <MonthHeatmap
                data={calMode === 'flow' ? heatmapData : moodHeatmapData}
                typeColors={calMode === 'flow' ? heatmapColors : moodHeatmapColors}
                color={colors.pink}
                month={calMonth}
                year={calYear}
                containerPad={64}
                emptyCellColor={colors.bgElevated}
                mutedTextColor={colors.textDim}
              />
              <View style={styles.legendRow}>
                {calMode === 'flow'
                  ? FLOWS.map(f => (
                      <View key={f.key} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: f.color }]} />
                        <Text style={styles.legendText}>{f.label}</Text>
                      </View>
                    ))
                  : MOODS.map(m => (
                      <View key={m} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: MOOD_COLORS[m] }]} />
                        <Text style={styles.legendText}>{m}</Text>
                      </View>
                    ))}
              </View>
            </View>

            {/* Insights link */}
            <TouchableOpacity style={styles.insightsLinkCard} activeOpacity={0.85} onPress={() => setShowInsights(true)}>
              <View style={styles.previewTopRow}>
                <Text style={styles.previewIcon}>🔬</Text>
              </View>
              <Text style={styles.previewTitle}>Insights</Text>
              <Text style={styles.previewSub}>Fertile window, predictions & symptom trends</Text>
            </TouchableOpacity>

            {/* Cycle & Period Guide link */}
            <TouchableOpacity style={styles.insightsLinkCard} activeOpacity={0.85} onPress={() => openProModal(setShowGuide)}>
              <View style={styles.previewTopRow}>
                <Text style={styles.previewIcon}>📖</Text>
                {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
              </View>
              <Text style={styles.previewTitle}>Cycle & Period Guide</Text>
              <Text style={styles.previewSub}>Phases, ovulation signs, symptom care & more</Text>
            </TouchableOpacity>

            {/* History */}
            {logs.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>History</Text>
                {logs.map((log) => (
                  <TouchableOpacity key={log.id} style={styles.historyItem} activeOpacity={0.7} onPress={() => openEdit(log)}>
                    <View style={[styles.flowDot, { backgroundColor: FLOW_BY_KEY[log.flow]?.color || colors.pink }]} />
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyDate}>
                        {fmtDate(log.start_date)}{log.end_date ? ` – ${fmtDate(log.end_date)}` : ''}
                      </Text>
                      <View style={styles.historyValues}>
                        <Text style={styles.historyValue}>{FLOW_BY_KEY[log.flow]?.label || 'Medium'} flow</Text>
                        {log.mood && <Text style={styles.historyValue}>· {log.mood}</Text>}
                        {log.pain_level != null && <Text style={styles.historyValue}>· Pain {log.pain_level}/10</Text>}
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
                    <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
                  </TouchableOpacity>
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
          <Text style={styles.sheetTitle}>{editingId ? 'Edit Period' : 'Log Period'}</Text>
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

          {ttcMode && (
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>BBT (°C, optional)</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="decimal-pad"
                value={bbt}
                onChangeText={setBbt}
                placeholder="36.50"
                placeholderTextColor={colors.textDim}
              />
            </View>
          )}

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

          <Text style={styles.groupLabel}>Pain level (optional)</Text>
          <View style={styles.chipRow}>
            {PAIN_LEVELS.map(n => (
              <TouchableOpacity
                key={n}
                style={[styles.painChip, painLevel === n && { backgroundColor: colors.pink + '22', borderColor: colors.pink }]}
                onPress={() => setPainLevel(painLevel === n ? null : n)}
              >
                <Text style={[styles.painChipText, painLevel === n && { color: colors.pink }]}>{n}</Text>
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
              <View style={styles.statCell}>
                <Text style={styles.statValue}>{insights.streak}</Text>
                <Text style={styles.statLabel}>STREAK</Text>
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
            <Text style={styles.subCardTitleCaps}>🔮 UPCOMING CYCLES</Text>
            {insights.upcoming && insights.upcoming.length > 0 ? (
              insights.upcoming.map((u, i) => (
                <View key={u.periodStart} style={styles.upcomingRow}>
                  <Text style={styles.upcomingLabel}>Cycle {i + 1}</Text>
                  <Text style={styles.upcomingText}>
                    Period {fmtDate(u.periodStart)} · Fertile {fmtDate(u.fertileStart)}–{fmtDate(u.ovulationDay)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.muted}>Log a period to start predicting</Text>
            )}
          </View>

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>📉 CYCLE LENGTH TREND</Text>
            {insights.cycleLengths && insights.cycleLengths.length >= 2 ? (
              <View>
                <Sparkline data={insights.cycleLengths} color={colors.pink} width={272} height={40} filled />
                <Text style={styles.muted}>{insights.cycleLengths.length} cycles tracked</Text>
              </View>
            ) : (
              <Text style={styles.muted}>Log at least 3 cycles to see this trend</Text>
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

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>🩸 SYMPTOMS BY FLOW</Text>
            {(() => {
              const byFlow = {};
              logs.forEach(l => {
                if (!l.flow) return;
                byFlow[l.flow] = byFlow[l.flow] || {};
                (l.symptoms || []).forEach(s => {
                  byFlow[l.flow][s] = (byFlow[l.flow][s] || 0) + 1;
                });
              });
              const flowsWithData = FLOWS.filter(f => byFlow[f.key] && Object.keys(byFlow[f.key]).length > 0);
              if (!flowsWithData.length) return <Text style={styles.muted}>Log symptoms with your flow to see patterns</Text>;
              return flowsWithData.map(f => {
                const top = Object.entries(byFlow[f.key]).sort((a, b) => b[1] - a[1]).slice(0, 3);
                return (
                  <View key={f.key} style={styles.flowCorrelRow}>
                    <View style={[styles.flowChipDot, { backgroundColor: f.color }]} />
                    <Text style={styles.flowCorrelLabel}>{f.label}:</Text>
                    <Text style={styles.flowCorrelText}>{top.map(([s]) => s).join(', ')}</Text>
                  </View>
                );
              });
            })()}
          </View>
        </ScrollView>
      </BottomSheet>

      {/* Cycle & Period Guide modal (Pro) */}
      <BottomSheet visible={showGuide} onClose={() => setShowGuide(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>📖 Cycle & Period Guide</Text>
          <TouchableOpacity onPress={() => setShowGuide(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sheetScrollTall} showsVerticalScrollIndicator={false}>
          {CYCLE_GUIDE.map(section => {
            const isOpen = openGuide === section.key;
            return (
              <View key={section.key} style={styles.guideSection}>
                <TouchableOpacity style={styles.guideHeaderRow} activeOpacity={0.7} onPress={() => setOpenGuide(isOpen ? null : section.key)}>
                  <Text style={styles.guideIcon}>{section.icon}</Text>
                  <Text style={styles.guideTitle}>{section.title}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
                </TouchableOpacity>
                {isOpen && (
                  <View style={styles.guideBody}>
                    {section.body.map(item => (
                      <View key={item.h} style={styles.guideItem}>
                        <Text style={styles.guideItemH}>{item.h}</Text>
                        <Text style={styles.guideItemT}>{item.t}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
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
        <View style={styles.fieldRow}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Pill reminder</Text>
            {!isProOnly && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
          </View>
          <Switch
            value={pillReminderEnabled}
            onValueChange={(v) => {
              if (!isProOnly) { setShowPaywall(true); return; }
              setPillReminderEnabled(v);
            }}
            trackColor={{ false: colors.border, true: colors.pink }}
            thumbColor="#fff"
          />
        </View>
        {isProOnly && pillReminderEnabled && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Reminder time (HH:MM)</Text>
            <TextInput
              style={styles.numInput}
              value={pillReminderTime}
              onChangeText={setPillReminderTime}
              placeholder="08:00"
              placeholderTextColor={colors.textDim}
            />
          </View>
        )}
        <View style={styles.fieldRow}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Trying to conceive</Text>
            {!isProOnly && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
          </View>
          <Switch
            value={ttcMode}
            onValueChange={(v) => {
              if (!isProOnly) { setShowPaywall(true); return; }
              setTtcMode(v);
            }}
            trackColor={{ false: colors.border, true: colors.pink }}
            thumbColor="#fff"
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
  pillRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  phasePill: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
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

  insightsLinkCard: {
    backgroundColor: colors.bgCard, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
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
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitleCaps: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 8 },

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
  fieldLabelRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },

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
  painChip: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  painChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
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

  monthNavLabel: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: colors.textMuted },

  calModeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  calModeChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  calModeChipText: { fontSize: 11, fontWeight: weight.semibold, color: colors.textMuted },

  guideSection: { borderBottomWidth: 1, borderBottomColor: colors.border },
  guideHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  guideIcon: { fontSize: 16 },
  guideTitle: { flex: 1, fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  guideBody: { paddingBottom: 12, paddingLeft: 4 },
  guideItem: { marginBottom: 10 },
  guideItemH: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.pink, marginBottom: 2 },
  guideItemT: { fontSize: typography.xs, color: colors.textMuted, lineHeight: 17 },

  upcomingRow: { marginBottom: 8 },
  upcomingLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.pink, marginBottom: 2 },
  upcomingText: { fontSize: typography.xs, color: colors.textMuted },

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

  flowCorrelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  flowCorrelLabel: { fontSize: typography.xs, fontWeight: weight.semibold, color: colors.text, width: 64 },
  flowCorrelText: { flex: 1, fontSize: typography.xs, color: colors.textMuted },
});
