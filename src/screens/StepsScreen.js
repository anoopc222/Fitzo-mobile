import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Line, Circle, Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import MonthYearPicker from '../components/ui/MonthYearPicker';
import Chip from '../components/ui/Chip';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import PaywallModal from '../components/ui/PaywallModal';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';
import { useGatedExport } from '../hooks/useGatedExport';
import { useExportCard } from '../hooks/useExportCard';
import EmptyState from '../components/EmptyState';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { syncConditionalReminder } from '../lib/notifications';

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
const KM_TO_MI = 0.621371;

function toDispKm(km, unit) { return unit === 'mi' ? +(km * KM_TO_MI).toFixed(2) : +km.toFixed(2); }

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const ACT_TYPES = [
  { key: 'walk', labelKey: 'steps.activityWalk', label: 'Walk', icon: '🚶' },
  { key: 'run', labelKey: 'steps.activityRun', label: 'Run', icon: '🏃' },
  { key: 'hike', labelKey: 'steps.activityHike', label: 'Hike', icon: '🥾' },
  { key: 'treadmill', labelKey: 'steps.activityTreadmill', label: 'Treadmill', icon: '⚡' },
  { key: 'cycle', labelKey: 'steps.activityCycle', label: 'Cycle', icon: '🚴' },
];
const ACT_ICON = { walk: '🚶', run: '🏃', hike: '🥾', treadmill: '⚡', cycle: '🚴' };

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
function fmtK(n) {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} (${DOW_SHORT[d.getDay()]})`;
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
    steps, goal: goal ?? 12000, distance_km, calories_burned,
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

async function fetchSleepForCorrelation(userId) {
  const { data, error } = await supabase
    .from('sleep_logs')
    .select('hours, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? []).map(s => ({ ...s, logged_at: s.logged_at.slice(0, 10) }));
}

// ─── Stats helpers (streaks, breakdowns, insights) ──────────────────────────
function computeStepStreaks(logs, getGoal) {
  const byDate = {};
  logs.forEach(l => { if (l.steps) byDate[l.logged_at] = l; });
  const today = new Date();
  let current = 0;
  let cursor = new Date(today);
  // today doesn't break the streak if not logged yet, but doesn't count until hit
  if (!(byDate[localDateStr(cursor)] && byDate[localDateStr(cursor)].steps >= getGoal(byDate[localDateStr(cursor)]))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (true) {
    const ds = localDateStr(cursor);
    const entry = byDate[ds];
    if (entry && entry.steps >= getGoal(entry)) { current++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  const sortedDates = Object.keys(byDate).sort();
  let longest = 0, run = 0, prevDate = null;
  for (const ds of sortedDates) {
    const entry = byDate[ds];
    const hit = entry.steps >= getGoal(entry);
    if (hit) {
      if (prevDate) {
        const diffDays = Math.round((new Date(ds) - new Date(prevDate)) / 86400000);
        run = diffDays === 1 ? run + 1 : 1;
      } else run = 1;
      longest = Math.max(longest, run);
      prevDate = ds;
    } else { run = 0; prevDate = null; }
  }
  return { current, longest: Math.max(longest, current) };
}

function dayOfWeekAverages(logs) {
  const buckets = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  logs.forEach(l => {
    if (!l.steps) return;
    const dow = new Date(l.logged_at + 'T12:00:00').getDay(); // 0=Sun
    buckets[dow].total += l.steps;
    buckets[dow].count += 1;
  });
  // Reorder Mon..Sun to match DOW_LABELS
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map(dow => ({
    label: DOW_LABELS[order.indexOf(dow)],
    avg: buckets[dow].count ? Math.round(buckets[dow].total / buckets[dow].count) : 0,
    count: buckets[dow].count,
  }));
}

function activityBreakdown(logs) {
  const map = {};
  logs.forEach(l => {
    if (!l.steps) return;
    const key = l.activity_type || 'walk';
    if (!map[key]) map[key] = { steps: 0, count: 0, km: 0, cal: 0 };
    map[key].steps += l.steps;
    map[key].count += 1;
    map[key].km += l.steps * KM_PER_STEP;
    map[key].cal += l.steps * KCAL_PER_STEP;
  });
  const totalSteps = Object.values(map).reduce((s, v) => s + v.steps, 0) || 1;
  return ACT_TYPES.map(t => ({
    ...t,
    steps: map[t.key]?.steps ?? 0,
    count: map[t.key]?.count ?? 0,
    km: map[t.key]?.km ?? 0,
    cal: Math.round(map[t.key]?.cal ?? 0),
    pct: Math.round(((map[t.key]?.steps ?? 0) / totalSteps) * 100),
  })).filter(t => t.count > 0);
}

function adaptiveGoalSuggestion(logs, currentGoal) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = localDateStr(cutoff);
  const recent = logs.filter(l => l.steps && l.logged_at >= cutoffStr);
  if (recent.length < 7) return null;
  const avg = recent.reduce((s, l) => s + l.steps, 0) / recent.length;
  const hitRate = recent.filter(l => l.steps >= currentGoal).length / recent.length;
  if (avg >= currentGoal * 1.15 && hitRate >= 0.7) {
    const suggested = Math.round((avg * 0.95) / 500) * 500;
    if (suggested > currentGoal) return { suggested, avg: Math.round(avg), hitRate: Math.round(hitRate * 100) };
  }
  return null;
}

function correlateSleepSteps(stepLogs, sleepLogs) {
  if (!sleepLogs.length) return null;
  const sleepByDate = {};
  sleepLogs.forEach(s => { sleepByDate[s.logged_at] = s.hours; });
  const lowGroup = [], normalGroup = [];
  stepLogs.forEach(l => {
    if (!l.steps) return;
    const d = new Date(l.logged_at + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const priorNight = sleepByDate[localDateStr(d)];
    if (priorNight == null) return;
    (priorNight < 6 ? lowGroup : normalGroup).push(l.steps);
  });
  if (lowGroup.length < 3 || normalGroup.length < 3) return null;
  const avgLow = Math.round(lowGroup.reduce((s, v) => s + v, 0) / lowGroup.length);
  const avgNormal = Math.round(normalGroup.reduce((s, v) => s + v, 0) / normalGroup.length);
  return { avgLow, avgNormal, diff: avgNormal - avgLow, lowDays: lowGroup.length, normalDays: normalGroup.length };
}

const MILESTONES = [
  { km: 42.2, nameKey: 'steps.milestoneMarathon', name: 'a marathon' },
  { km: 100, nameKey: 'steps.milestoneCenturyRide', name: 'a century ride' },
  { km: 565, nameKey: 'steps.milestoneNycBoston', name: 'NYC to Boston' },
  { km: 1270, nameKey: 'steps.milestoneLondonRome', name: 'London to Rome' },
  { km: 3944, nameKey: 'steps.milestoneNycLa', name: 'NYC to LA' },
  { km: 9000, nameKey: 'steps.milestoneNycTokyo', name: 'NYC to Tokyo' },
  { km: 20000, nameKey: 'steps.milestoneHalfGlobe', name: 'half the globe' },
  { km: 40075, nameKey: 'steps.milestoneAroundWorld', name: 'around the world' },
];
function milestoneDistance(totalKm) {
  let best = null;
  for (const m of MILESTONES) { if (totalKm >= m.km) best = m; }
  const next = MILESTONES.find(m => m.km > totalKm);
  return { best, next, totalKm };
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

// ─── Range Trend Chart (Daily + 7D Avg + Goal) — mirrors WeightTrendChart ──
function StepsTrendChart({ data, goal, colors, width }) {
  const { t } = useTranslation();
  const H = 170;
  const P = { t: 18, r: 8, b: 22, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('steps.notEnoughDataYet')}</Text>
      </View>
    );
  }
  const rawVals = data.map(e => e.steps);
  const avgVals = data.map((_, i) => {
    const win = data.slice(Math.max(0, i - 6), i + 1);
    return Math.round(win.reduce((s, x) => s + x.steps, 0) / win.length);
  });
  const rangeAvgVal = Math.round(rawVals.reduce((s, v) => s + v, 0) / rawVals.length);
  const allVals = [...rawVals, ...avgVals, rangeAvgVal, goal];
  const minV = Math.min(...allVals) * 0.96;
  const maxV = Math.max(...allVals) * 1.04;
  const range = maxV - minV || 1;
  const n = data.length;
  const xs = pw / Math.max(n - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + i * xs;
  const rawPts = rawVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const rawLine = smoothPath(rawPts);
  const avgPts = avgVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const avgLine = smoothPath(avgPts);
  const rangeAvgY = toY(rangeAvgVal);
  const goalY = toY(goal);
  const lastAvg = avgPts[avgPts.length - 1];
  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="stepsTrendFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f59e0b" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {[0, 1, 2, 3].map(i => {
        const y = P.t + (ph / 3) * i;
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke={colors.border} strokeWidth={1} />;
      })}
      <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#34d399" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4,4" />
      <Line x1={P.l} y1={rangeAvgY} x2={width - P.r} y2={rangeAvgY} stroke="#c4b5fd" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="2,3" />
      {avgPts.length > 1 && (
        <Path d={`${avgLine} L ${avgPts[avgPts.length - 1].x.toFixed(1)},${H - P.b} L ${avgPts[0].x.toFixed(1)},${H - P.b} Z`} fill="url(#stepsTrendFill)" />
      )}
      {rawPts.length > 1 && (
        <Path d={rawLine} fill="none" stroke="#67e8f9" strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {avgPts.length > 1 && (
        <Path d={avgLine} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {rawPts.map((p, i) => (<Circle key={i} cx={p.x} cy={p.y} r={2} fill="#67e8f9" fillOpacity={0.6} />))}
      {lastAvg && <Circle cx={lastAvg.x} cy={lastAvg.y} r={3.5} fill="#f59e0b" />}
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
      <Line x1={0} y1={goalY} x2={width} y2={goalY} stroke={colors.border} strokeWidth={1.3} strokeDasharray="4,3" />
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
              <Rect x={x} y={padTop} width={barW} height={chartH} rx={5} fill={colors.dim} />
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

// ─── Daily Log row — ports the Sleep screen's log-row design (colored side
// bar + status pill) so step entries are as readable as sleep entries, while
// keeping the per-entry activity-type icon (walk/run/hike/...). ────────────
function StepsLogRow({ log, goal, colors, onDelete, isLast }) {
  const { t } = useTranslation();
  const diff = log.steps - goal;
  const hitGoal = log.steps >= goal;
  const pct = Math.min(100, Math.round((log.steps / goal) * 100));

  let statusLabel, statusBg, statusTxt, barColor;
  if (hitGoal) {
    statusLabel = t('steps.goalHit'); statusBg = 'rgba(52,211,153,0.10)'; statusTxt = '#34d399'; barColor = '#34d399';
  } else if (diff >= -goal * 0.1) {
    statusLabel = t('steps.almost'); statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else if (diff >= -goal * 0.3) {
    statusLabel = t('steps.stepsShortWarn', { value: fmtK(Math.abs(diff)) }); statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else {
    statusLabel = t('steps.stepsShortDanger', { value: fmtK(Math.abs(diff)) }); statusBg = 'rgba(248,113,113,0.10)'; statusTxt = '#f87171'; barColor = '#f87171';
  }

  return (
    <View style={[styles_logRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border }]}>
      <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: barColor }} />
      <Text style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{ACT_ICON[log.activity_type] || ACT_ICON.walk}</Text>
      <Text style={{ width: 70, fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.mono, fontWeight: '700' }}>{fmtDateShort(log.logged_at)}</Text>
      <Text style={{ fontSize: typography.base, fontWeight: '800', fontFamily: fontFamily.monoBold, color: barColor }}>{fmtK(log.steps)}</Text>
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
const styles_logRow = { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10 };

// ─── Monthly Heatmap — ports _renderStepsHeatmap bucket logic ───────────────
function StepsHeatmap({ year, month, logsByDate, goal, colors, hasAccess = true, onLockedPress, onDayPress, cardWidth }) {
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
    const steps = logsByDate[ds] || 0;
    let lvl = 0;
    if (steps > 0) {
      const pct = steps / goal;
      if (pct < 0.5) lvl = 1; else if (pct < 0.85) lvl = 2; else if (pct < 1) lvl = 3; else lvl = 4;
    }
    const locked = !hasAccess && ds < cutoffStr;
    cells.push({ key: ds, day: d, steps, lvl, isToday: ds === todayStr, locked });
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
              onPress={onDayPress ? () => onDayPress(cell.key, cell.steps) : undefined}
              style={[
                { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
                { width: cellSize, height: cellSize, backgroundColor: LVL_COLOR[cell.lvl] },
                cell.isToday && { borderWidth: 2, borderColor: '#f59e0b' },
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: fontFamily.mono, color: cell.lvl === 0 ? colors.textDim : colors.text }}>{cell.day}</Text>
              <Text style={{ fontSize: 8, fontWeight: '700', fontFamily: fontFamily.mono, marginTop: 1, color: cell.lvl === 0 ? colors.textDim : colors.text, opacity: cell.lvl === 0 ? 0.5 : 1 }}>
                {cell.steps > 0 ? fmtK(cell.steps) : '—'}
              </Text>
            </CellWrapper>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
function PacerCard({ todaySteps, goal, colors, t }) {
  const now = new Date();
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const expectedNow = Math.round(goal * (minuteOfDay / 1440));
  const delta = todaySteps - expectedNow;
  const pct = Math.min(1, todaySteps / Math.max(goal, 1));
  const expectedPct = Math.min(1, expectedNow / Math.max(goal, 1));
  const ahead = delta >= 0;
  const barWidth = Dimensions.get('window').width - 64;

  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.18, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>🏃 Pacer</Text>
        <Text style={{ fontSize: 11, color: ahead ? colors.success : colors.warn, fontWeight: '700' }}>
          {ahead ? `+${delta.toLocaleString()} ahead` : `${Math.abs(delta).toLocaleString()} behind`}
        </Text>
      </View>

      <View style={{ height: 8, backgroundColor: colors.bgElevated, borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: expectedPct * barWidth, backgroundColor: colors.border, borderRadius: 4 }} />
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct * barWidth, backgroundColor: ahead ? colors.success : colors.warn, borderRadius: 4, opacity: 0.9 }} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <Text style={{ fontSize: 11, color: colors.textDim }}>{todaySteps.toLocaleString()} steps</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Animated.Text style={{ fontSize: 12, transform: [{ scale: ahead ? 1 : pulseAnim }] }}>
            {ahead ? '🏆' : '⚡'}
          </Animated.Text>
          <Text style={{ fontSize: 11, color: colors.textDim }}>
            {ahead ? `Goal: ${goal.toLocaleString()}` : `Need ${Math.abs(delta).toLocaleString()} to catch pace`}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function StepsScreen({ embedded = false } = {}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const heroExport = useGatedExport();
  const heatmapExport = useExportCard();
  const { hasAccess, isPro } = useSubscription();

  const [showLogSheet, setShowLogSheet] = useState(false);
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [stepsInput, setStepsInput] = useState('');
  const [actType, setActType] = useState('walk');
  const [note, setNote] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [showGoalSheet, setShowGoalSheet] = useState(false);
  const [distUnit, setDistUnit] = useState('km');

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['steps', user?.id],
    queryFn: () => fetchSteps(user.id),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const logs = data?.logs ?? [];
  const defaultGoal = data?.profile?.step_goal ?? logs[0]?.goal ?? 12000;

  const { prefs: notifPrefs, times: notifTimes } = useNotificationPrefs() ?? { prefs: {}, times: {} };
  const reminderTime = notifTimes.stepsReminder ?? { hour: 22, minute: 0 };
  useEffect(() => {
    if (isLoading || !notifPrefs.stepsReminder) {
      if (!notifPrefs.stepsReminder) syncConditionalReminder('stepsReminder', true, reminderTime.hour, reminderTime.minute, '', '');
      return;
    }
    const todayStr = localDateStr(new Date());
    const loggedToday = logs.some(l => l.logged_at === todayStr);
    syncConditionalReminder('stepsReminder', loggedToday, reminderTime.hour, reminderTime.minute,
      t('steps.notifLogStepsTitle'), t('steps.notifLogStepsBody'));
  }, [isLoading, notifPrefs.stepsReminder, logs, reminderTime.hour, reminderTime.minute]);

  const logMut = useMutation({
    mutationFn: ({ date, steps, activityType, note: logNote }) =>
      logSteps(user.id, { date, steps, goal: defaultGoal, activityType, note: logNote }),
    onMutate: async ({ date, steps, activityType, note: logNote }) => {
      await qc.cancelQueries(['steps', user.id]);
      const previous = qc.getQueryData(['steps', user.id]);
      qc.setQueryData(['steps', user.id], (old) => {
        if (!old) return old;
        const rest = old.logs.filter(l => l.logged_at !== date);
        const optimisticLog = {
          id: `optimistic-${date}`, steps, goal: defaultGoal,
          distance_km: +(steps * KM_PER_STEP).toFixed(3), calories_burned: Math.round(steps * KCAL_PER_STEP),
          activity_type: activityType || 'walk', note: logNote || null, logged_at: date,
        };
        return { ...old, logs: [optimisticLog, ...rest] };
      });
      setShowLogSheet(false); setStepsInput(''); setNote('');
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['steps', user.id], context.previous);
      Alert.alert(t('steps.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['steps', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateStepGoal(user.id, parseInt(goal, 10)),
    onMutate: async (goal) => {
      await qc.cancelQueries(['steps', user.id]);
      const previous = qc.getQueryData(['steps', user.id]);
      const goalNum = parseInt(goal, 10);
      qc.setQueryData(['steps', user.id], (old) => {
        if (!old) return old;
        return { ...old, profile: { ...old.profile, step_goal: goalNum } };
      });
      setGoalInput('');
      setShowGoalSheet(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['steps', user.id], context.previous);
      Alert.alert(t('steps.errorTitle'), e.message);
    },
    onSettled: () => { qc.invalidateQueries(['steps', user.id]); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteStepLog,
    onMutate: async (id) => {
      await qc.cancelQueries(['steps', user.id]);
      const previous = qc.getQueryData(['steps', user.id]);
      qc.setQueryData(['steps', user.id], (old) => {
        if (!old) return old;
        return { ...old, logs: old.logs.filter(l => l.id !== id) };
      });
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['steps', user.id], context.previous);
      Alert.alert(t('steps.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['steps', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
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

  // ── Trend chart (range-based, mirrors WeightScreen pattern) ─────────────
  const [trendRangeDays, setTrendRangeDays] = useState(30); // 30 | 60 | 90 | 0(all)
  const [showTrendPaywall, setShowTrendPaywall] = useState(false);

  const sortedAscLogs = useMemo(() =>
    [...logs].filter(l => l.steps > 0).sort((a, b) => a.logged_at.localeCompare(b.logged_at)),
  [logs]);

  const trendData = useMemo(() => {
    if (trendRangeDays === 0) return sortedAscLogs;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - trendRangeDays);
    const cutoffStr = localDateStr(cutoff);
    return sortedAscLogs.filter(l => l.logged_at >= cutoffStr);
  }, [sortedAscLogs, trendRangeDays]);

  const trendStats = useMemo(() => {
    if (trendData.length < 2) return null;
    const avgPerDay = Math.round(trendData.reduce((s, x) => s + x.steps, 0) / trendData.length);
    const goalDaysHit = trendData.filter(x => x.steps >= (x.goal ?? defaultGoal)).length;
    const bestDay = Math.max(...trendData.map(x => x.steps));
    const totalSteps = trendData.reduce((s, x) => s + x.steps, 0);
    return { avgPerDay, goalDaysHit, totalDays: trendData.length, bestDay, totalSteps };
  }, [trendData, defaultGoal]);

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

  // ── Streak, today nudge, insights, breakdowns ───────────────────────────
  const streaks = useMemo(() => computeStepStreaks(logs, e => e.goal ?? defaultGoal), [logs, defaultGoal]);

  const todayStr = localDateStr(new Date());
  const todayLog = logs.find(l => l.logged_at === todayStr);
  const todaySteps = todayLog?.steps ?? 0;
  const stepsNeededToday = Math.max(0, defaultGoal - todaySteps);

  const yesterdayLog = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return logs.find(l => l.logged_at === localDateStr(d));
  }, [logs]);

  const dowAverages = useMemo(() => dayOfWeekAverages(logs), [logs]);
  const actBreakdown = useMemo(() => activityBreakdown(logs), [logs]);
  const goalSuggestion = useMemo(() => adaptiveGoalSuggestion(logs, defaultGoal), [logs, defaultGoal]);

  const { data: sleepLogs } = useQuery({
    queryKey: ['sleepForStepsCorrelation', user?.id],
    queryFn: () => fetchSleepForCorrelation(user.id),
    enabled: !!user?.id,
  });
  const sleepCorrelation = useMemo(() => correlateSleepSteps(logs, sleepLogs ?? []), [logs, sleepLogs]);

  const milestone = useMemo(() => milestoneDistance(lifetimeSteps * KM_PER_STEP), [lifetimeSteps]);

  const busiestDow = useMemo(() => {
    const withData = dowAverages.filter(d => d.count > 0);
    if (!withData.length) return null;
    return withData.reduce((best, d) => (d.avg > best.avg ? d : best), withData[0]);
  }, [dowAverages]);

  const consistency8wk = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 56);
    const cutoffStr = localDateStr(cutoff);
    const recent = logs.filter(l => l.steps && l.logged_at >= cutoffStr);
    if (!recent.length) return null;
    const hit = recent.filter(l => l.steps >= (l.goal ?? defaultGoal)).length;
    return Math.round((hit / recent.length) * 100);
  }, [logs, defaultGoal]);

  const logDateSet = useMemo(() => new Set(logs.filter(l => l.steps).map(l => l.logged_at)), [logs]);
  const sortedAsc = useMemo(() => logs.filter(l => l.steps).sort((a, b) => a.logged_at.localeCompare(b.logged_at)), [logs]);
  const sortedDesc = useMemo(() => [...sortedAsc].reverse(), [sortedAsc]);

  // Deeper logging/pattern analysis — mirrors Weight/Sleep screens' expanded insights
  const stepsConsistency = useMemo(() => {
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
    const prev8WkLogged = countInWindow(112, 56);
    const prevConsistencyPct = Math.round((prev8WkLogged / 56) * 100);

    // Day-of-week pattern: avg deviation from overall mean steps, per weekday
    const overallVals = sortedAsc.map(l => l.steps);
    const overallAvg = overallVals.length ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length : null;
    let bestDow = null, bestDowDelta = 0;
    if (overallAvg != null) {
      const dowSums = Array(7).fill(0), dowCounts = Array(7).fill(0);
      for (const l of sortedAsc) {
        const dow = new Date(l.logged_at + 'T00:00:00').getDay();
        dowSums[dow] += l.steps - overallAvg;
        dowCounts[dow]++;
      }
      let maxAbs = 0;
      for (let i = 0; i < 7; i++) {
        if (dowCounts[i] < 2) continue;
        const avgDelta = dowSums[i] / dowCounts[i];
        if (Math.abs(avgDelta) > maxAbs) { maxAbs = Math.abs(avgDelta); bestDow = i; bestDowDelta = avgDelta; }
      }
    }

    // Day-to-day volatility: avg absolute delta between consecutive logs
    let volatility = null;
    if (sortedAsc.length >= 3) {
      let sum = 0;
      for (let i = 1; i < sortedAsc.length; i++) sum += Math.abs(sortedAsc[i].steps - sortedAsc[i - 1].steps);
      volatility = sum / (sortedAsc.length - 1);
    }

    // Weekend vs weekday average, relative to overall mean
    let weekendDelta = null;
    if (overallAvg != null) {
      const weekendVals = sortedAsc.filter(l => [0, 6].includes(new Date(l.logged_at + 'T00:00:00').getDay())).map(l => l.steps);
      const weekdayVals = sortedAsc.filter(l => ![0, 6].includes(new Date(l.logged_at + 'T00:00:00').getDay())).map(l => l.steps);
      if (weekendVals.length >= 2 && weekdayVals.length >= 2) {
        const weekendAvg = weekendVals.reduce((a, b) => a + b, 0) / weekendVals.length;
        const weekdayAvg = weekdayVals.reduce((a, b) => a + b, 0) / weekdayVals.length;
        weekendDelta = weekendAvg - weekdayAvg;
      }
    }

    // Momentum: avg steps over the last 14 days vs the prior 14 days
    const last14Entries = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 13 * 86400000)));
    const prev14Entries = sortedAsc.filter(l =>
      l.logged_at >= localDateStr(new Date(todayD.getTime() - 27 * 86400000)) &&
      l.logged_at < localDateStr(new Date(todayD.getTime() - 13 * 86400000))
    );
    let momentumDelta = null;
    if (last14Entries.length >= 2 && prev14Entries.length >= 2) {
      const avgOf = (entries) => entries.reduce((s, e) => s + e.steps, 0) / entries.length;
      momentumDelta = avgOf(last14Entries) - avgOf(prev14Entries);
    }

    // Biggest single day-to-day swing in the last 30 days
    const last30 = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 29 * 86400000)));
    let biggestSwing = null;
    if (last30.length >= 2) {
      for (let i = 1; i < last30.length; i++) {
        const delta = last30[i].steps - last30[i - 1].steps;
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
      currentLogStreak, longestLogStreak, prevConsistencyPct,
      bestDow, bestDowDelta, volatility, weekendDelta, momentumDelta, biggestSwing, daysSinceLastLog,
    };
  }, [logDateSet, sortedAsc, sortedDesc]);

  const stepsDeepInsights = useMemo(() => {
    const out = [];
    const c = stepsConsistency;
    if (consistency8wk != null && c.prevConsistencyPct != null) {
      if (consistency8wk > c.prevConsistencyPct) {
        out.push({ icon: '📈', text: t('steps.insightConsistencyUpText'), bold: `${consistency8wk - c.prevConsistencyPct}%`, rest: t('steps.insightConsistencyUpRest') });
      } else if (consistency8wk < c.prevConsistencyPct) {
        out.push({ icon: '📉', text: t('steps.insightConsistencyDownText'), bold: `${c.prevConsistencyPct - consistency8wk}%`, rest: t('steps.insightConsistencyDownRest') });
      }
    }
    if (c.currentLogStreak >= c.longestLogStreak && c.currentLogStreak > 0) {
      out.push({ icon: '🔥', text: t('steps.insightBestStreakText'), bold: t('steps.insightBestStreakBold'), rest: t('steps.insightBestStreakRest', { count: c.currentLogStreak }) });
    } else if (c.longestLogStreak > c.currentLogStreak && c.currentLogStreak > 0) {
      out.push({ icon: '🎯', text: t('steps.insightTiesRecordText', { count: c.longestLogStreak - c.currentLogStreak }), bold: t('steps.insightTiesRecordBold'), rest: t('steps.insightTiesRecordRest', { count: c.longestLogStreak }) });
    }
    if (c.bestDow != null && Math.abs(c.bestDowDelta) > 300) {
      out.push({
        icon: '📅',
        text: t('steps.insightBestDowText', { day: DOW_FULL[c.bestDow] }),
        bold: `${c.bestDowDelta >= 0 ? '+' : ''}${Math.round(c.bestDowDelta).toLocaleString()}`,
        rest: t('steps.insightBestDowRest'),
      });
    }
    if (c.volatility != null && c.volatility >= 1500) {
      out.push({ icon: '〜', text: t('steps.insightVolatilityText'), bold: `±${Math.round(c.volatility).toLocaleString()}`, rest: t('steps.insightVolatilityRest') });
    }
    if (c.weekendDelta != null && Math.abs(c.weekendDelta) > 500) {
      out.push({
        icon: '🛋️',
        text: t('steps.insightWeekendText'),
        bold: `${c.weekendDelta >= 0 ? '+' : ''}${Math.round(c.weekendDelta).toLocaleString()}`,
        rest: t('steps.insightWeekendRest'),
      });
    }
    if (c.momentumDelta != null && Math.abs(c.momentumDelta) > 500) {
      if (c.momentumDelta > 0) {
        out.push({ icon: '🚀', text: t('steps.insightMomentumBuildingText'), bold: '', rest: t('steps.insightMomentumBuildingRest', { value: Math.round(c.momentumDelta).toLocaleString() }) });
      } else {
        out.push({ icon: '🐢', text: t('steps.insightProgressSlowedText'), bold: '', rest: t('steps.insightProgressSlowedRest', { value: Math.round(Math.abs(c.momentumDelta)).toLocaleString() }) });
      }
    }
    if (c.biggestSwing && Math.abs(c.biggestSwing.delta) >= 3000) {
      out.push({
        icon: '⚡',
        text: t('steps.insightBiggestSwingText'),
        bold: `${c.biggestSwing.delta >= 0 ? '+' : ''}${Math.round(c.biggestSwing.delta).toLocaleString()}`,
        rest: t('steps.insightBiggestSwingRest', { date: new Date(c.biggestSwing.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }),
      });
    }
    if (c.daysSinceLastLog != null && c.daysSinceLastLog >= 3) {
      out.push({ icon: '⚠️', text: t('steps.insightDaysSinceLastLogText'), bold: t('steps.insightDaysSinceLastLogBold', { count: c.daysSinceLastLog }), rest: t('steps.insightDaysSinceLastLogRest') });
    }
    return out;
  }, [stepsConsistency, consistency8wk, t]);

  const [showInsightsPaywall, setShowInsightsPaywall] = useState(false);

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

  const openLogSheetForDate = (dateStr) => {
    if (dateStr > localDateStr(new Date())) return;
    const existing = logs.find(l => l.logged_at === dateStr);
    setLogDate(dateStr);
    setStepsInput(existing ? String(existing.steps) : '');
    setActType(existing?.activity_type || 'walk');
    setNote(existing?.note ?? '');
    setShowLogSheet(true);
  };

  const repeatYesterday = () => {
    if (!yesterdayLog) return;
    setStepsInput(String(yesterdayLog.steps));
    setActType(yesterdayLog.activity_type || 'walk');
    setNote(yesterdayLog.note || '');
  };

  const Wrap = embedded ? View : SafeAreaView;

  return (
    <Wrap style={styles.safe}>
      {!embedded && <ScreenHeader title={t('steps.screenTitle')} colors={colors} />}

      {/* Month nav + unit toggle */}
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
        <View style={styles.segmentRow}>
          {['km', 'mi'].map(u => (
            <TouchableOpacity key={u} onPress={() => setDistUnit(u)} style={[styles.segmentBtn, distUnit === u && styles.segmentBtnActive]}>
              <Text style={[styles.segmentText, distUnit === u && styles.segmentTextActive]}>{u.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <SkeletonScreen cards={4} linesPerCard={3} />
        ) : logs.length === 0 ? (
          <EmptyState
            emoji="👟"
            title="No steps logged yet"
            subtitle="Start tracking to see your progress here"
            actionLabel="Log Steps"
            onAction={() => setShowLogSheet(true)}
          />
        ) : (
          <>
            {/* ── Hero ── */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.heroLabelRow}>
                    <Text style={styles.heroEmojiInline}>🚀</Text>
                    <Text style={styles.heroLabel}>{t('steps.avgStepsPerDayLabel', { month: MONTH_NAMES[month].toUpperCase(), year })}</Text>
                  </View>
                  <Text style={styles.heroNum}>{actStats ? actStats.avgSteps.toLocaleString() : '—'}</Text>
                  <Text style={styles.heroSub}>{actStats ? t('steps.daysLoggedCount', { count: actStats.daysLogged }) : t('steps.noDataThisMonth')}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <TouchableOpacity
                    onPress={heroExport.onExportPress}
                    disabled={heroExport.exporting}
                    style={styles.cardExportBtn}
                  >
                    {heroExport.exporting ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <Ionicons name="share-outline" size={13} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.goalPillBtn} onPress={() => { if (!isPro) { setShowTrendPaywall(true); return; } setGoalInput(String(defaultGoal)); setShowGoalSheet(true); }}>
                    <Text style={styles.goalPillBtnText}>🎯 {fmtK(defaultGoal)}</Text>
                    <Ionicons name={isPro ? 'pencil' : 'lock-closed'} size={11} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.tileCard}>
                <View style={styles.tileRow}>
                  <Tile value={actStats ? `${actStats.goalDaysCount}/${actStats.daysLogged} (${actStats.hitRate}%)` : '—'} label={t('steps.goalDaysLabel')} color={colors.warn} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile value={actStats ? actStats.totalSteps.toLocaleString() : '—'} label={t('steps.totalStepsLabel')} color={colors.text} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile value={actStats ? `${toDispKm(actStats.totalKm, distUnit).toFixed(1)}${distUnit}` : '—'} label={t('steps.unitWalkedLabel', { unit: distUnit.toUpperCase() })} color={colors.good} colors={colors} />
                </View>
                <View style={styles.tileRowDivider} />
                <View style={styles.tileRow}>
                  <Tile value={actStats ? actStats.totalCal.toLocaleString() : '—'} label={t('steps.kcalBurnedLabel')} color={colors.pink} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile value={actStats ? `${actStats.totalFatG.toFixed(1)}g` : '—'} label={t('steps.fatBurnedLabel')} color={colors.warn} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile
                    value={actStats ? (actStats.totalMins >= 60 ? `${Math.floor(actStats.totalMins / 60)}h ${actStats.totalMins % 60}m` : `${actStats.totalMins}m`) : '—'}
                    label={t('steps.durationLabel')} color={colors.text} colors={colors}
                  />
                </View>
              </View>

              <View style={styles.pbInlineRow}>
                <Text style={styles.pbInlineTrophy}>🏆</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pbInlineLabel}>{t('steps.personalBestDayLabel')}</Text>
                  <Text style={styles.pbInlineVal}>{personalBest ? t('steps.stepsCount', { count: personalBest.steps.toLocaleString() }) : '—'}{personalBest ? ` · ${fmtDateShort(personalBest.logged_at)}` : ''}</Text>
                </View>
                {lifetimeSteps > 0 && (
                  <View style={styles.pbChip}>
                    <Text style={styles.pbChipText}>{t('steps.stepsTotal', { count: fmtK(lifetimeSteps) })}</Text>
                  </View>
                )}
              </View>

              <View style={styles.streakNudgeRow}>
                <View style={styles.streakNudgeLine}>
                  <Text style={styles.streakPillEmoji}>🔥</Text>
                  <Text style={styles.streakPillText} numberOfLines={1}>
                    {streaks.current > 0 ? t('steps.dayStreak', { count: streaks.current }) : t('steps.noActiveStreak')}
                    {streaks.longest > streaks.current ? t('steps.bestDaysSuffix', { count: streaks.longest }) : ''}
                  </Text>
                </View>
                {todaySteps < defaultGoal && (
                  <View style={[styles.streakNudgeLine, { marginTop: 4 }]}>
                    <Ionicons name="walk-outline" size={13} color="#f59e0b" />
                    <Text style={styles.nudgeTextCompact} numberOfLines={1}>
                      {todaySteps > 0
                        ? t('steps.walkMoreStepsToday', { count: stepsNeededToday.toLocaleString() })
                        : t('steps.logTodayStepsToHitGoal', { goal: defaultGoal.toLocaleString() })}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <PacerCard todaySteps={todaySteps} goal={defaultGoal} colors={colors} t={t} />

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={heroExport.ref} title={t('steps.exportTitle')} subtitle={`${MONTH_NAMES[month]} ${year}`} colors={colors} width={340}>
                <View>
                  <Text style={styles.heroNum}>{actStats ? actStats.avgSteps.toLocaleString() : '—'}</Text>
                  <Text style={styles.heroSub}>{actStats ? t('steps.daysLoggedCount', { count: actStats.daysLogged }) : t('steps.noDataThisMonth')}</Text>
                  <View style={[styles.tileCard, { marginTop: 14 }]}>
                    <View style={styles.tileRow}>
                      <Tile value={actStats ? `${actStats.goalDaysCount}/${actStats.daysLogged} (${actStats.hitRate}%)` : '—'} label={t('steps.goalDaysLabel')} color={colors.warn} colors={colors} />
                      <View style={styles.tileColDivider} />
                      <Tile value={actStats ? actStats.totalSteps.toLocaleString() : '—'} label={t('steps.totalStepsLabel')} color={colors.text} colors={colors} />
                      <View style={styles.tileColDivider} />
                      <Tile value={actStats ? `${toDispKm(actStats.totalKm, distUnit).toFixed(1)}${distUnit}` : '—'} label={t('steps.unitWalkedLabel', { unit: distUnit.toUpperCase() })} color={colors.good} colors={colors} />
                    </View>
                  </View>
                </View>
              </ExportCardTemplate>
            </View>

            {/* ── Analysis & Insights (Pro) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('steps.analysisInsightsTitle')}</Text>
                <View style={styles.proBadge}><Text style={styles.proBadgeText}>{t('steps.proBadge')}</Text></View>
              </View>
              <View style={styles.weekStatsRow}>
                <WeekStatCell value={hasAccess ? String(streaks.longest) : '●●'} label={t('steps.bestStreakLabel')} color="#f59e0b" colors={colors} />
                <View style={styles.weekStatDivider} />
                <WeekStatCell value={hasAccess ? (consistency8wk != null ? `${consistency8wk}%` : '—') : '●●%'} label={t('steps.consistency8wkLabel')} color={colors.good} colors={colors} />
                <View style={styles.weekStatDivider} />
                <WeekStatCell value={hasAccess ? (busiestDow ? busiestDow.label : '—') : '●●'} label={t('steps.busiestDayLabel')} color="#22d3ee" colors={colors} />
              </View>
              {hasAccess ? (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {goalSuggestion && (
                    <View style={styles.tipRow}>
                      <Text style={styles.tipEmoji}>📈</Text>
                      <Text style={styles.tipText}>{t('steps.tipRaiseGoal', { avg: goalSuggestion.avg.toLocaleString(), hitRate: goalSuggestion.hitRate, suggested: goalSuggestion.suggested.toLocaleString() })}</Text>
                    </View>
                  )}
                  {sleepCorrelation && sleepCorrelation.diff > 200 && (
                    <View style={styles.tipRow}>
                      <Text style={styles.tipEmoji}>😴</Text>
                      <Text style={styles.tipText}>{t('steps.tipSleepCorrelation', { diff: sleepCorrelation.diff.toLocaleString(), avgLow: sleepCorrelation.avgLow.toLocaleString(), avgNormal: sleepCorrelation.avgNormal.toLocaleString() })}</Text>
                    </View>
                  )}
                  {milestone.best && (
                    <View style={styles.tipRow}>
                      <Text style={styles.tipEmoji}>🌍</Text>
                      <Text style={styles.tipText}>{t('steps.tipMilestone', { name: t(milestone.best.nameKey), km: Math.round(milestone.totalKm).toLocaleString() })}</Text>
                    </View>
                  )}
                  {!goalSuggestion && !sleepCorrelation && !milestone.best && stepsDeepInsights.length === 0 && (
                    <Text style={styles.emptyText}>{t('steps.logMoreDaysForInsights')}</Text>
                  )}
                  {stepsDeepInsights.map((ins, i) => (
                    <View key={`deep-${i}`} style={styles.tipRow}>
                      <Text style={styles.tipEmoji}>{ins.icon}</Text>
                      <Text style={styles.tipText}>
                        {ins.text}<Text style={{ fontWeight: '800' }}>{ins.bold}</Text>{ins.rest}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ marginTop: 12, gap: 8 }}>
                  {(() => {
                    const tips = [];
                    if (goalSuggestion) tips.push({ icon: '📈', node: t('steps.tipRaiseGoal', { avg: goalSuggestion.avg.toLocaleString(), hitRate: goalSuggestion.hitRate, suggested: goalSuggestion.suggested.toLocaleString() }) });
                    if (sleepCorrelation && sleepCorrelation.diff > 200) tips.push({ icon: '😴', node: t('steps.tipSleepCorrelation', { diff: sleepCorrelation.diff.toLocaleString(), avgLow: sleepCorrelation.avgLow.toLocaleString(), avgNormal: sleepCorrelation.avgNormal.toLocaleString() }) });
                    if (milestone.best) tips.push({ icon: '🌍', node: t('steps.tipMilestone', { name: t(milestone.best.nameKey), km: Math.round(milestone.totalKm).toLocaleString() }) });
                    stepsDeepInsights.forEach(ins => tips.push({
                      icon: ins.icon,
                      node: (<>{ins.text}<Text style={{ fontWeight: '800' }}>{ins.bold}</Text>{ins.rest}</>),
                    }));
                    const real = tips[0];
                    const maskedIcons = tips.slice(1, 3).map(tp => tp.icon);
                    const fallbackIcons = ['😴', '🌍'];
                    while (maskedIcons.length < 2) maskedIcons.push(fallbackIcons[maskedIcons.length] ?? '⚡');
                    const maskedWidths = [68, 80];
                    return (
                      <>
                        {real ? (
                          <View style={styles.tipRow}>
                            <Text style={styles.tipEmoji}>{real.icon}</Text>
                            <Text style={styles.tipText}>{real.node}</Text>
                          </View>
                        ) : (
                          <View style={styles.tipRow}>
                            <Text style={styles.tipEmoji}>📈</Text>
                            <View style={[styles.skeletonBar, { width: '92%' }]} />
                          </View>
                        )}
                        <TouchableOpacity onPress={() => setShowInsightsPaywall(true)}>
                          {maskedIcons.map((icon, i) => (
                            <View key={`locked-${i}`} style={styles.tipRow}>
                              <Text style={styles.tipEmoji}>{icon}</Text>
                              <View style={[styles.skeletonBar, { width: `${maskedWidths[i]}%` }]} />
                            </View>
                          ))}
                          <Text style={[styles.emptyText, { paddingTop: 12, paddingBottom: 0 }]}>{t('steps.unlockInsightsPro')}</Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                </View>
              )}
            </View>

            {/* ── This Week sections — only meaningful for the current real month ── */}
            {isCurrentMonth && (
              <>
                <View style={styles.weekCompareCardMerged}>
                  <View style={styles.weekCompareCell}>
                    <Text style={styles.weekCompareTitle}>{t('steps.thisWeekLabel')}</Text>
                    <Text style={[styles.weekCompareVal, { color: colors.accent }]}>{thisWeekAvg ? thisWeekAvg.toLocaleString() : '—'}</Text>
                    <View style={styles.weekCompareBarTrack}>
                      <View style={[styles.weekCompareBarFill, { width: `${thisWeekAvg ? Math.min(100, (thisWeekAvg / maxWeek) * 100) : 0}%`, backgroundColor: colors.accent }]} />
                    </View>
                    <Text style={styles.weekCompareSub}>{t('steps.avgPerDayDaysSuffix', { count: thisWeekLogs.length })}</Text>
                  </View>
                  <View style={styles.weekCompareDivider} />
                  <View style={styles.weekCompareCell}>
                    <Text style={styles.weekCompareTitle}>{t('steps.lastWeekLabel')}</Text>
                    <Text style={[styles.weekCompareVal, { color: colors.textMuted }]}>{lastWeekAvg ? lastWeekAvg.toLocaleString() : '—'}</Text>
                    <View style={styles.weekCompareBarTrack}>
                      <View style={[styles.weekCompareBarFill, { width: `${lastWeekAvg ? Math.min(100, (lastWeekAvg / maxWeek) * 100) : 0}%`, backgroundColor: colors.textMuted }]} />
                    </View>
                    <Text style={styles.weekCompareSub}>{t('steps.avgPerDayDaysSuffix', { count: lastWeekLogs.length })}</Text>
                  </View>
                </View>

                <View style={styles.card}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{t('steps.thisWeekDailyStepsTitle')}</Text>
                    <View style={styles.hmLegend}>
                      <View style={[styles.hmLegendSwatch, { backgroundColor: '#34d399' }]} />
                      <Text style={styles.hmLegendLabel}>{t('steps.legendGoal')}</Text>
                      <View style={[styles.hmLegendSwatch, { backgroundColor: '#f59e0b', marginLeft: 8 }]} />
                      <Text style={styles.hmLegendLabel}>{t('steps.legendBelow')}</Text>
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
                    <WeekStatCell value={`${weekGoalDays}/7`} label={t('steps.goalDaysLabel')} color={colors.good} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={weekAvg ? weekAvg.toLocaleString() : '—'} label={t('steps.avgPerDayLabel')} color={colors.accent} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={weekBest ? weekBest.toLocaleString() : '—'} label={t('steps.bestDayLabel')} color="#22d3ee" colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={weekTotal ? weekTotal.toLocaleString() : '—'} label={t('steps.totalLabel')} color={colors.text} colors={colors} />
                  </View>
                </View>
              </>
            )}

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('steps.monthlyHeatmapTitle')}</Text>
                <TouchableOpacity
                  onPress={() => (hasAccess ? heatmapExport.exportCard() : heroExport.setShowPaywall(true))}
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
                <Text style={styles.hmLegendLabel}>{t('steps.legendLess')}</Text>
                {['rgba(56,189,248,0.22)', 'rgba(34,211,238,0.42)', 'rgba(20,184,166,0.65)', 'rgba(52,211,153,0.88)'].map((c, i) => (
                  <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                ))}
                <Text style={styles.hmLegendLabel}>{t('steps.legendMore')}</Text>
              </View>
              <StepsHeatmap year={year} month={month} logsByDate={logsByDate} goal={defaultGoal} colors={colors} hasAccess={hasAccess} onLockedPress={() => heroExport.setShowPaywall(true)} onDayPress={openLogSheetForDate} />
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={heatmapExport.ref} title={t('steps.monthlyHeatmapTitle')} subtitle={`${MONTH_NAMES[month]} ${year}`} colors={colors} width={340}>
                <StepsHeatmap year={year} month={month} logsByDate={logsByDate} goal={defaultGoal} colors={colors} hasAccess={true} cardWidth={258} />
              </ExportCardTemplate>
            </View>

            {/* ── Steps Trend ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('steps.stepsTrendTitle')}</Text>
                <View style={styles.segmentRow}>
                  {[30, 60, 90, 0].map(d => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        if (d !== 30 && !hasAccess) { setShowTrendPaywall(true); return; }
                        setTrendRangeDays(d);
                      }}
                      style={[styles.segmentBtn, trendRangeDays === d && styles.segmentBtnActive]}
                    >
                      <Text style={[styles.segmentText, trendRangeDays === d && styles.segmentTextActive]}>{d === 0 ? t('steps.rangeAll') : t('steps.rangeDays', { count: d })}{d !== 30 && !hasAccess ? ' 🔒' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#67e8f9' }]} /><Text style={styles.legendLabel}>{t('steps.legendDaily')}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} /><Text style={styles.legendLabel}>{t('steps.legend7dAvg')}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#c4b5fd' }]} /><Text style={styles.legendLabel}>{trendRangeDays === 0 ? t('steps.legendAllAvg') : t('steps.legendRangeAvg', { count: trendRangeDays })}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#34d399' }]} /><Text style={styles.legendLabel}>{t('steps.legendGoal')}</Text></View>
              </View>
              <StepsTrendChart data={trendData} goal={defaultGoal} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={styles.weekStatsRow}>
                  <WeekStatCell value={trendStats.avgPerDay.toLocaleString()} label={t('steps.avgPerDayLabel')} color={colors.accent} colors={colors} />
                  <View style={styles.weekStatDivider} />
                  <WeekStatCell value={`${trendStats.goalDaysHit}/${trendStats.totalDays}`} label={t('steps.goalDaysLabel')} color={colors.good} colors={colors} />
                  <View style={styles.weekStatDivider} />
                  <WeekStatCell value={trendStats.bestDay.toLocaleString()} label={t('steps.bestDayLabel')} color="#22d3ee" colors={colors} />
                  <View style={styles.weekStatDivider} />
                  <WeekStatCell value={trendStats.totalSteps.toLocaleString()} label={t('steps.totalLabel')} color={colors.text} colors={colors} />
                </View>
              )}
            </View>

            {/* ── Day-of-Week Average (Pro) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('steps.avgStepsByDayOfWeekTitle')}</Text>
                {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
              </View>
              {hasAccess ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 6 }}>
                  {(() => {
                    const maxAvg = Math.max(...dowAverages.map(d => d.avg), defaultGoal, 1);
                    return dowAverages.map(d => (
                      <View key={d.label} style={{ flex: 1, alignItems: 'center' }}>
                        <View style={{ width: '100%', height: 80, justifyContent: 'flex-end' }}>
                          <View style={{
                            width: '100%', borderRadius: 5,
                            height: Math.max(3, (d.avg / maxAvg) * 80),
                            backgroundColor: d.avg >= defaultGoal ? '#34d399' : '#f59e0b',
                            opacity: d.count ? 0.9 : 0.25,
                          }} />
                        </View>
                        <Text style={styles.weekDayLabel}>{d.label}</Text>
                        <Text style={styles.weekDayNum}>{d.count ? fmtK(d.avg) : '—'}</Text>
                      </View>
                    ));
                  })()}
                </View>
              ) : (
                <TouchableOpacity onPress={() => setShowInsightsPaywall(true)}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 6 }}>
                    {[0.4, 0.65, 0.5, 0.8, 0.55, 0.7, 0.45].map((h, i) => (
                      <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                        <View style={{ width: '100%', height: 80, justifyContent: 'flex-end' }}>
                          <View style={{ width: '100%', borderRadius: 5, height: 80 * h, backgroundColor: colors.dim, borderWidth: 1, borderColor: colors.border }} />
                        </View>
                        <Text style={styles.weekDayLabel}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][i]}</Text>
                        <Text style={styles.weekDayNum}>●●</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[styles.emptyText, { paddingTop: 10, paddingBottom: 0 }]}>{t('steps.unlockWeekdayPatternsPro')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Activity Breakdown (Pro) ── */}
            {actBreakdown.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>{t('steps.activityBreakdownTitle')}</Text>
                  {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
                </View>
                {hasAccess ? (
                  <View style={{ gap: 10 }}>
                    {actBreakdown.map(a => (
                      <View key={a.key}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={styles.actBreakdownLabel}>{a.icon} {t(a.labelKey)} · {t('steps.countSuffix', { count: a.count })}</Text>
                          <Text style={styles.actBreakdownVal}>{t('steps.activityStatsLine', { steps: a.steps.toLocaleString(), km: a.km.toFixed(1), cal: a.cal })}</Text>
                        </View>
                        <View style={styles.weekCompareBarTrack}>
                          <View style={[styles.weekCompareBarFill, { width: `${a.pct}%`, backgroundColor: colors.accent }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setShowInsightsPaywall(true)}>
                    <View style={{ gap: 10 }}>
                      {actBreakdown.map((a, i) => (
                        <View key={a.key}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={styles.actBreakdownLabel}>{a.icon} ●●●● · ●x</Text>
                            <Text style={styles.actBreakdownVal}>{t('steps.activityStatsMasked')}</Text>
                          </View>
                          <View style={styles.weekCompareBarTrack}>
                            <View style={[styles.weekCompareBarFill, { width: `${[70, 45, 60, 30][i % 4]}%`, backgroundColor: colors.dim }]} />
                          </View>
                        </View>
                      ))}
                    </View>
                    <Text style={[styles.emptyText, { paddingTop: 10, paddingBottom: 0 }]}>{t('steps.unlockActivityBreakdownPro')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Daily Log ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('steps.dailyLogTitle')}</Text>
              {allMonthSorted.length === 0 && (
                <EmptyState
                  emoji="👟"
                  title={t('steps.noStepEntriesThisMonth')}
                  subtitle="Tap + to log your steps for today"
                />
              )}
              {groupByWeek(allMonthSorted, l => l.logged_at).map(week => (
                <View key={week.key} style={styles.weekGroupBox}>
                  {week.items.map((log, i) => (
                    <View key={log.id}>
                      <StepsLogRow
                        log={log}
                        goal={log.goal ?? defaultGoal}
                        colors={colors}
                        isLast={i === week.items.length - 1 && !log.note}
                        onDelete={() => Alert.alert(t('steps.deleteEntryTitle'), t('steps.removeEntryConfirm', { date: fmtDateShort(log.logged_at) }), [
                          { text: t('steps.cancel'), style: 'cancel' },
                          { text: t('steps.delete'), style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                        ])}
                      />
                      {log.note ? (
                        <Text style={[styles.logNote, { paddingLeft: 100, borderBottomWidth: i === week.items.length - 1 ? 0 : 1, borderBottomColor: colors.border, paddingBottom: 8 }]}>{log.note}</Text>
                      ) : null}
                    </View>
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
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      <MonthYearPicker
        visible={showMonthPicker}
        month={month}
        year={year}
        onSelect={(m, y) => { setMonth(m); setYear(y); }}
        onClose={() => setShowMonthPicker(false)}
      />

      {/* Log Steps bottom sheet */}
      <BottomSheet visible={showLogSheet} onClose={() => setShowLogSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('steps.logStepsTitle')}</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {yesterdayLog && (
          <TouchableOpacity style={styles.repeatYesterdayBtn} onPress={repeatYesterday}>
            <Ionicons name="repeat" size={13} color={colors.accent} />
            <Text style={styles.repeatYesterdayText}>{t('steps.repeatYesterday', { count: fmtK(yesterdayLog.steps) })}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.sheetFieldRow}>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>{t('steps.dateFieldLabel')}</Text>
            <DatePickerField
              value={logDate}
              onChange={setLogDate}
              colors={colors}
              maxDate={localDateStr(new Date())}
            />
          </View>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>{t('steps.stepsFieldLabel')}</Text>
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

        <Text style={styles.sheetFieldLabel}>{t('steps.quickAddLabel')}</Text>
        <View style={styles.quickAddRow}>
          {[2000, 5000, 8000, 10000, 12000].map(n => (
            <TouchableOpacity
              key={n}
              style={styles.quickAddChip}
              onPress={() => setStepsInput(String((parseInt(stepsInput, 10) || 0) + n))}
            >
              <Text style={styles.quickAddChipText}>{t('steps.quickAddChip', { count: n / 1000 })}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sheetFieldLabel}>{t('steps.activityTypeLabel')}</Text>
        <View style={styles.actTypeRow}>
          {ACT_TYPES.map(at => (
            <Chip key={at.key} label={`${at.icon} ${t(at.labelKey)}`} selected={actType === at.key} onPress={() => setActType(at.key)} style={{ marginRight: 8, marginBottom: 8 }} />
          ))}
        </View>

        <Text style={styles.sheetFieldLabel}>{t('steps.noteOptionalLabel')}</Text>
        <TextInput
          style={styles.sheetNoteInput}
          value={note}
          onChangeText={setNote}
          placeholder={t('steps.notePlaceholder')}
          placeholderTextColor={colors.textDim}
          multiline
        />

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => { if (stepsInput) logMut.mutate({ date: logDate, steps: parseInt(stepsInput, 10), activityType: actType, note }); }}
          disabled={logMut.isPending}
        >
          {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('steps.saveStepsButton')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Step Goal bottom sheet */}
      <BottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('steps.setDailyGoalTitle')}</Text>
          <TouchableOpacity onPress={() => setShowGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{(parseInt(goalInput, 10) || defaultGoal).toLocaleString()}</Text>
        <Text style={styles.goalBigSub}>{t('steps.stepsPerDay')}</Text>

        <TextInput
          style={styles.sheetInput}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={defaultGoal.toLocaleString()}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        <Text style={styles.sheetFieldLabel}>{t('steps.quickPresetsLabel')}</Text>
        <View style={styles.quickAddRow}>
          {[5000, 8000, 10000, 12000, 15000].map(n => (
            <TouchableOpacity
              key={n}
              style={[styles.quickAddChip, parseInt(goalInput, 10) === n && { backgroundColor: colors.accent }]}
              onPress={() => setGoalInput(String(n))}
            >
              <Text style={[styles.quickAddChipText, parseInt(goalInput, 10) === n && { color: colors.bg }]}>{fmtK(n)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => { if (goalInput) goalMut.mutate(goalInput); }}
          disabled={goalMut.isPending}
        >
          {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('steps.saveGoalButton')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={heroExport.showPaywall} onClose={() => heroExport.setShowPaywall(false)} />
      <PaywallModal visible={showTrendPaywall} onClose={() => setShowTrendPaywall(false)} />
      <PaywallModal visible={showInsightsPaywall} onClose={() => setShowInsightsPaywall(false)} />
    </Wrap>
  );
}

function WeekStatCell({ value, label, color, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontFamily: fontFamily.monoBold, color }}>{value}</Text>
      <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Tile({ value, label, color, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}>
      <Text style={{ fontSize: typography.sm, fontFamily: fontFamily.monoBold, color, textAlign: 'center' }}>{value}</Text>
      <Text style={{ fontSize: 8.5, color: colors.textMuted, fontFamily: fontFamily.bodyBold, letterSpacing: 0.4, marginTop: 3, textAlign: 'center' }}>{label}</Text>
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

  segmentRow: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 20, padding: 2 },
  segmentBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 18 },
  segmentBtnActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.5 },
  segmentTextActive: { color: colors.bg },

  content: { paddingHorizontal: 16, paddingBottom: 16 },

  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono },
  proBadge: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  proBadgeText: { fontSize: 9, fontWeight: weight.black, color: colors.bg, letterSpacing: 0.5 },

  goalPill: { borderWidth: 1, borderColor: colors.accent, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  goalPillText: { fontSize: 10, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.mono },

  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: colors.textMuted },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  logNote: { fontSize: typography.xs, color: colors.textMuted, paddingTop: 4 },
  weekGroupBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 8, marginBottom: 10 },

  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },
  hmLegendRow: { justifyContent: 'flex-end', marginBottom: 10 },

  weekDayLabels: { flexDirection: 'row', marginTop: 2, marginBottom: 8 },
  weekDayLabel: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.mono },
  weekDayNum: { fontSize: 8, color: colors.textDim, fontFamily: fontFamily.mono, marginTop: 1 },
  weekStatsRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  weekStatDivider: { width: 1, height: 24, backgroundColor: colors.border },

  heroCard: { backgroundColor: colors.bgCard, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroEmojiInline: { fontSize: 14 },
  cardExportBtn: { padding: 6, borderRadius: 14, backgroundColor: colors.bgElevated },
  goalPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accent + '1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent + '66',
  },
  goalPillBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.monoBold },
  heroNum: { fontSize: 38, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent, marginTop: 4 },
  heroLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1 },
  heroSub: { fontSize: typography.sm, color: colors.textDim, marginTop: 4, marginBottom: 14 },
  tileCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', marginTop: 4 },
  tileRow: { flexDirection: 'row' },
  tileColDivider: { width: 1, backgroundColor: colors.border },
  tileRowDivider: { height: 1, backgroundColor: colors.border },

  pbInlineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 14,
  },
  pbInlineTrophy: { fontSize: 22 },
  pbInlineLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono, marginBottom: 2 },
  pbInlineVal: { fontSize: typography.sm, fontFamily: fontFamily.monoBold, color: colors.accent },
  pbChip: { alignSelf: 'flex-start', backgroundColor: colors.dim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pbChipText: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.monoBold },

  streakRow: { flexDirection: 'row', marginTop: 12 },
  streakPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(245,158,11,0.12)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  streakPillEmoji: { fontSize: 13 },
  streakPillText: { fontSize: 12, fontWeight: weight.bold, color: '#f59e0b', fontFamily: fontFamily.monoBold },
  streakPillSub: { fontSize: 10, color: colors.textDim, marginLeft: 2 },
  nudgeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: 10, padding: 10,
  },
  nudgeText: { flex: 1, fontSize: 11, color: colors.text, lineHeight: 15 },

  streakNudgeRow: {
    marginTop: 12,
    backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.18)',
  },
  streakNudgeLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudgeTextCompact: { flex: 1, fontSize: 11.5, color: colors.text, lineHeight: 15 },

  repeatYesterdayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.accent + '14', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.accent + '44', marginBottom: 16,
  },
  repeatYesterdayText: { fontSize: 11, color: colors.accent, fontWeight: weight.bold },

  tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tipEmoji: { fontSize: 14 },
  tipText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15 },
  skeletonBar: { flex: 0, height: 11, marginTop: 2, borderRadius: 4, backgroundColor: colors.dim, borderWidth: 1, borderColor: colors.border },

  actBreakdownLabel: { fontSize: 11, color: colors.text, fontWeight: weight.semibold },
  actBreakdownVal: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.mono },

  goalBigVal: { fontSize: 40, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent, textAlign: 'center', marginTop: 8 },
  goalBigSub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', marginBottom: 16 },

  weekCompareCardMerged: { flexDirection: 'row', backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12, overflow: 'hidden' },
  weekCompareCell: { flex: 1, padding: 14 },
  weekCompareDivider: { width: 1, backgroundColor: colors.border },
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
