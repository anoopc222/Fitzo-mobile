import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Polyline, Line, Circle, Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import Chip from '../components/ui/Chip';

// ─── Data Layer ─────────────────────────────────────────────────────────────
// Steps km/kcal are derived on the fly (matches reference app: totalKm =
// totalSteps*0.000762, totalCal = totalSteps*0.04 — see index.html ~L11376-77).
// `distance_km`/`calories_burned` columns on step_logs are written at log time
// for parity with other screens (Weight/Workout persist derived numbers too),
// but all on-screen math recomputes from `steps` directly so historic rows
// without those columns still render correctly.
const KM_PER_STEP = 0.000762;
const KCAL_PER_STEP = 0.04;
const KCAL_PER_GRAM_FAT = 7.7;

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const ACT_TYPES = [
  { key: 'walk', label: 'Walk', icon: '🚶' },
  { key: 'run', label: 'Run', icon: '🏃' },
  { key: 'hike', label: 'Hike', icon: '🥾' },
  { key: 'treadmill', label: 'Treadmill', icon: '⚡' },
  { key: 'cycle', label: 'Cycle', icon: '🚴' },
];
const ACT_ICON = { walk: '🚶', run: '🏃', hike: '🥾', treadmill: '⚡', cycle: '🚴' };

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtK(n) {
  if (n == null) return '—';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

async function fetchSteps(userId) {
  const [logs, profile] = await Promise.all([
    supabase.from('step_logs').select('id, steps, goal, distance_km, calories_burned, activity_type, note, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(400),
    supabase.from('profiles').select('step_goal').eq('id', userId).single(),
  ]);
  if (logs.error) throw logs.error;
  const normLogs = (logs.data ?? []).map(l => ({ ...l, logged_at: l.logged_at.slice(0, 10) }));
  return { logs: normLogs, profile: profile.data };
}

async function logSteps(userId, { date, steps, goal, activityType, note }) {
  const distance_km = +(steps * KM_PER_STEP).toFixed(3);
  const calories_burned = Math.round(steps * KCAL_PER_STEP);
  // No unique constraint on (user_id, logged_at) in the real schema, so we
  // can't rely on upsert's onConflict. Manually check for an existing row on
  // that date and update it; otherwise insert a new one.
  const existing = await supabase
    .from('step_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('logged_at', date)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const fields = {
    steps, goal: goal ?? 10000, distance_km, calories_burned,
    activity_type: activityType || 'walk', note: note || null,
  };

  if (existing.data) {
    const { error } = await supabase
      .from('step_logs')
      .update(fields)
      .eq('id', existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('step_logs').insert({
      ...fields, user_id: userId, logged_at: date,
    });
    if (error) throw error;
  }
}

async function updateStepGoal(userId, goal) {
  const { error } = await supabase.from('profiles').update({ step_goal: goal }).eq('id', userId);
  if (error) throw error;
}

async function deleteStepLog(id) {
  const { error } = await supabase.from('step_logs').delete().eq('id', id);
  if (error) throw error;
}

// ─── Date helpers ────────────────────────────────────────────────────────────
function getWeekRange(refDate, offsetWeeks = 0) {
  const d = new Date(refDate);
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset - offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [localDateStr(monday), localDateStr(sunday), monday];
}

// ─── Trend Chart (Daily + 30d avg) — ports _drawStepsChartWithTrend ─────────
function TrendChart({ monthData, allLogs, goal, colors, width }) {
  const H = 170;
  const P = { t: 18, r: 8, b: 22, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  const valid = monthData.filter(e => e.steps > 0);
  if (valid.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Not enough data yet</Text>
      </View>
    );
  }

  // 30-day rolling avg per data point (mirrors reference: window of 30 days ending at e.date, min 3 entries)
  const trendPoints = monthData.map(e => {
    const end = new Date(e.logged_at + 'T00:00:00');
    const start = new Date(end); start.setDate(end.getDate() - 29);
    const startStr = localDateStr(start);
    const win = allLogs.filter(x => x.steps > 0 && x.logged_at >= startStr && x.logged_at <= e.logged_at);
    return win.length >= 3 ? Math.round(win.reduce((s, x) => s + x.steps, 0) / win.length) : null;
  });

  const allVals = [...valid.map(e => e.steps), goal, ...trendPoints.filter(Boolean)];
  const minV = Math.min(...allVals) * 0.96;
  const maxV = Math.max(...allVals) * 1.04;
  const range = maxV - minV || 1;
  const n = monthData.length;
  const xs = pw / Math.max(n - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + i * xs;

  const pts = monthData.map((e, i) => e.steps > 0 ? { x: toX(i), y: toY(e.steps), v: e.steps, i } : null);
  const ptsValid = pts.filter(Boolean);
  const linePts = ptsValid.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const trendPts = trendPoints.map((v, i) => v != null ? { x: toX(i), y: toY(v), v } : null);
  const trendValid = trendPts.filter(Boolean);
  const trendLine = trendValid.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const goalY = toY(goal);

  // sparse x-axis labels (first, last, evenly spaced)
  const labelStep = n > 8 ? Math.ceil(n / 6) : 1;

  const lastTrend = trendValid[trendValid.length - 1];

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="stepsFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#d4ff00" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#d4ff00" stopOpacity="0" />
        </LinearGradient>
      </Defs>

      {/* grid lines */}
      {[0, 1, 2, 3].map(i => {
        const y = P.t + (ph / 3) * i;
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
      })}

      {/* goal dashed line */}
      <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#d4ff00" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4,4" />

      {/* area fill under daily line */}
      {ptsValid.length > 1 && (
        <Path
          d={`M ${ptsValid[0].x},${H - P.b} ${ptsValid.map(p => `L ${p.x},${p.y}`).join(' ')} L ${ptsValid[ptsValid.length - 1].x},${H - P.b} Z`}
          fill="url(#stepsFill)"
        />
      )}

      {/* daily line */}
      {ptsValid.length > 1 && (
        <Polyline points={linePts} fill="none" stroke="#d4ff00" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {/* 30d avg dashed trend line */}
      {trendValid.length > 1 && (
        <Polyline points={trendLine} fill="none" stroke="#fb7185" strokeOpacity={0.85} strokeWidth={2} strokeDasharray="5,3" strokeLinejoin="round" />
      )}

      {/* daily dots */}
      {ptsValid.map(p => (
        <Circle key={p.i} cx={p.x} cy={p.y} r={3} fill="#d4ff00" />
      ))}

      {/* value labels above visible dots */}
      {monthData.map((e, i) => {
        if (!e.steps) return null;
        if (n > 8 && i % labelStep !== 0 && i !== n - 1) return null;
        const x = toX(i), y = toY(e.steps);
        return null; // RN SVG Text omitted from this pass — see <SvgValueLabels> below
      })}

      {lastTrend != null && (
        <Circle cx={lastTrend.x} cy={lastTrend.y} r={2.5} fill="#fb7185" />
      )}
    </Svg>
  );
}

// ─── Weekly Bar Chart (Goal/Below) — ports fzRenderWeeklyStepsChart ─────────
function WeeklyBarChart({ days, goal, colors, width }) {
  const H = 140;
  const padTop = 22, padBot = 30;
  const chartH = H - padTop - padBot;
  const barGap = 8;
  const barW = (width - barGap * 8) / 7;

  const loggedSteps = days.filter(d => !d.isFuture && d.steps > 0).map(d => d.steps);
  const maxVal = Math.max(...loggedSteps, goal, 1) * 1.1;
  const toY = v => padTop + chartH - (v / maxVal) * chartH;
  const goalY = toY(goal);

  return (
    <Svg width={width} height={H}>
      <Line x1={0} y1={goalY} x2={width} y2={goalY} stroke="rgba(255,255,255,0.18)" strokeWidth={1.3} strokeDasharray="4,3" />
      {days.map((day, i) => {
        const x = barGap + i * (barW + barGap);
        const barH = day.steps > 0 ? Math.max(3, (day.steps / maxVal) * chartH) : 0;
        const barY = padTop + chartH - barH;
        const metGoal = day.steps >= goal;
        const color = metGoal ? '#34d399' : '#f59e0b';
        return (
          <React.Fragment key={day.date}>
            {!day.isFuture && day.steps > 0 ? (
              <Rect x={x} y={barY} width={barW} height={barH} rx={5} fill={color} fillOpacity={0.85} />
            ) : (
              <Rect x={x} y={padTop} width={barW} height={chartH} rx={5} fill="rgba(255,255,255,0.04)" />
            )}
            {day.isToday && (
              <Rect x={x - 1} y={padTop - 2} width={barW + 2} height={chartH + 2} rx={5} fill="none" stroke="rgba(245,158,11,0.6)" strokeWidth={1.5} />
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// ─── Daily Log slider row — ports the track-bar / track-bar-marker markup ──
function DailyLogBar({ steps, goal, barMax, colors }) {
  const W = 100;
  const fillPct = Math.min(97, Math.max(2, (steps / barMax) * 100));
  const goalPct = Math.max(1, Math.min(99, (goal / barMax) * 100));
  const met = steps >= goal;
  const curColor = met ? '#34d399' : '#fbbf24';

  return (
    <View style={{ flex: 1 }}>
      <View style={s_bar.track}>
        <View style={[s_bar.fill, { width: `${fillPct}%` }]} />
        <View style={[s_bar.marker, { left: `${goalPct}%`, backgroundColor: '#f97316' }]} />
        <View style={[s_bar.marker, { left: `${fillPct}%`, backgroundColor: curColor }]} />
      </View>
      <View style={s_bar.labelRow}>
        <Text style={s_bar.labelText}>0</Text>
        <Text style={[s_bar.labelText, { color: '#f97316' }]}>● {goal.toLocaleString()}</Text>
        <Text style={s_bar.labelText}>{barMax.toLocaleString()}</Text>
      </View>
    </View>
  );
}

const s_bar = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', position: 'relative', marginBottom: 4 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: 'rgba(251,191,36,0.22)' },
  marker: { position: 'absolute', top: -3, width: 10, height: 10, borderRadius: 5, marginLeft: -5 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  labelText: { fontSize: 9, color: 'rgba(255,255,255,0.35)', fontFamily: fontFamily.mono },
});

// ─── Monthly Heatmap — ports _renderStepsHeatmap bucket logic ───────────────
function StepsHeatmap({ year, month, logsByDate, goal, colors }) {
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
    const steps = logsByDate[ds] || 0;
    let lvl = 0;
    if (steps > 0) {
      const pct = steps / goal;
      if (pct < 0.5) lvl = 1; else if (pct < 0.85) lvl = 2; else if (pct < 1) lvl = 3; else lvl = 4;
    }
    cells.push({ key: ds, day: d, steps, lvl, isToday: ds === todayStr });
  }

  const LVL_COLOR = {
    0: colors.dim,
    1: 'rgba(56,189,248,0.22)',
    2: 'rgba(34,211,238,0.42)',
    3: 'rgba(20,184,166,0.65)',
    4: 'rgba(52,211,153,0.88)',
  };

  return (
    <View>
      <View style={s_hm.dowRow}>
        {DOW_LABELS.map(d => (
          <View key={d} style={{ width: cellSize, alignItems: 'center' }}>
            <Text style={s_hm.dowText}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={s_hm.grid}>
        {cells.map(cell => {
          if (cell.empty) return <View key={cell.key} style={{ width: cellSize, height: cellSize, margin: 2 }} />;
          return (
            <View
              key={cell.key}
              style={[
                s_hm.cell,
                { width: cellSize, height: cellSize, backgroundColor: LVL_COLOR[cell.lvl] },
                cell.isToday && { borderWidth: 2, borderColor: '#f59e0b' },
              ]}
            >
              <Text style={[s_hm.dayNum, cell.lvl === 0 && { color: colors.textDim }]}>{cell.day}</Text>
              <Text style={[s_hm.stepsTxt, cell.lvl === 0 && { color: colors.textDim, opacity: 0.5 }]}>
                {cell.steps > 0 ? fmtK(cell.steps) : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s_hm = StyleSheet.create({
  dowRow: { flexDirection: 'row', marginBottom: 6 },
  dowText: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.mono },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayNum: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.7)', fontFamily: fontFamily.mono },
  stepsTxt: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.85)', fontFamily: fontFamily.mono, marginTop: 1 },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function StepsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [showLogSheet, setShowLogSheet] = useState(false);
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [stepsInput, setStepsInput] = useState('');
  const [actType, setActType] = useState('walk');
  const [note, setNote] = useState('');
  const [goalInput, setGoalInput] = useState('');

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['steps', user?.id],
    queryFn: () => fetchSteps(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logs = data?.logs ?? [];
  const defaultGoal = data?.profile?.step_goal ?? logs[0]?.goal ?? 10000;

  const logMut = useMutation({
    mutationFn: ({ date, steps, activityType, note: logNote }) =>
      logSteps(user.id, { date, steps, goal: defaultGoal, activityType, note: logNote }),
    onSuccess: () => {
      qc.invalidateQueries(['steps', user.id]);
      qc.invalidateQueries(['home', user.id]);
      setShowLogSheet(false); setStepsInput(''); setNote('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateStepGoal(user.id, parseInt(goal, 10)),
    onSuccess: () => { qc.invalidateQueries(['steps', user.id]); setGoalInput(''); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteStepLog,
    onSuccess: () => { qc.invalidateQueries(['steps', user.id]); qc.invalidateQueries(['home', user.id]); },
  });

  // ── Month-scoped derived data ────────────────────────────────────────────
  const mk = `${year}-${String(month + 1).padStart(2, '0')}`;
  const logMonthData = useMemo(() =>
    logs.filter(l => l.logged_at?.startsWith(mk) && l.steps).sort((a, b) => a.logged_at.localeCompare(b.logged_at)),
  [logs, mk]);

  const logsByDate = useMemo(() => {
    const m = {};
    logs.forEach(l => { if (l.steps) m[l.logged_at] = l.steps; });
    return m;
  }, [logs]);

  const allMonthSorted = useMemo(() =>
    [...logMonthData].sort((a, b) => b.logged_at.localeCompare(a.logged_at)),
  [logMonthData]);

  const allTimeMaxSteps = useMemo(() => {
    const vals = logs.filter(l => l.steps).map(l => l.steps);
    return Math.max(...vals, defaultGoal, 1);
  }, [logs, defaultGoal]);

  // This Week bar chart (always current real week, per reference fzRenderWeeklyStepsChart)
  const weekDays = useMemo(() => {
    const today = new Date();
    const todayStr = localDateStr(today);
    const [, , monday] = getWeekRange(today, 0);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const ds = localDateStr(d);
      const entry = logs.find(l => l.logged_at === ds);
      out.push({
        date: ds, steps: entry?.steps ?? 0,
        isFuture: ds > todayStr, isToday: ds === todayStr,
        label: DOW_LABELS[i], dayNum: d.getDate(),
      });
    }
    return out;
  }, [logs]);

  const weekLogged = weekDays.filter(d => !d.isFuture && d.steps > 0);
  const weekGoalDays = weekLogged.filter(d => d.steps >= defaultGoal).length;
  const weekTotal = weekLogged.reduce((s, d) => s + d.steps, 0);
  const weekAvg = weekLogged.length ? Math.round(weekTotal / weekLogged.length) : 0;
  const weekBest = weekLogged.length ? Math.max(...weekLogged.map(d => d.steps)) : 0;

  const actMonthData = logMonthData;

  const actStats = useMemo(() => {
    if (!actMonthData.length) return null;
    const totalSteps = actMonthData.reduce((s, e) => s + e.steps, 0);
    const avgSteps = Math.round(totalSteps / actMonthData.length);
    const totalKm = totalSteps * KM_PER_STEP;
    const totalCal = Math.round(totalSteps * KCAL_PER_STEP);
    const totalFatG = totalCal / KCAL_PER_GRAM_FAT;
    const goalDaysCount = actMonthData.filter(e => e.steps >= defaultGoal).length;
    const totalMins = Math.round((totalKm / 5) * 60); // assume 5km/h walking pace
    return {
      totalSteps, avgSteps, totalKm, totalCal, totalFatG, goalDaysCount,
      hitRate: Math.round((goalDaysCount / actMonthData.length) * 100),
      daysLogged: actMonthData.length, totalMins,
    };
  }, [actMonthData, defaultGoal]);

  const personalBest = useMemo(() => {
    const withSteps = logs.filter(l => l.steps);
    if (!withSteps.length) return null;
    return withSteps.reduce((best, e) => (e.steps > best.steps ? e : best), withSteps[0]);
  }, [logs]);

  const lifetimeSteps = useMemo(() => logs.filter(l => l.steps).reduce((s, l) => s + l.steps, 0), [logs]);

  const [thisWStart, thisWEnd] = getWeekRange(new Date(), 0);
  const [lastWStart, lastWEnd] = getWeekRange(new Date(), 1);
  const thisWeekLogs = logs.filter(l => l.steps && l.logged_at >= thisWStart && l.logged_at <= thisWEnd);
  const lastWeekLogs = logs.filter(l => l.steps && l.logged_at >= lastWStart && l.logged_at <= lastWEnd);
  const thisWeekAvg = thisWeekLogs.length ? Math.round(thisWeekLogs.reduce((s, l) => s + l.steps, 0) / thisWeekLogs.length) : 0;
  const lastWeekAvg = lastWeekLogs.length ? Math.round(lastWeekLogs.reduce((s, l) => s + l.steps, 0) / lastWeekLogs.length) : 0;
  const maxWeek = Math.max(thisWeekAvg, lastWeekAvg, defaultGoal, 1);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const SCREEN_W = Dimensions.get('window').width;
  const chartWidth = SCREEN_W - 32 - 32;

  const openLogSheet = () => {
    setLogDate(localDateStr(new Date()));
    setStepsInput('');
    setActType('walk');
    setNote('');
    setShowLogSheet(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* App header */}
      <View style={styles.appHeader}>
        <Text style={styles.logoText}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
        <Text style={styles.screenLabel}>STEPS</Text>
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
          <Text style={styles.monthLabel}>{MONTH_FULL[month]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} style={styles.monthBtn}>
            <Text style={styles.monthChevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── Hero ── */}
            <View style={styles.heroCard}>
              <Text style={styles.heroEmoji}>🚀</Text>
              <Text style={styles.heroNum}>{actStats ? actStats.avgSteps.toLocaleString() : '—'}</Text>
              <Text style={styles.heroLabel}>AVG STEPS/DAY · {MONTH_NAMES[month].toUpperCase()} {year}</Text>
              <Text style={styles.heroSub}>{actStats ? `${actStats.daysLogged} days logged` : 'No data logged for this month yet'}</Text>

              <View style={styles.tileGrid}>
                <Tile value={actStats ? `${actStats.goalDaysCount}/${actStats.daysLogged} (${actStats.hitRate}%)` : '—'} label="GOAL DAYS" color={colors.warn} />
                <Tile value={actStats ? actStats.totalSteps.toLocaleString() : '—'} label="TOTAL STEPS" color={colors.text} />
                <Tile value={actStats ? `${actStats.totalKm.toFixed(1)}km` : '—'} label="KM WALKED" color={colors.good} />
                <Tile value={actStats ? actStats.totalCal.toLocaleString() : '—'} label="KCAL BURNED" color={colors.pink} />
                <Tile value={actStats ? `${actStats.totalFatG.toFixed(1)}g` : '—'} label="🔥 FAT BURNED" color={colors.warn} />
                <Tile
                  value={actStats ? (actStats.totalMins >= 60 ? `${Math.floor(actStats.totalMins / 60)}h ${actStats.totalMins % 60}m` : `${actStats.totalMins}m`) : '—'}
                  label="⏱ DURATION" color={colors.text}
                />
              </View>
            </View>

            {/* ── Personal Best ── */}
            <View style={styles.pbCard}>
              <Text style={styles.pbTrophy}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.pbLabel}>PERSONAL BEST DAY</Text>
                <Text style={styles.pbVal}>{personalBest ? `${personalBest.steps.toLocaleString()} steps` : '—'}</Text>
                <Text style={styles.pbDate}>{personalBest ? fmtDateShort(personalBest.logged_at) : ''}</Text>
                {lifetimeSteps > 0 && (
                  <View style={styles.pbChip}>
                    <Text style={styles.pbChipText}>{(lifetimeSteps / 1000000).toFixed(2)}M lifetime</Text>
                  </View>
                )}
              </View>
            </View>

            {/* ── Step Goal ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>STEP GOAL</Text>
                <Text style={styles.goalCurrentVal}>{defaultGoal.toLocaleString()}</Text>
              </View>
              <View style={styles.goalRow}>
                <TextInput
                  style={styles.goalInput}
                  placeholder={defaultGoal.toLocaleString()}
                  placeholderTextColor={colors.textDim}
                  value={goalInput}
                  onChangeText={setGoalInput}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  style={styles.setGoalBtn}
                  onPress={() => { if (goalInput) goalMut.mutate(goalInput); }}
                  disabled={goalMut.isPending}
                >
                  {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.setGoalBtnText}>SET</Text>}
                </TouchableOpacity>
              </View>
            </View>

            {/* ── This Week sections — only meaningful for the current real month ── */}
            {isCurrentMonth && (
              <>
                <View style={styles.weekCompareRow}>
                  <View style={styles.weekCompareCard}>
                    <Text style={styles.weekCompareTitle}>THIS WEEK</Text>
                    <Text style={[styles.weekCompareVal, { color: colors.accent }]}>{thisWeekAvg ? thisWeekAvg.toLocaleString() : '—'}</Text>
                    <View style={styles.weekCompareBarTrack}>
                      <View style={[styles.weekCompareBarFill, { width: `${thisWeekAvg ? Math.min(100, (thisWeekAvg / maxWeek) * 100) : 0}%`, backgroundColor: colors.accent }]} />
                    </View>
                    <Text style={styles.weekCompareSub}>avg/day · {thisWeekLogs.length}d</Text>
                  </View>
                  <View style={styles.weekCompareCard}>
                    <Text style={styles.weekCompareTitle}>LAST WEEK</Text>
                    <Text style={[styles.weekCompareVal, { color: colors.textMuted }]}>{lastWeekAvg ? lastWeekAvg.toLocaleString() : '—'}</Text>
                    <View style={styles.weekCompareBarTrack}>
                      <View style={[styles.weekCompareBarFill, { width: `${lastWeekAvg ? Math.min(100, (lastWeekAvg / maxWeek) * 100) : 0}%`, backgroundColor: colors.textMuted }]} />
                    </View>
                    <Text style={styles.weekCompareSub}>avg/day · {lastWeekLogs.length}d</Text>
                  </View>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>THIS WEEK — DAILY STEPS</Text>
                    <View style={styles.hmLegend}>
                      <View style={[styles.hmLegendSwatch, { backgroundColor: '#34d399' }]} />
                      <Text style={styles.hmLegendLabel}>Goal</Text>
                      <View style={[styles.hmLegendSwatch, { backgroundColor: '#f59e0b', marginLeft: 8 }]} />
                      <Text style={styles.hmLegendLabel}>Below</Text>
                    </View>
                  </View>
                  <WeeklyBarChart days={weekDays} goal={defaultGoal} colors={colors} width={chartWidth} />
                  <View style={styles.weekDayLabels}>
                    {weekDays.map(d => (
                      <View key={d.date} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={[styles.weekDayLabel, d.isToday && { color: colors.accent, fontWeight: '700' }]}>{d.label}</Text>
                        <Text style={styles.weekDayNum}>{d.dayNum}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.weekStatsRow}>
                    <WeekStatCell value={`${weekGoalDays}/7`} label="GOAL DAYS" color={colors.good} />
                    <WeekStatCell value={weekAvg ? weekAvg.toLocaleString() : '—'} label="AVG/DAY" color={colors.accent} />
                    <WeekStatCell value={weekBest ? weekBest.toLocaleString() : '—'} label="BEST DAY" color="#22d3ee" />
                    <WeekStatCell value={weekTotal ? weekTotal.toLocaleString() : '—'} label="TOTAL" color={colors.text} />
                  </View>
                </View>
              </>
            )}

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>MONTHLY HEATMAP</Text>
                <View style={styles.hmLegend}>
                  <Text style={styles.hmLegendLabel}>Less</Text>
                  {['rgba(56,189,248,0.22)', 'rgba(34,211,238,0.42)', 'rgba(20,184,166,0.65)', 'rgba(52,211,153,0.88)'].map((c, i) => (
                    <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                  ))}
                  <Text style={styles.hmLegendLabel}>More</Text>
                </View>
              </View>
              <StepsHeatmap year={year} month={month} logsByDate={logsByDate} goal={defaultGoal} colors={colors} />
            </View>

            {/* ── Trend Chart ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>STEPS</Text>
                <View style={styles.goalPill}>
                  <Text style={styles.goalPillText}>GOAL {fmtK(defaultGoal)}</Text>
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: '#d4ff00' }]} />
                  <Text style={styles.legendLabel}>Daily</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: '#fb7185' }]} />
                  <Text style={styles.legendLabel}>30d avg</Text>
                </View>
              </View>
              <TrendChart monthData={logMonthData} allLogs={logs} goal={defaultGoal} colors={colors} width={chartWidth} />
            </View>

            {/* ── Daily Log ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>DAILY LOG</Text>
              {allMonthSorted.length === 0 && <Text style={styles.emptyText}>No step entries for this month.</Text>}
              {allMonthSorted.map(log => (
                <View key={log.id} style={styles.logRowWrap}>
                  <View style={styles.logRow}>
                    <Text style={styles.logDate}>{fmtDateShort(log.logged_at)}</Text>
                    <View style={styles.logActIcon}>
                      <Text style={{ fontSize: 13 }}>{ACT_ICON[log.activity_type] || ACT_ICON.walk}</Text>
                    </View>
                    <DailyLogBar steps={log.steps} goal={log.goal ?? defaultGoal} barMax={allTimeMaxSteps} colors={colors} />
                    <Text style={[styles.logSteps, { color: log.steps >= (log.goal ?? defaultGoal) ? colors.good : colors.warn }]}>
                      {log.steps.toLocaleString()}
                    </Text>
                    <TouchableOpacity
                      onPress={() => Alert.alert('Delete entry', `Remove ${fmtDateShort(log.logged_at)}?`, [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                      ])}
                      style={styles.logDelBtn}
                    >
                      <Ionicons name="close" size={14} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>
                  {log.note ? <Text style={styles.logNote}>{log.note}</Text> : null}
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openLogSheet}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      {/* Log Steps bottom sheet */}
      <BottomSheet visible={showLogSheet} onClose={() => setShowLogSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>LOG STEPS</Text>
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
            <Text style={styles.sheetFieldLabel}>STEPS</Text>
            <TextInput
              style={styles.sheetInput}
              value={stepsInput}
              onChangeText={setStepsInput}
              placeholder="10000"
              placeholderTextColor={colors.textDim}
              keyboardType="numeric"
            />
          </View>
        </View>

        <Text style={styles.sheetFieldLabel}>QUICK ADD</Text>
        <View style={styles.quickAddRow}>
          {[2000, 5000, 8000, 10000, 12000].map(n => (
            <TouchableOpacity
              key={n}
              style={styles.quickAddChip}
              onPress={() => setStepsInput(String((parseInt(stepsInput, 10) || 0) + n))}
            >
              <Text style={styles.quickAddChipText}>+{n / 1000}k</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sheetFieldLabel}>ACTIVITY TYPE</Text>
        <View style={styles.actTypeRow}>
          {ACT_TYPES.map(t => (
            <Chip key={t.key} label={`${t.icon} ${t.label}`} selected={actType === t.key} onPress={() => setActType(t.key)} style={{ marginRight: 8, marginBottom: 8 }} />
          ))}
        </View>

        <Text style={styles.sheetFieldLabel}>NOTE (OPTIONAL)</Text>
        <TextInput
          style={styles.sheetNoteInput}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Morning walk in the park..."
          placeholderTextColor={colors.textDim}
          multiline
        />

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => { if (stepsInput) logMut.mutate({ date: logDate, steps: parseInt(stepsInput, 10), activityType: actType, note }); }}
          disabled={logMut.isPending}
        >
          {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Steps</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

function WeekStatCell({ value, label, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontFamily: fontFamily.monoBold, color }}>{value}</Text>
      <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Tile({ value, label, color }) {
  return (
    <View style={s_tile.tile}>
      <Text style={[s_tile.val, { color }]}>{value}</Text>
      <Text style={s_tile.label}>{label}</Text>
    </View>
  );
}

const s_tile = StyleSheet.create({
  tile: { width: '48%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12, marginBottom: 8, alignItems: 'center' },
  val: { fontSize: typography.md, fontFamily: fontFamily.monoBold },
  label: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 4 },
});

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

  segmentRow: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 20, padding: 2 },
  segmentBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18 },
  segmentBtnActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.5 },
  segmentTextActive: { color: colors.bg },

  content: { paddingHorizontal: 16, paddingBottom: 16 },

  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono },

  goalPill: { borderWidth: 1, borderColor: colors.accent, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  goalPillText: { fontSize: 10, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.mono },

  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: colors.textMuted },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  logRowWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logDate: { width: 44, fontSize: 11, color: colors.text, fontFamily: fontFamily.bodyMedium },
  logActIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: colors.dim, alignItems: 'center', justifyContent: 'center' },
  logNote: { fontSize: typography.xs, color: colors.textMuted, paddingLeft: 78, paddingTop: 6 },
  logSteps: { fontSize: typography.sm, fontWeight: weight.bold, minWidth: 56, textAlign: 'right', fontFamily: fontFamily.monoBold },
  logDelBtn: { padding: 4 },

  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },

  weekDayLabels: { flexDirection: 'row', marginTop: 2, marginBottom: 8 },
  weekDayLabel: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.mono },
  weekDayNum: { fontSize: 8, color: colors.textDim, fontFamily: fontFamily.mono, marginTop: 1 },
  weekStatsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },

  heroCard: { backgroundColor: colors.bgCard, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  heroEmoji: { fontSize: 30, marginBottom: 6 },
  heroNum: { fontSize: 38, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent },
  heroLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  heroSub: { fontSize: typography.sm, color: colors.textDim, marginTop: 4, marginBottom: 14 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  pbCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.accent + '14', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.accent + '44', marginBottom: 12,
  },
  pbTrophy: { fontSize: 28 },
  pbLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono, marginBottom: 2 },
  pbVal: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent },
  pbDate: { fontSize: typography.xs, color: colors.textDim, marginTop: 2 },
  pbChip: { alignSelf: 'flex-start', backgroundColor: colors.dim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  pbChipText: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.monoBold },

  goalCurrentVal: { fontSize: typography.base, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.monoBold },
  goalRow: { flexDirection: 'row', gap: 10 },
  goalInput: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  setGoalBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  setGoalBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.sm },

  weekCompareRow: { flexDirection: 'row', gap: 10 },
  weekCompareCard: { flex: 1, backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border },
  weekCompareTitle: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, fontFamily: fontFamily.mono, marginBottom: 8 },
  weekCompareVal: { fontSize: typography.xl, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', marginBottom: 8 },
  weekCompareBarTrack: { height: 5, borderRadius: 3, backgroundColor: colors.bgElevated, overflow: 'hidden', marginBottom: 6 },
  weekCompareBarFill: { height: '100%', borderRadius: 3 },
  weekCompareSub: { fontSize: 10, color: colors.textDim },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },

  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 2, fontFamily: fontFamily.mono },
  sheetFieldRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  sheetFieldCol: { flex: 1 },
  sheetFieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  quickAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  quickAddChip: { backgroundColor: colors.bgElevated, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  quickAddChipText: { fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold },
  actTypeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  sheetNoteInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border, minHeight: 60, textAlignVertical: 'top', marginBottom: 18 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
});
