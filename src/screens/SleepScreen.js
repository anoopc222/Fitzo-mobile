import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Polyline, Line, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import MonthYearPicker from '../components/ui/MonthYearPicker';
import CircularGauge from '../components/CircularGauge';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import { useExportCard } from '../hooks/useExportCard';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

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
function SleepHeatmap({ year, month, logsByDate, goal, colors }) {
  const SCREEN_W = Dimensions.get('window').width;
  const cellSize = Math.floor((SCREEN_W - 32 - 48 - 12) / 7);
  const firstDay = new Date(year, month, 1).getDay();
  let startDow = firstDay - 1; if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());

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
    cells.push({ key: ds, day: d, hrs, lvl, isToday: ds === todayStr });
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
          <View key={d} style={{ width: cellSize, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textMuted, fontFamily: fontFamily.mono }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map(cell => {
          if (cell.empty) return <View key={cell.key} style={{ width: cellSize, height: cellSize, margin: 2 }} />;
          return (
            <View
              key={cell.key}
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
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Sleep Trend Chart — ports _renderSleepTrendChart ───────────────────────
function SleepTrendChart({ data, goal, colors, width }) {
  const H = 200;
  const P = { t: 20, r: 8, b: 22, l: 26 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Not enough data yet</Text>
      </View>
    );
  }

  const vals = data.map(e => e.hours);
  const maxH = Math.max(10, Math.max(...vals) + 1);
  const minH = Math.max(0, Math.min(...vals) - 1);
  const range = maxH - minH || 1;
  const n = data.length;
  const toY = v => P.t + ph - ((v - minH) / range) * ph;
  const toX = i => P.l + (i * pw) / Math.max(n - 1, 1);

  const pts = data.map((e, i) => ({ x: toX(i), y: toY(e.hours), hit: e.hours >= goal }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const goalY = toY(goal);

  const labelStep = n > 8 ? Math.ceil(n / 6) : 1;

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="slpFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#818cf8" stopOpacity="0.25" />
          <Stop offset="1" stopColor="#818cf8" stopOpacity="0.02" />
        </LinearGradient>
      </Defs>

      {[minH, (minH + maxH) / 2, maxH].map((v, i) => {
        const y = toY(v);
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke={colors.border} strokeWidth={1} />;
      })}

      <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#f59e0b" strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="4,4" />

      {pts.length > 1 && (
        <Path
          d={`M ${pts[0].x},${H - P.b} ${pts.map(p => `L ${p.x},${p.y}`).join(' ')} L ${pts[pts.length - 1].x},${H - P.b} Z`}
          fill="url(#slpFill)"
        />
      )}

      {pts.length > 1 && (
        <Polyline points={line} fill="none" stroke="#818cf8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={3} fill={p.hit ? '#34d399' : '#f59e0b'} />
      ))}
    </Svg>
  );
}

// ─── History row — ports renderSleep()'s log list ───────────────────────────
function SleepLogRow({ log, goal, colors, onDelete, isLast }) {
  const diff = +(log.hours - goal).toFixed(1);
  const hitGoal = log.hours >= goal;
  const pct = Math.min(100, Math.round((log.hours / goal) * 100));

  let statusLabel, statusBg, statusTxt, barColor;
  if (log.hours >= goal + 1) {
    statusLabel = `✓ GOAL HIT`; statusBg = 'rgba(52,211,153,0.10)'; statusTxt = '#34d399'; barColor = '#34d399';
  } else if (hitGoal) {
    statusLabel = '✓ GOAL HIT'; statusBg = 'rgba(52,211,153,0.10)'; statusTxt = '#34d399'; barColor = '#34d399';
  } else if (log.hours >= goal - 0.5) {
    statusLabel = '≈ ALMOST'; statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else if (log.hours >= goal - 1.5) {
    statusLabel = `↓ ${Math.abs(diff)}H SHORT`; statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else {
    statusLabel = `✗ ${Math.abs(diff)}H SHORT`; statusBg = 'rgba(248,113,113,0.10)'; statusTxt = '#f87171'; barColor = '#f87171';
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
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const recoveryExport = useExportCard();

  const [chartRange, setChartRange] = useState('1M'); // 1M | 3M | 6M | ALL
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [hoursInput, setHoursInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [showGoalSheet, setShowGoalSheet] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sleep', user?.id],
    queryFn: () => fetchSleep(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logs = data?.logs ?? [];
  const goal = data?.profile?.sleep_goal_hours ?? 7.5;
  const sessions = data?.sessions ?? [];
  const steps = data?.steps ?? [];

  const sortedDesc = useMemo(() => [...logs].sort((a, b) => b.logged_at.localeCompare(a.logged_at)), [logs]);

  const logMut = useMutation({
    mutationFn: ({ date, hours }) => logSleep(user.id, { date, hours }),
    onSuccess: () => {
      qc.invalidateQueries(['sleep', user.id]);
      qc.invalidateQueries(['home', user.id]);
      setShowLogSheet(false); setHoursInput('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const goalMut = useMutation({
    mutationFn: (h) => updateSleepGoal(user.id, parseFloat(h)),
    onSuccess: () => { qc.invalidateQueries(['sleep', user.id]); setGoalInput(''); setShowGoalSheet(false); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteSleepLog,
    onSuccess: () => { qc.invalidateQueries(['sleep', user.id]); qc.invalidateQueries(['home', user.id]); },
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
  const consistency = useMemo(() => {
    const recent = sortedDesc.slice(0, 14).map(e => e.hours);
    if (recent.length < 3) return '—';
    const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length);
    return sd < 0.5 ? 'Great' : sd < 1 ? 'Good' : sd < 1.5 ? 'Fair' : 'Poor';
  }, [sortedDesc]);

  // Recovery score
  const recoveryScore = useMemo(() => {
    if (!sortedDesc.length) return 0;
    const todayStr = localDateStr(new Date());
    const ydayStr = localDateStr(new Date(Date.now() - 86400000));
    const lastNight = sortedDesc[0];
    const lastNightIsRecent = lastNight.logged_at === todayStr || lastNight.logged_at === ydayStr;
    if (lastNightIsRecent) {
      const sleepScore = Math.min(100, Math.round((lastNight.hours / goal) * 70) + (lastNight.quality || 3) * 5);
      const ydaySessions = sessions.filter(s => s.date === ydayStr || s.date === todayStr);
      const sessionLoad = ydaySessions.length
        ? Math.min(30, ydaySessions.reduce((sum, s) => sum + (s.total_volume || 0) / 1000, 0))
        : 0;
      return Math.min(100, Math.max(0, Math.round(sleepScore - sessionLoad + 10)));
    }
    return Math.min(100, Math.round((avg7 / goal) * 85));
  }, [sortedDesc, goal, avg7, sessions]);

  const verdict = recoveryScore >= 80 ? 'Excellent — go hard today 💪'
    : recoveryScore >= 65 ? 'Good — train as planned'
    : recoveryScore >= 45 ? 'Moderate — consider lighter session'
    : recoveryScore > 0 ? 'Low — rest or active recovery only'
    : 'Log last night\'s sleep for your score';

  const recoveryColor = recoveryScore >= 75 ? '#34d399' : recoveryScore >= 50 ? '#f59e0b' : '#f87171';

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
        out.push({ icon: '👟', text: 'You walk ', bold: `${Math.round(goodSleepSteps - poorSleepSteps).toLocaleString()} more steps`, rest: ` on days after a good night's sleep.` });
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
        out.push({ icon: '🏋️', text: 'Your workout volume is ', bold: `${Math.round((goodVol / poorVol - 1) * 100)}% higher`, rest: ' after nights you hit your sleep goal.' });
      }
    }

    if (weekDebt >= 5) out.push({ icon: '⚠️', text: `You have a `, bold: `${weekDebt}h sleep debt`, rest: ` this week. Aim to add 30–60 min earlier bedtime for a few nights.` });
    if (consistency === 'Poor') out.push({ icon: '🕐', text: 'Your sleep duration varies a lot. ', bold: 'Irregular sleep schedules', rest: ' reduce sleep quality even when total hours are the same.' });
    if (avg7 >= goal) out.push({ icon: '✅', text: `You're averaging `, bold: `${avg7}h`, rest: ` — above your ${goal}h goal. Keep it up!` });
    return out;
  }, [weekDebt, consistency, avg7, goal, sortedDesc, steps, sessions]);

  // Trend chart data
  const chartData = useMemo(() => {
    const rangeMonths = { '1M': 1, '3M': 3, '6M': 6, ALL: 9999 }[chartRange];
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - rangeMonths);
    const cutoffStr = localDateStr(cutoff);
    return [...logs].filter(l => chartRange === 'ALL' || l.logged_at >= cutoffStr).sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  }, [logs, chartRange]);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* App header */}
      <View style={styles.appHeader}>
        <Text style={styles.logoText}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
        <Text style={styles.screenLabel}>SLEEP</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.onlineDot} />
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </View>
      </View>

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
        <Text style={styles.screenLabel}>SLEEP</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── Recovery card ── */}
            <View style={styles.recoveryCard}>
              <View style={styles.recoveryGradientBar} />
              <View style={styles.recoveryTopRow}>
                <TouchableOpacity
                  onPress={recoveryExport.exportCard}
                  disabled={recoveryExport.exporting}
                  style={styles.cardExportBtn}
                >
                  {recoveryExport.exporting ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="share-outline" size={13} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.goalPillBtn} onPress={() => { setGoalInput(String(goal)); setShowGoalSheet(true); }}>
                  <Text style={styles.goalPillBtnText}>🌙 {goal}h</Text>
                  <Ionicons name="pencil" size={11} color={colors.accent} />
                </TouchableOpacity>
              </View>
              <View style={styles.recoveryRow}>
                <CircularGauge
                  percent={recoveryScore} size={92} strokeWidth={9} color={recoveryColor}
                  value={recoveryScore || '—'} label="RECOVERY"
                />
                <Text style={styles.recoveryVerdict}>{verdict}</Text>
              </View>

              <View style={styles.recoveryDividerLine} />

              {/* ── Stat tiles ── */}
              <View style={styles.statTileRow}>
                <StatTile value={`${avg7}h`} label="7D AVG HRS" colors={colors} />
                <View style={styles.statTileDivider} />
                <StatTile value={weekDebt > 0 ? `-${weekDebt}h` : '0h'} label="SLEEP DEBT" color={weekDebt > 3 ? colors.danger : weekDebt > 1 ? colors.warn : colors.good} colors={colors} />
                <View style={styles.statTileDivider} />
                <StatTile value={`${streak}d`} label="GOAL STREAK" color={streak >= 5 ? colors.good : streak >= 3 ? colors.accent : colors.text} colors={colors} />
                <View style={styles.statTileDivider} />
                <StatTile value={consistency} label="CONSISTENCY" colors={colors} />
              </View>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={recoveryExport.ref} title="Sleep Recovery" colors={colors} width={340}>
                <View style={{ alignItems: 'center' }}>
                  <View style={styles.recoveryRow}>
                    <CircularGauge
                      percent={recoveryScore} size={92} strokeWidth={9} color={recoveryColor}
                      value={recoveryScore || '—'} label="RECOVERY"
                    />
                    <Text style={styles.recoveryVerdict}>{verdict}</Text>
                  </View>
                  <View style={[styles.recoveryDividerLine, { width: '100%' }]} />
                  <View style={styles.statTileRow}>
                    <StatTile value={`${avg7}h`} label="7D AVG HRS" colors={colors} />
                    <View style={styles.statTileDivider} />
                    <StatTile value={weekDebt > 0 ? `-${weekDebt}h` : '0h'} label="SLEEP DEBT" color={weekDebt > 3 ? colors.danger : weekDebt > 1 ? colors.warn : colors.good} colors={colors} />
                    <View style={styles.statTileDivider} />
                    <StatTile value={`${streak}d`} label="GOAL STREAK" color={streak >= 5 ? colors.good : streak >= 3 ? colors.accent : colors.text} colors={colors} />
                    <View style={styles.statTileDivider} />
                    <StatTile value={consistency} label="CONSISTENCY" colors={colors} />
                  </View>
                </View>
              </ExportCardTemplate>
            </View>

            {/* ── Insights ── */}
            {insights.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>💡 INSIGHTS</Text>
                {insights.map((ins, i) => (
                  <View key={i} style={styles.insightRow}>
                    <Text style={styles.insightIcon}>{ins.icon}</Text>
                    <Text style={styles.insightText}>
                      {ins.text}<Text style={styles.insightBold}>{ins.bold}</Text>{ins.rest}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>MONTHLY HEATMAP</Text>
                <View style={styles.hmLegend}>
                  <Text style={styles.hmLegendLabel}>Poor</Text>
                  {['rgba(248,113,113,0.6)', 'rgba(251,191,36,0.55)', 'rgba(52,211,153,0.5)', 'rgba(129,140,248,0.7)'].map((c, i) => (
                    <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                  ))}
                  <Text style={styles.hmLegendLabel}>Great</Text>
                </View>
              </View>
              <SleepHeatmap year={year} month={month} logsByDate={logsByDate} goal={goal} colors={colors} />
            </View>

            {/* ── Sleep Trend ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>SLEEP TREND</Text>
                <View style={styles.goalPill}>
                  <Text style={styles.goalPillText}>GOAL {goal}H</Text>
                </View>
              </View>
              <View style={styles.segmentRow}>
                {['1M', '3M', '6M', 'ALL'].map(r => (
                  <TouchableOpacity key={r} onPress={() => setChartRange(r)} style={[styles.segmentBtn, chartRange === r && styles.segmentBtnActive]}>
                    <Text style={[styles.segmentText, chartRange === r && styles.segmentTextActive]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <SleepTrendChart data={chartData} goal={goal} colors={colors} width={chartWidth} />
            </View>

            {/* ── Sleep Log ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>SLEEP LOG</Text>
              </View>
              {monthLogs.length === 0 && <Text style={styles.emptyText}>No sleep entries for this month.</Text>}
              {groupByWeek(monthLogs, l => l.logged_at).map(week => (
                <View key={week.key} style={styles.weekGroupBox}>
                  {week.items.map((log, i) => (
                    <SleepLogRow
                      key={log.id}
                      log={log}
                      goal={goal}
                      colors={colors}
                      isLast={i === week.items.length - 1}
                      onDelete={() => Alert.alert('Delete entry', 'Remove this entry?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
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
          <Text style={styles.sheetTitle}>🌙 LOG SLEEP</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.sheetFieldRow}>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>DATE</Text>
            <TextInput
              style={styles.sheetInput}
              value={logDate}
              onChangeText={setLogDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textDim}
            />
          </View>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>HOURS SLEPT</Text>
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
          onPress={() => { if (hoursInput) logMut.mutate({ date: logDate, hours: parseFloat(hoursInput) }); }}
          disabled={logMut.isPending}
        >
          {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Sleep</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Sleep Goal bottom sheet */}
      <BottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>🌙 SET SLEEP GOAL</Text>
          <TouchableOpacity onPress={() => setShowGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{(parseFloat(goalInput) || goal)}h</Text>
        <Text style={styles.goalBigSub}>sleep / night</Text>

        <TextInput
          style={styles.sheetInput}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={String(goal)}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        <Text style={styles.sheetFieldLabel}>QUICK PRESETS</Text>
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
          {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Goal</Text>}
        </TouchableOpacity>
      </BottomSheet>
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

  goalPill: { borderWidth: 1, borderColor: colors.purple, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  goalPillText: { fontSize: 10, fontWeight: weight.bold, color: colors.purple, fontFamily: fontFamily.mono },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },

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
