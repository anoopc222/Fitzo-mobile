import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Line, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activity';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import MonthYearPicker from '../components/ui/MonthYearPicker';
import CircularGauge from '../components/CircularGauge';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import PaywallModal from '../components/ui/PaywallModal';
import { useGatedExport } from '../hooks/useGatedExport';
import { useExportCard } from '../hooks/useExportCard';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { syncConditionalReminder } from '../lib/notifications';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekKeyOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return localDateStr(d);
}

function groupByWeek(items, getDate) {
  const groups = [];
  let cur = null;
  for (const item of items) {
    const wk = weekKeyOf(getDate(item));
    if (!cur || cur.key !== wk) {
      cur = { key: wk, items: [] };
      groups.push(cur);
    }
    cur.items.push(item);
  }
  return groups;
}

// ─── Data Layer ─────────────────────────────────────────────────────────────
async function fetchSleep(userId) {
  const [logs, profile, sessions, steps] = await Promise.all([
    supabase.from('sleep_logs').select('id, hours, quality, notes, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(400),
    supabase.from('profiles').select('sleep_goal_hours').eq('id', userId).single(),
    supabase.from('workout_sessions').select('date, total_volume').eq('user_id', userId).order('date', { ascending: false }).limit(60),
    supabase.from('step_logs').select('logged_at, steps').eq('user_id', userId).order('logged_at', { ascending: false }).limit(60),
  ]);
  if (logs.error) throw logs.error;
  if (sessions.error) throw sessions.error;
  if (steps.error) throw steps.error;
  const normLogs = (logs.data ?? []).map(l => ({ ...l, logged_at: l.logged_at.slice(0, 10) }));
  const normSteps = (steps.data ?? []).map(s => ({ ...s, logged_at: s.logged_at.slice(0, 10) }));
  return { logs: normLogs, profile: profile.data, sessions: sessions.data ?? [], steps: normSteps };
}

async function logSleep(userId, { date, hours }) {
  const existing = await supabase
    .from('sleep_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('logged_at', date)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const fields = { hours };

  if (existing.data) {
    const { error } = await supabase.from('sleep_logs').update(fields).eq('id', existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('sleep_logs').insert({ ...fields, user_id: userId, logged_at: date });
    if (error) throw error;
    logActivity(userId, 'sleep', 'Sleep logged', `${hours} hrs`);
  }
}

async function updateSleepGoal(userId, hours) {
  const { error } = await supabase.from('profiles').update({ sleep_goal_hours: hours }).eq('id', userId);
  if (error) throw error;
}

async function deleteSleepLog(id) {
  const { error } = await supabase.from('sleep_logs').delete().eq('id', id);
  if (error) throw error;
}

// ─── Sleep Heatmap — ports _renderSleepHeatmap (ratio-to-goal buckets) ──────
function SleepHeatmap({ year, month, logsByDate, goal, colors, hasAccess = true, onLockedPress, onDayPress, cardWidth }) {
  const SCREEN_W = cardWidth ?? Dimensions.get('window').width;
  const cellSize = Math.floor((SCREEN_W - (cardWidth ? 12 : 92)) / 7);
  const firstDay = new Date(year, month, 1).getDay();
  let startDow = firstDay - 1; if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());
  const cutoffStr = localDateStr(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ key: `e${i}`, empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hrs = logsByDate[ds];
    let lvl = 0;
    if (hrs !== undefined) {
      const ratio = hrs / goal;
      if (ratio < 0.5) lvl = 1; else if (ratio < 0.75) lvl = 2; else if (ratio < 1.0) lvl = 3; else lvl = 4;
    }
    const locked = !hasAccess && ds < cutoffStr;
    cells.push({ key: ds, day: d, hrs, lvl, isToday: ds === todayStr, locked });
  }

  const LVL_COLOR = {
    0: colors.dim,
    1: 'rgba(248,113,113,0.6)',
    2: 'rgba(251,191,36,0.55)',
    3: 'rgba(52,211,153,0.5)',
    4: 'rgba(129,140,248,0.7)',
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {DOW_LABELS.map(d => (
          <View key={d} style={{ width: cellSize, marginHorizontal: 2, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textMuted, fontFamily: fontFamily.mono }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: (cellSize + 4) * 7 }}>
        {cells.map(cell => {
          if (cell.empty) return <View key={cell.key} style={{ width: cellSize, height: cellSize, margin: 2 }} />;
          if (cell.locked) {
            return (
              <TouchableOpacity
                key={cell.key}
                onPress={onLockedPress}
                style={[
                  { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim },
                  { width: cellSize, height: cellSize },
                ]}
              >
                <Ionicons name="lock-closed" size={11} color={colors.textDim} />
                <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.textDim, marginTop: 1 }}>{cell.day}</Text>
              </TouchableOpacity>
            );
          }
          const CellWrapper = onDayPress ? TouchableOpacity : View;
          return (
            <CellWrapper
              key={cell.key}
              activeOpacity={onDayPress ? 0.7 : undefined}
              onPress={onDayPress ? () => onDayPress(cell.key, cell.hrs) : undefined}
              style={[
                { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
                { width: cellSize, height: cellSize, backgroundColor: LVL_COLOR[cell.lvl] },
                cell.isToday && { borderWidth: 2, borderColor: '#818cf8' },
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: fontFamily.mono, color: cell.lvl === 0 ? colors.textDim : colors.text }}>{cell.day}</Text>
              <Text style={{ fontSize: 8, fontWeight: '700', fontFamily: fontFamily.mono, marginTop: 1, color: cell.lvl === 0 ? colors.textDim : colors.text, opacity: cell.lvl === 0 ? 0.5 : 1 }}>
                {cell.hrs !== undefined ? `${cell.hrs}h` : '—'}
              </Text>
            </CellWrapper>
          );
        })}
      </View>
    </View>
  );
}

// Catmull-Rom → cubic-bezier smoothing for a polyline's points
function smoothPath(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// ─── Sleep Trend Chart — ports _renderSleepTrendChart ───────────────────────
function SleepTrendChart({ data, goal, colors, width }) {
  const H = 200;
  const P = { t: 20, r: 8, b: 22, l: 26 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  const { t } = useTranslation();

  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('sleep.notEnoughDataYet')}</Text>
      </View>
    );
  }

  const vals = data.map(e => e.hours);
  const avgVals = data.map((_, i) => {
    const win = data.slice(Math.max(0, i - 6), i + 1);
    return +(win.reduce((s, x) => s + x.hours, 0) / win.length).toFixed(2);
  });
  const rangeAvgVal = +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2);
  const maxH = Math.max(10, Math.max(...vals, ...avgVals, rangeAvgVal, goal) + 1);
  const minH = Math.max(0, Math.min(...vals, ...avgVals, rangeAvgVal, goal) - 1);
  const range = maxH - minH || 1;
  const n = data.length;
  const toY = v => P.t + ph - ((v - minH) / range) * ph;
  const toX = i => P.l + (i * pw) / Math.max(n - 1, 1);

  const pts = data.map((e, i) => ({ x: toX(i), y: toY(e.hours), hit: e.hours >= goal }));
  const rawLine = smoothPath(pts);
  const avgPts = avgVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const avgLine = smoothPath(avgPts);
  const goalY = toY(goal);
  const rangeAvgY = toY(rangeAvgVal);
  const lastAvg = avgPts[avgPts.length - 1];

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="slpFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f59e0b" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </LinearGradient>
      </Defs>

      {[minH, (minH + maxH) / 2, maxH].map((v, i) => {
        const y = toY(v);
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke={colors.border} strokeWidth={1} />;
      })}

      <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#34d399" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4,4" />

      <Line x1={P.l} y1={rangeAvgY} x2={width - P.r} y2={rangeAvgY} stroke="#c4b5fd" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="2,3" />

      {avgPts.length > 1 && (
        <Path
          d={`${avgLine} L ${avgPts[avgPts.length - 1].x.toFixed(1)},${H - P.b} L ${avgPts[0].x.toFixed(1)},${H - P.b} Z`}
          fill="url(#slpFill)"
        />
      )}

      {pts.length > 1 && (
        <Path d={rawLine} fill="none" stroke="#67e8f9" strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {avgPts.length > 1 && (
        <Path d={avgLine} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2} fill="#67e8f9" fillOpacity={0.6} />
      ))}
      {lastAvg && <Circle cx={lastAvg.x} cy={lastAvg.y} r={3.5} fill="#f59e0b" />}
    </Svg>
  );
}

function WeekStatCell({ value, label, color, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontWeight: weight.black, color, fontFamily: fontFamily.monoBold }}>{value}</Text>
      <Text style={{ fontSize: 9, color: colors.textDim, marginTop: 2, letterSpacing: 0.5 }}>{label}</Text>
    </View>
  );
}

// ─── History row — ports renderSleep()'s log list ───────────────────────────
function SleepLogRow({ log, goal, colors, onDelete, isLast, locked, onLockedPress }) {
  const { t } = useTranslation();
  if (locked) {
    const ld = new Date(log.logged_at + 'T12:00:00');
    const lockedLabel = `${ld.getDate()} ${MONTH_NAMES[ld.getMonth()]} (${DAY_NAMES[ld.getDay()].slice(0, 1)}${DAY_NAMES[ld.getDay()].slice(1).toLowerCase()})`;
    return (
      <TouchableOpacity
        onPress={onLockedPress}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border }}
      >
        <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: colors.textDim }} />
        <Text style={{ width: 78, fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.mono, fontWeight: '700' }}>{lockedLabel}</Text>
        <Ionicons name="lock-closed" size={13} color={colors.textDim} />
        <Text style={{ flex: 1, fontSize: 11, color: colors.textDim, fontFamily: fontFamily.mono }}>{t('sleep.unlockWithPro')}</Text>
      </TouchableOpacity>
    );
  }
  const diff = +(log.hours - goal).toFixed(1);
  const hitGoal = log.hours >= goal;
  const pct = Math.min(100, Math.round((log.hours / goal) * 100));

  let statusLabel, statusBg, statusTxt, barColor;
  if (log.hours >= goal + 1) {
    statusLabel = t('sleep.goalHit'); statusBg = 'rgba(52,211,153,0.10)'; statusTxt = '#34d399'; barColor = '#34d399';
  } else if (hitGoal) {
    statusLabel = t('sleep.goalHit'); statusBg = 'rgba(52,211,153,0.10)'; statusTxt = '#34d399'; barColor = '#34d399';
  } else if (log.hours >= goal - 0.5) {
    statusLabel = t('sleep.almost'); statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else if (log.hours >= goal - 1.5) {
    statusLabel = t('sleep.hoursShortWarn', { value: Math.abs(diff) }); statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else {
    statusLabel = t('sleep.hoursShortDanger', { value: Math.abs(diff) }); statusBg = 'rgba(248,113,113,0.10)'; statusTxt = '#f87171'; barColor = '#f87171';
  }

  const d = new Date(log.logged_at + 'T12:00:00');
  const dateLabel = `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} (${DAY_NAMES[d.getDay()].slice(0, 1)}${DAY_NAMES[d.getDay()].slice(1).toLowerCase()})`;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border }}>
      <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: barColor }} />
      <Text style={{ width: 78, fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.mono, fontWeight: '700' }}>{dateLabel}</Text>
      <Text style={{ fontSize: typography.base, fontWeight: '800', fontFamily: fontFamily.monoBold, color: barColor }}>{log.hours}h</Text>
      <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.dim, overflow: 'hidden' }}>
        <View style={{ height: '100%', borderRadius: 3, width: `${pct}%`, backgroundColor: barColor }} />
      </View>
      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: statusBg }}>
        <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, letterSpacing: 0.2, color: statusTxt }}>{statusLabel}</Text>
      </View>
      <TouchableOpacity onPress={onDelete} style={{ padding: 3 }}>
        <Ionicons name="close" size={14} color={colors.textDim} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function SleepScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const recoveryExport = useGatedExport();
  const heatmapExport = useExportCard();
  const { hasAccess, isPro } = useSubscription();
  const [showRangePaywall, setShowRangePaywall] = useState(false);

  const [trendRangeDays, setTrendRangeDays] = useState(30); // 30 | 60 | 90 | 0(all)
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [hoursInput, setHoursInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [showGoalSheet, setShowGoalSheet] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sleep', user?.id],
    queryFn: () => fetchSleep(user.id),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const logs = (data?.logs ?? []).filter(l => Number.isFinite(l.hours));
  const goal = data?.profile?.sleep_goal_hours ?? 8;
  const logCutoffStr = localDateStr(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
  const sessions = data?.sessions ?? [];
  const steps = data?.steps ?? [];

  const { prefs: notifPrefs, times: notifTimes } = useNotificationPrefs() ?? { prefs: {}, times: {} };
  const reminderTime = notifTimes.sleepReminder ?? { hour: 8, minute: 0 };
  useEffect(() => {
    if (isLoading || !notifPrefs.sleepReminder) {
      if (!notifPrefs.sleepReminder) syncConditionalReminder('sleepReminder', true, reminderTime.hour, reminderTime.minute, '', '');
      return;
    }
    const todayStr = localDateStr(new Date());
    const ydayStr = localDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const loggedRecently = logs.some(l => l.logged_at === todayStr || l.logged_at === ydayStr);
    syncConditionalReminder('sleepReminder', loggedRecently, reminderTime.hour, reminderTime.minute,
      t('sleep.reminderTitle'), t('sleep.reminderBody'));
  }, [isLoading, notifPrefs.sleepReminder, logs, reminderTime.hour, reminderTime.minute]);

  const sortedDesc = useMemo(() => [...logs].sort((a, b) => b.logged_at.localeCompare(a.logged_at)), [logs]);
  const sortedAsc = useMemo(() => [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at)), [logs]);

  const logMut = useMutation({
    mutationFn: ({ date, hours }) => logSleep(user.id, { date, hours }),
    onMutate: async ({ date, hours }) => {
      await qc.cancelQueries(['sleep', user.id]);
      const previous = qc.getQueryData(['sleep', user.id]);
      qc.setQueryData(['sleep', user.id], (old) => {
        if (!old) return old;
        const rest = old.logs.filter(l => l.logged_at !== date);
        const optimisticLog = { id: `optimistic-${date}`, hours, quality: null, notes: null, logged_at: date };
        return { ...old, logs: [optimisticLog, ...rest] };
      });
      setShowLogSheet(false); setHoursInput('');
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['sleep', user.id], context.previous);
      Alert.alert(t('sleep.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['sleep', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const goalMut = useMutation({
    mutationFn: (h) => updateSleepGoal(user.id, parseFloat(h)),
    onMutate: async (h) => {
      await qc.cancelQueries(['sleep', user.id]);
      const previous = qc.getQueryData(['sleep', user.id]);
      const hoursVal = parseFloat(h);
      qc.setQueryData(['sleep', user.id], (old) => {
        if (!old) return old;
        return { ...old, profile: { ...old.profile, sleep_goal_hours: hoursVal } };
      });
      setGoalInput('');
      setShowGoalSheet(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['sleep', user.id], context.previous);
      Alert.alert(t('sleep.errorTitle'), e.message);
    },
    onSettled: () => { qc.invalidateQueries(['sleep', user.id]); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteSleepLog,
    onMutate: async (id) => {
      await qc.cancelQueries(['sleep', user.id]);
      const previous = qc.getQueryData(['sleep', user.id]);
      qc.setQueryData(['sleep', user.id], (old) => {
        if (!old) return old;
        return { ...old, logs: old.logs.filter(l => l.id !== id) };
      });
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['sleep', user.id], context.previous);
      Alert.alert(t('sleep.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['sleep', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const logsByDate = useMemo(() => {
    const m = {};
    logs.forEach(l => { if (l.hours) m[l.logged_at] = l.hours; });
    return m;
  }, [logs]);

  // 7-day avg / debt
  const last7 = sortedDesc.slice(0, 7);
  const avg7 = last7.length ? +(last7.reduce((s, e) => s + e.hours, 0) / last7.length).toFixed(1) : 0;
  const debtPerNight = Math.max(0, goal - avg7);
  const weekDebt = +(debtPerNight * 7).toFixed(1);

  // Streak — consecutive days (from today backward) meeting goal
  const streak = useMemo(() => {
    let count = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < sortedDesc.length; i++) {
      const d = new Date(sortedDesc[i].logged_at + 'T00:00:00');
      const diff = Math.round((today - d) / 86400000);
      if (diff === i && sortedDesc[i].hours >= goal) count++;
      else break;
    }
    return count;
  }, [sortedDesc, goal]);

  // Consistency — std dev of hours over last 14 entries (proxy: bedtime data not tracked)
  const consistencyRaw = useMemo(() => {
    const recent = sortedDesc.slice(0, 14).map(e => e.hours);
    if (recent.length < 3) return null;
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length);
    return sd < 0.5 ? 'Great' : sd < 1 ? 'Good' : sd < 1.5 ? 'Fair' : 'Poor';
  }, [sortedDesc]);
  const consistency = consistencyRaw === null ? '—'
    : consistencyRaw === 'Great' ? t('sleep.consistencyGreat')
    : consistencyRaw === 'Good' ? t('sleep.consistencyGood')
    : consistencyRaw === 'Fair' ? t('sleep.consistencyFair')
    : t('sleep.consistencyPoor');

  // Recovery score
  const recoveryScore = useMemo(() => {
    if (!sortedDesc.length) return 0;
    const todayStr = localDateStr(new Date());
    const ydayStr = localDateStr(new Date(Date.now() - 86400000));
    const lastNight = sortedDesc[0];
    const lastNightIsRecent = (lastNight.logged_at === todayStr || lastNight.logged_at === ydayStr) && Number.isFinite(lastNight.hours);
    if (lastNightIsRecent) {
      const qualityScore = Number.isFinite(lastNight.quality) ? lastNight.quality : 3;
      const sleepScore = Math.min(100, Math.round((lastNight.hours / goal) * 70) + qualityScore * 5);
      const ydaySessions = sessions.filter(s => s.date === ydayStr || s.date === todayStr);
      const sessionLoad = ydaySessions.length
        ? Math.min(30, ydaySessions.reduce((sum, s) => sum + (s.total_volume || 0) / 1000, 0))
        : 0;
      return Math.min(100, Math.max(0, Math.round(sleepScore - sessionLoad + 10)));
    }
    return Math.min(100, Math.round((avg7 / goal) * 85));
  }, [sortedDesc, goal, avg7, sessions]);

  const verdict = recoveryScore >= 80 ? t('sleep.verdictExcellent')
    : recoveryScore >= 65 ? t('sleep.verdictGood')
    : recoveryScore >= 45 ? t('sleep.verdictModerate')
    : recoveryScore > 0 ? t('sleep.verdictLow')
    : t('sleep.verdictNoData');

  const recoveryColor = recoveryScore >= 75 ? '#34d399' : recoveryScore >= 50 ? '#f59e0b' : '#f87171';

  const logDateSet = useMemo(() => new Set(logs.map(l => l.logged_at)), [logs]);

  // Deeper logging/pattern analysis — mirrors Weight screen's expanded insights
  const sleepConsistency = useMemo(() => {
    const todayD = new Date();
    const todayStr = localDateStr(todayD);

    let currentLogStreak = 0;
    for (let i = 0; i < 365; i++) {
      const d = localDateStr(new Date(todayD.getTime() - i * 86400000));
      if (logDateSet.has(d)) currentLogStreak++;
      else if (d !== todayStr) break;
    }

    let longestLogStreak = 0, run = 0;
    for (let i = 364; i >= 0; i--) {
      const d = localDateStr(new Date(todayD.getTime() - i * 86400000));
      if (logDateSet.has(d)) { run++; longestLogStreak = Math.max(longestLogStreak, run); }
      else run = 0;
    }

    const countInWindow = (startDaysAgo, endDaysAgo) => {
      let c = 0;
      for (let i = endDaysAgo; i < startDaysAgo; i++) {
        const d = localDateStr(new Date(todayD.getTime() - i * 86400000));
        if (logDateSet.has(d)) c++;
      }
      return c;
    };
    const last8WkLogged = countInWindow(56, 0);
    const prev8WkLogged = countInWindow(112, 56);
    const consistencyPct = Math.round((last8WkLogged / 56) * 100);
    const prevConsistencyPct = Math.round((prev8WkLogged / 56) * 100);

    // Day-of-week pattern: avg deviation from overall mean hours, per weekday
    const overallVals = sortedAsc.map(l => l.hours);
    const overallAvg = overallVals.length ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length : null;
    let bestDow = null, bestDowDelta = 0;
    if (overallAvg != null) {
      const dowSums = Array(7).fill(0), dowCounts = Array(7).fill(0);
      for (const l of sortedAsc) {
        const dow = new Date(l.logged_at + 'T00:00:00').getDay();
        dowSums[dow] += l.hours - overallAvg;
        dowCounts[dow]++;
      }
      let maxAbs = 0;
      for (let i = 0; i < 7; i++) {
        if (dowCounts[i] < 2) continue;
        const avgDelta = dowSums[i] / dowCounts[i];
        if (Math.abs(avgDelta) > maxAbs) { maxAbs = Math.abs(avgDelta); bestDow = i; bestDowDelta = avgDelta; }
      }
    }

    // Night-to-night volatility: avg absolute delta between consecutive logs
    let volatility = null;
    if (sortedAsc.length >= 3) {
      let sum = 0;
      for (let i = 1; i < sortedAsc.length; i++) sum += Math.abs(sortedAsc[i].hours - sortedAsc[i - 1].hours);
      volatility = sum / (sortedAsc.length - 1);
    }

    // Weekend vs weekday average, relative to overall mean
    let weekendDelta = null;
    if (overallAvg != null) {
      const weekendVals = sortedAsc.filter(l => [0, 6].includes(new Date(l.logged_at + 'T00:00:00').getDay())).map(l => l.hours);
      const weekdayVals = sortedAsc.filter(l => ![0, 6].includes(new Date(l.logged_at + 'T00:00:00').getDay())).map(l => l.hours);
      if (weekendVals.length >= 2 && weekdayVals.length >= 2) {
        const weekendAvg = weekendVals.reduce((a, b) => a + b, 0) / weekendVals.length;
        const weekdayAvg = weekdayVals.reduce((a, b) => a + b, 0) / weekdayVals.length;
        weekendDelta = weekendAvg - weekdayAvg;
      }
    }

    // Momentum: avg hours over the last 14 days vs the prior 14 days
    const last14Entries = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 13 * 86400000)));
    const prev14Entries = sortedAsc.filter(l =>
      l.logged_at >= localDateStr(new Date(todayD.getTime() - 27 * 86400000)) &&
      l.logged_at < localDateStr(new Date(todayD.getTime() - 13 * 86400000))
    );
    let momentumDelta = null;
    if (last14Entries.length >= 2 && prev14Entries.length >= 2) {
      const avgOf = (entries) => entries.reduce((s, e) => s + e.hours, 0) / entries.length;
      momentumDelta = avgOf(last14Entries) - avgOf(prev14Entries);
    }

    // Biggest single night-to-night swing in the last 30 days
    const last30 = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 29 * 86400000)));
    let biggestSwing = null;
    if (last30.length >= 2) {
      for (let i = 1; i < last30.length; i++) {
        const delta = last30[i].hours - last30[i - 1].hours;
        if (biggestSwing == null || Math.abs(delta) > Math.abs(biggestSwing.delta)) {
          biggestSwing = { delta, date: last30[i].logged_at };
        }
      }
    }

    // Days since last log
    const lastLogDate = sortedDesc[0]?.logged_at ?? null;
    const daysSinceLastLog = lastLogDate
      ? Math.floor((todayD.getTime() - new Date(lastLogDate + 'T00:00:00').getTime()) / 86400000)
      : null;

    return {
      currentLogStreak, longestLogStreak, consistencyPct, prevConsistencyPct,
      bestDow, bestDowDelta, volatility, weekendDelta, momentumDelta, biggestSwing, daysSinceLastLog,
    };
  }, [logDateSet, sortedAsc, sortedDesc]);

  // Insights
  const insights = useMemo(() => {
    const out = [];

    // Sleep → next-day steps correlation (last 14 nights)
    const sleepWithSteps = sortedDesc.slice(0, 14).map(e => {
      const nextDay = localDateStr(new Date(new Date(e.logged_at + 'T00:00:00').getTime() + 86400000));
      const stepEntry = steps.find(s => s.logged_at === nextDay);
      return { hrs: e.hours, steps: stepEntry ? stepEntry.steps : null };
    }).filter(x => x.steps !== null);
    if (sleepWithSteps.length >= 5) {
      const goodArr = sleepWithSteps.filter(x => x.hrs >= goal);
      const poorArr = sleepWithSteps.filter(x => x.hrs < goal);
      const goodSleepSteps = goodArr.reduce((s, x) => s + x.steps, 0) / Math.max(1, goodArr.length);
      const poorSleepSteps = poorArr.reduce((s, x) => s + x.steps, 0) / Math.max(1, poorArr.length);
      if (poorSleepSteps > 0 && goodSleepSteps > poorSleepSteps * 1.1) {
        out.push({ icon: '👟', text: t('sleep.insightWalkPrefix'), bold: t('sleep.insightWalkBold', { value: Math.round(goodSleepSteps - poorSleepSteps).toLocaleString() }), rest: t('sleep.insightWalkSuffix') });
      }
    }

    // Sleep → next-day workout volume correlation (last 14 nights)
    const sleepWithWorkout = sortedDesc.slice(0, 14).map(e => {
      const nextDay = localDateStr(new Date(new Date(e.logged_at + 'T00:00:00').getTime() + 86400000));
      const sess = sessions.filter(s => s.date === nextDay);
      const vol = sess.reduce((sum, s) => sum + (s.total_volume || 0), 0);
      return { hrs: e.hours, vol: sess.length ? vol : null };
    }).filter(x => x.vol !== null);
    if (sleepWithWorkout.length >= 4) {
      const goodArr = sleepWithWorkout.filter(x => x.hrs >= goal);
      const poorArr = sleepWithWorkout.filter(x => x.hrs < goal);
      const goodVol = goodArr.reduce((s, x) => s + x.vol, 0) / Math.max(1, goodArr.length);
      const poorVol = poorArr.reduce((s, x) => s + x.vol, 0) / Math.max(1, poorArr.length);
      if (poorVol > 0 && goodVol > poorVol * 1.05) {
        out.push({ icon: '🏋️', text: t('sleep.insightVolumePrefix'), bold: t('sleep.insightVolumeBold', { value: Math.round((goodVol / poorVol - 1) * 100) }), rest: t('sleep.insightVolumeSuffix') });
      }
    }

    if (weekDebt >= 5) out.push({ icon: '⚠️', text: t('sleep.insightDebtPrefix'), bold: t('sleep.insightDebtBold', { value: weekDebt }), rest: t('sleep.insightDebtSuffix') });
    if (consistencyRaw === 'Poor') out.push({ icon: '🕐', text: t('sleep.insightIrregularPrefix'), bold: t('sleep.insightIrregularBold'), rest: t('sleep.insightIrregularSuffix') });
    if (avg7 >= goal) out.push({ icon: '✅', text: t('sleep.insightAveragingPrefix'), bold: `${avg7}h`, rest: t('sleep.insightAveragingSuffix', { goal }) });

    const c = sleepConsistency;
    if (c.consistencyPct > c.prevConsistencyPct) {
      out.push({ icon: '📈', text: t('sleep.insightConsistencyUpText'), bold: `${c.consistencyPct - c.prevConsistencyPct}%`, rest: t('sleep.insightConsistencyUpRest') });
    } else if (c.consistencyPct < c.prevConsistencyPct) {
      out.push({ icon: '📉', text: t('sleep.insightConsistencyDownText'), bold: `${c.prevConsistencyPct - c.consistencyPct}%`, rest: t('sleep.insightConsistencyDownRest') });
    }
    if (c.currentLogStreak >= c.longestLogStreak && c.currentLogStreak > 0) {
      out.push({ icon: '🔥', text: t('sleep.insightBestStreakText'), bold: t('sleep.insightBestStreakBold'), rest: t('sleep.insightBestStreakRest', { count: c.currentLogStreak }) });
    } else if (c.longestLogStreak > c.currentLogStreak && c.currentLogStreak > 0) {
      out.push({ icon: '🎯', text: t('sleep.insightTiesRecordText', { count: c.longestLogStreak - c.currentLogStreak }), bold: t('sleep.insightTiesRecordBold'), rest: t('sleep.insightTiesRecordRest', { count: c.longestLogStreak }) });
    }
    if (c.bestDow != null && Math.abs(c.bestDowDelta) > 0.2) {
      out.push({
        icon: '📅',
        text: t('sleep.insightBestDowText', { day: DOW_FULL[c.bestDow] }),
        bold: `${c.bestDowDelta >= 0 ? '+' : ''}${c.bestDowDelta.toFixed(1)}h`,
        rest: t('sleep.insightBestDowRest'),
      });
    }
    if (c.volatility != null && c.volatility >= 1) {
      out.push({ icon: '〜', text: t('sleep.insightVolatilityText'), bold: `±${c.volatility.toFixed(1)}h`, rest: t('sleep.insightVolatilityRest') });
    }
    if (c.weekendDelta != null && Math.abs(c.weekendDelta) > 0.3) {
      out.push({
        icon: '🌙',
        text: t('sleep.insightWeekendText'),
        bold: `${c.weekendDelta >= 0 ? '+' : ''}${c.weekendDelta.toFixed(1)}h`,
        rest: t('sleep.insightWeekendRest'),
      });
    }
    if (c.momentumDelta != null && Math.abs(c.momentumDelta) > 0.4) {
      if (c.momentumDelta > 0) {
        out.push({ icon: '🚀', text: t('sleep.insightMomentumBuildingText'), bold: '', rest: t('sleep.insightMomentumBuildingRest', { value: c.momentumDelta.toFixed(1) }) });
      } else {
        out.push({ icon: '🐢', text: t('sleep.insightProgressSlowedText'), bold: '', rest: t('sleep.insightProgressSlowedRest', { value: Math.abs(c.momentumDelta).toFixed(1) }) });
      }
    }
    if (c.biggestSwing && Math.abs(c.biggestSwing.delta) >= 2) {
      out.push({
        icon: '⚡',
        text: t('sleep.insightBiggestSwingText'),
        bold: `${c.biggestSwing.delta >= 0 ? '+' : ''}${c.biggestSwing.delta.toFixed(1)}h`,
        rest: t('sleep.insightBiggestSwingRest', { date: new Date(c.biggestSwing.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }),
      });
    }
    if (c.daysSinceLastLog != null && c.daysSinceLastLog >= 3) {
      out.push({ icon: '⚠️', text: t('sleep.insightDaysSinceLastLogText'), bold: t('sleep.insightDaysSinceLastLogBold', { count: c.daysSinceLastLog }), rest: t('sleep.insightDaysSinceLastLogRest') });
    }
    return out;
  }, [weekDebt, consistencyRaw, avg7, goal, sortedDesc, steps, sessions, sleepConsistency, t]);

  // Trend chart data
  const chartData = useMemo(() => {
    const sortedAsc = [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at));
    if (trendRangeDays === 0) return sortedAsc;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - trendRangeDays);
    const cutoffStr = localDateStr(cutoff);
    return sortedAsc.filter(l => l.logged_at >= cutoffStr);
  }, [logs, trendRangeDays]);

  const trendStats = useMemo(() => {
    if (chartData.length < 2) return null;
    const avgNight = +(chartData.reduce((s, x) => s + x.hours, 0) / chartData.length).toFixed(1);
    const goalNightsHit = chartData.filter(x => x.hours >= goal).length;
    const bestNight = Math.max(...chartData.map(x => x.hours));
    const debtHours = +chartData.reduce((s, x) => s + Math.max(0, goal - x.hours), 0).toFixed(1);
    return { avgNight, goalNightsHit, totalNights: chartData.length, bestNight, debtHours };
  }, [chartData, goal]);

  const mk = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthLogs = useMemo(() => sortedDesc.filter(l => l.logged_at.startsWith(mk)), [sortedDesc, mk]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const SCREEN_W = Dimensions.get('window').width;
  const chartWidth = SCREEN_W - 32 - 32;

  const openLogSheet = () => {
    setLogDate(localDateStr(new Date()));
    setHoursInput('');
    setShowLogSheet(true);
  };

  const openLogSheetForDate = (dateStr) => {
    if (dateStr > localDateStr(new Date())) return;
    const existing = logs.find(l => l.logged_at === dateStr);
    setLogDate(dateStr);
    setHoursInput(existing ? String(existing.hours) : '');
    setShowLogSheet(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* App header */}
      <ScreenHeader title={t('sleep.headerTitle')} colors={colors} />

      {/* Month nav */}
      <View style={styles.topRow}>
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.monthBtn}>
            <Text style={styles.monthChevron}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMonthPicker(true)}>
            <Text style={styles.monthLabel}>{MONTH_FULL[month]} {year}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={nextMonth} style={styles.monthBtn}>
            <Text style={styles.monthChevron}>›</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.screenLabel}>{t('sleep.headerTitle')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <SkeletonScreen cards={4} linesPerCard={3} />
        ) : (
          <>
            {/* ── Recovery card ── */}
            <View style={styles.recoveryCard}>
              <View style={styles.recoveryGradientBar} />
              <View style={styles.recoveryTopRow}>
                <TouchableOpacity
                  onPress={recoveryExport.onExportPress}
                  disabled={recoveryExport.exporting}
                  style={styles.cardExportBtn}
                >
                  {recoveryExport.exporting ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="share-outline" size={13} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.goalPillBtn} onPress={() => { if (!isPro) { setShowRangePaywall(true); return; } setGoalInput(String(goal)); setShowGoalSheet(true); }}>
                  <Text style={styles.goalPillBtnText}>🎯 {goal}h</Text>
                  <Ionicons name={isPro ? 'pencil' : 'lock-closed'} size={11} color={colors.accent} />
                </TouchableOpacity>
              </View>
              <View style={styles.recoveryRow}>
                <CircularGauge
                  percent={recoveryScore} size={92} strokeWidth={9} color={recoveryColor}
                  value={recoveryScore || '—'} label={t('sleep.recoveryLabel')}
                  valueStyle={{ color: colors.text }} labelStyle={{ color: colors.textMuted }}
                />
                <Text style={styles.recoveryVerdict}>{verdict}</Text>
              </View>

              <View style={styles.recoveryDividerLine} />

              {/* ── Stat tiles ── */}
              <View style={styles.statTileRow}>
                <StatTile value={`${avg7}h`} label={t('sleep.statAvgHrs')} colors={colors} />
                <View style={styles.statTileDivider} />
                <StatTile value={weekDebt > 0 ? `-${weekDebt}h` : '0h'} label={t('sleep.statSleepDebt')} color={weekDebt > 3 ? colors.danger : weekDebt > 1 ? colors.warn : colors.good} colors={colors} />
                <View style={styles.statTileDivider} />
                <StatTile value={`${streak}d`} label={t('sleep.statGoalStreak')} color={streak >= 5 ? colors.good : streak >= 3 ? colors.accent : colors.text} colors={colors} />
                <View style={styles.statTileDivider} />
                <StatTile value={consistency} label={t('sleep.statConsistency')} colors={colors} />
              </View>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={recoveryExport.ref} title={t('sleep.exportRecoveryTitle')} colors={colors} width={340}>
                <View style={{ alignItems: 'center' }}>
                  <View style={styles.recoveryRow}>
                    <CircularGauge
                      percent={recoveryScore} size={92} strokeWidth={9} color={recoveryColor}
                      value={recoveryScore || '—'} label={t('sleep.recoveryLabel')}
                      valueStyle={{ color: colors.text }} labelStyle={{ color: colors.textMuted }}
                    />
                    <Text style={styles.recoveryVerdict}>{verdict}</Text>
                  </View>
                  <View style={[styles.recoveryDividerLine, { width: '100%' }]} />
                  <View style={styles.statTileRow}>
                    <StatTile value={`${avg7}h`} label={t('sleep.statAvgHrs')} colors={colors} />
                    <View style={styles.statTileDivider} />
                    <StatTile value={weekDebt > 0 ? `-${weekDebt}h` : '0h'} label={t('sleep.statSleepDebt')} color={weekDebt > 3 ? colors.danger : weekDebt > 1 ? colors.warn : colors.good} colors={colors} />
                    <View style={styles.statTileDivider} />
                    <StatTile value={`${streak}d`} label={t('sleep.statGoalStreak')} color={streak >= 5 ? colors.good : streak >= 3 ? colors.accent : colors.text} colors={colors} />
                    <View style={styles.statTileDivider} />
                    <StatTile value={consistency} label={t('sleep.statConsistency')} colors={colors} />
                  </View>
                </View>
              </ExportCardTemplate>
            </View>

            {/* ── Analysis & Insights (Pro) ── */}
            {insights.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>{t('sleep.analysisInsightsTitle')}</Text>
                  <View style={styles.proBadge}><Text style={styles.proBadgeText}>{t('sleep.proBadge')}</Text></View>
                </View>
                {hasAccess ? (
                  insights.map((ins, i) => (
                    <View key={i} style={styles.insightRow}>
                      <Text style={styles.insightIcon}>{ins.icon}</Text>
                      <Text style={styles.insightText}>
                        {ins.text}<Text style={styles.insightBold}>{ins.bold}</Text>{ins.rest}
                      </Text>
                    </View>
                  ))
                ) : (
                  <>
                    {insights.slice(0, 1).map((ins, i) => (
                      <View key={i} style={styles.insightRow}>
                        <Text style={styles.insightIcon}>{ins.icon}</Text>
                        <Text style={styles.insightText}>
                          {ins.text}<Text style={styles.insightBold}>{ins.bold}</Text>{ins.rest}
                        </Text>
                      </View>
                    ))}
                    {insights.length > 1 && (
                      <TouchableOpacity onPress={() => setShowRangePaywall(true)}>
                        {insights.slice(1).map((ins, i) => (
                          <View key={i} style={styles.insightRow}>
                            <Text style={styles.insightIcon}>{ins.icon}</Text>
                            <View style={[styles.skeletonBar, { width: `${[92, 68, 80, 75][i % 4]}%` }]} />
                          </View>
                        ))}
                        <Text style={styles.emptyText}>{t('sleep.unlockInsightsCta')}</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            )}

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('sleep.monthlyHeatmapTitle')}</Text>
                <TouchableOpacity
                  onPress={() => (hasAccess ? heatmapExport.exportCard() : recoveryExport.setShowPaywall(true))}
                  disabled={heatmapExport.exporting}
                >
                  {heatmapExport.exporting ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="share-outline" size={14} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>
              <View style={[styles.hmLegend, styles.hmLegendRow]}>
                <Text style={styles.hmLegendLabel}>{t('sleep.heatmapLegendPoor')}</Text>
                {['rgba(248,113,113,0.6)', 'rgba(251,191,36,0.55)', 'rgba(52,211,153,0.5)', 'rgba(129,140,248,0.7)'].map((c, i) => (
                  <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                ))}
                <Text style={styles.hmLegendLabel}>{t('sleep.heatmapLegendGreat')}</Text>
              </View>
              <SleepHeatmap year={year} month={month} logsByDate={logsByDate} goal={goal} colors={colors} hasAccess={hasAccess} onLockedPress={() => recoveryExport.setShowPaywall(true)} onDayPress={openLogSheetForDate} />
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={heatmapExport.ref} title={t('sleep.monthlyHeatmapTitle')} subtitle={`${MONTH_NAMES[month]} ${year}`} colors={colors} width={340}>
                <SleepHeatmap year={year} month={month} logsByDate={logsByDate} goal={goal} colors={colors} hasAccess={true} cardWidth={258} />
              </ExportCardTemplate>
            </View>

            {/* ── Sleep Trend ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('sleep.trendTitle')}</Text>
                <View style={styles.segmentRow}>
                  {[30, 60, 90, 0].map(d => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        if (d !== 30 && !hasAccess) { setShowRangePaywall(true); return; }
                        setTrendRangeDays(d);
                      }}
                      style={[styles.segmentBtn, trendRangeDays === d && styles.segmentBtnActive]}
                    >
                      <Text style={[styles.segmentText, trendRangeDays === d && styles.segmentTextActive]}>{d === 0 ? t('sleep.rangeAll') : t('sleep.rangeDays', { value: d })}{d !== 30 && !hasAccess ? ' 🔒' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#67e8f9' }]} /><Text style={styles.legendLabel}>{t('sleep.legendDaily')}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} /><Text style={styles.legendLabel}>{t('sleep.legend7dAvg')}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#c4b5fd' }]} /><Text style={styles.legendLabel}>{trendRangeDays === 0 ? t('sleep.legendRangeAvgAll') : t('sleep.legendRangeAvgDays', { value: trendRangeDays })}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#34d399' }]} /><Text style={styles.legendLabel}>{t('sleep.legendGoal')}</Text></View>
              </View>
              <SleepTrendChart data={chartData} goal={goal} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={styles.trendStatsRow}>
                  <WeekStatCell value={`${trendStats.avgNight}h`} label={t('sleep.statAvgPerNight')} color={colors.purple} colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={`${trendStats.goalNightsHit}/${trendStats.totalNights}`} label={t('sleep.statGoalNights')} color={colors.good} colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={`${trendStats.bestNight}h`} label={t('sleep.statBestNight')} color="#22d3ee" colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={trendStats.debtHours > 0 ? `${trendStats.debtHours}h` : '0h'} label={t('sleep.statSleepDebt')} color={trendStats.debtHours > 0 ? colors.danger : colors.good} colors={colors} />
                </View>
              )}
            </View>

            {/* ── Sleep Log ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('sleep.sleepLogTitle')}</Text>
              </View>
              {monthLogs.length === 0 && <Text style={styles.emptyText}>{t('sleep.noEntriesThisMonth')}</Text>}
              {groupByWeek(monthLogs, l => l.logged_at).map(week => (
                <View key={week.key} style={styles.weekGroupBox}>
                  {week.items.map((log, i) => (
                    <SleepLogRow
                      key={log.id}
                      log={log}
                      goal={goal}
                      colors={colors}
                      isLast={i === week.items.length - 1}
                      locked={!hasAccess && log.logged_at < logCutoffStr}
                      onLockedPress={() => setShowRangePaywall(true)}
                      onDelete={() => Alert.alert(t('sleep.deleteEntryTitle'), t('sleep.deleteEntryMessage'), [
                        { text: t('sleep.cancel'), style: 'cancel' },
                        { text: t('sleep.delete'), style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                      ])}
                    />
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openLogSheet}>
        <Text style={styles.fabIcon}>🌙</Text>
      </TouchableOpacity>

      <MonthYearPicker
        visible={showMonthPicker}
        month={month}
        year={year}
        onSelect={(m, y) => { setMonth(m); setYear(y); }}
        onClose={() => setShowMonthPicker(false)}
      />

      {/* Log Sleep bottom sheet */}
      <BottomSheet visible={showLogSheet} onClose={() => setShowLogSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('sleep.logSleepSheetTitle')}</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.sheetFieldRow}>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>{t('sleep.dateLabel')}</Text>
            <DatePickerField
              value={logDate}
              onChange={setLogDate}
              colors={colors}
              maxDate={localDateStr(new Date())}
            />
          </View>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>{t('sleep.hoursSleptLabel')}</Text>
            <TextInput
              style={styles.sheetInput}
              value={hoursInput}
              onChangeText={setHoursInput}
              placeholder="7.5"
              placeholderTextColor={colors.textDim}
              keyboardType="numeric"
            />
          </View>
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => {
            const hours = parseFloat(hoursInput);
            if (!Number.isFinite(hours)) return Alert.alert(t('sleep.requiredTitle'), t('sleep.enterValidHours'));
            logMut.mutate({ date: logDate, hours });
          }}
          disabled={logMut.isPending}
        >
          {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('sleep.saveSleepBtn')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Sleep Goal bottom sheet */}
      <BottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('sleep.setSleepGoalSheetTitle')}</Text>
          <TouchableOpacity onPress={() => setShowGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{(parseFloat(goalInput) || goal)}h</Text>
        <Text style={styles.goalBigSub}>{t('sleep.sleepPerNight')}</Text>

        <TextInput
          style={styles.sheetInput}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={String(goal)}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        <Text style={styles.sheetFieldLabel}>{t('sleep.quickPresetsLabel')}</Text>
        <View style={styles.quickAddRow}>
          {[6, 7, 7.5, 8, 9].map(h => (
            <TouchableOpacity
              key={h}
              style={[styles.quickAddChip, parseFloat(goalInput) === h && { backgroundColor: colors.accent }]}
              onPress={() => setGoalInput(String(h))}
            >
              <Text style={[styles.quickAddChipText, parseFloat(goalInput) === h && { color: colors.bg }]}>{h}h</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => { if (goalInput) goalMut.mutate(goalInput); }}
          disabled={goalMut.isPending}
        >
          {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('sleep.saveGoalBtn')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={recoveryExport.showPaywall} onClose={() => recoveryExport.setShowPaywall(false)} />
      <PaywallModal visible={showRangePaywall} onClose={() => setShowRangePaywall(false)} />
    </SafeAreaView>
  );
}

function StatTile({ value, label, color, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.md, fontFamily: fontFamily.monoBold, color: color || colors.text }}>{value}</Text>
      <Text style={{ fontSize: 8, color: colors.textMuted, fontFamily: fontFamily.bodyBold, letterSpacing: 0.3, marginTop: 4, textAlign: 'center' }}>{label}</Text>
    </View>
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

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8, gap: 8 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  monthBtn: { padding: 8 },
  monthChevron: { fontSize: 22, color: colors.text, fontWeight: '300' },
  monthLabel: { fontSize: typography.base, fontFamily: fontFamily.displayItalic, color: colors.text, fontStyle: 'italic' },

  segmentRow: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 20, padding: 2, marginBottom: 10, alignSelf: 'flex-start' },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 18 },
  segmentBtnActive: { backgroundColor: colors.purple },
  segmentText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.5 },
  segmentTextActive: { color: '#fff' },

  content: { paddingHorizontal: 16, paddingBottom: 16 },

  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono },
  proBadge: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  proBadgeText: { fontSize: 9, fontWeight: weight.black, color: colors.bg, letterSpacing: 0.5 },

  goalPill: { borderWidth: 1, borderColor: colors.purple, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  goalPillText: { fontSize: 10, fontWeight: weight.bold, color: colors.purple, fontFamily: fontFamily.mono },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },
  hmLegendRow: { justifyContent: 'flex-end', marginBottom: 10 },

  legendRow: { flexDirection: 'row', gap: 14, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 10, color: colors.textMuted },

  trendStatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  statDividerInline: { width: 1, height: 24, backgroundColor: colors.border },

  recoveryCard: { backgroundColor: colors.bgCard, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 12, position: 'relative', overflow: 'hidden' },
  recoveryGradientBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#818cf8' },
  recoveryTopRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardExportBtn: { padding: 6, borderRadius: 14, backgroundColor: colors.bgElevated },
  goalPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accent + '1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent + '66',
  },
  goalPillBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.monoBold },
  recoveryRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  recoveryVerdict: { flex: 1, fontSize: typography.base, color: colors.text, fontFamily: fontFamily.body },

  recoveryDividerLine: { height: 1, backgroundColor: colors.border, marginTop: 16, marginBottom: 14 },
  statTileRow: { flexDirection: 'row', alignItems: 'center' },
  statTileDivider: { width: 1, height: 24, backgroundColor: colors.border },

  weekGroupBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 8, marginBottom: 10 },

  goalBigVal: { fontSize: 40, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent, textAlign: 'center', marginTop: 8 },
  goalBigSub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', marginBottom: 16 },
  quickAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  quickAddChip: { backgroundColor: colors.bgElevated, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  quickAddChipText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },

  insightRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'flex-start' },
  insightIcon: { fontSize: 16 },
  insightText: { flex: 1, fontSize: typography.sm, color: colors.textMuted, lineHeight: 19 },
  skeletonBar: { flex: 0, height: 13, marginTop: 3, borderRadius: 4, backgroundColor: colors.dim, borderWidth: 1, borderColor: colors.border },
  insightBold: { color: colors.text, fontWeight: weight.bold },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.purple, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },
  fabIcon: { fontSize: 24 },

  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 2, fontFamily: fontFamily.mono },
  sheetFieldRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sheetFieldCol: { flex: 1 },
  sheetFieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  saveBtn: { backgroundColor: colors.purple, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: weight.bold, fontSize: typography.base },
});
