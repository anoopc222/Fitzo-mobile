import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
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
  { km: 42.2, name: 'a marathon' },
  { km: 100, name: 'a century ride' },
  { km: 565, name: 'NYC to Boston' },
  { km: 1270, name: 'London to Rome' },
  { km: 3944, name: 'NYC to LA' },
  { km: 9000, name: 'NYC to Tokyo' },
  { km: 20000, name: 'half the globe' },
  { km: 40075, name: 'around the world' },
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
  const H = 170;
  const P = { t: 18, r: 8, b: 22, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Not enough data yet</Text>
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

// ─── Daily Log slider row — ports the track-bar / track-bar-marker markup ──
function DailyLogBar({ steps, goal, barMax, colors }) {
  const fillPct = Math.min(97, Math.max(2, (steps / barMax) * 100));
  const goalPct = Math.max(1, Math.min(99, (goal / barMax) * 100));
  const met = steps >= goal;
  const curColor = met ? '#34d399' : '#fbbf24';

  return (
    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.dim, position: 'relative' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: 'rgba(251,191,36,0.22)', width: `${fillPct}%` }} />
      <View style={{ position: 'absolute', top: -1, width: 6, height: 6, borderRadius: 3, marginLeft: -3, left: `${goalPct}%`, backgroundColor: '#f97316' }} />
      <View style={{ position: 'absolute', top: -1, width: 6, height: 6, borderRadius: 3, marginLeft: -3, left: `${fillPct}%`, backgroundColor: curColor }} />
    </View>
  );
}

// ─── Monthly Heatmap — ports _renderStepsHeatmap bucket logic ───────────────
function StepsHeatmap({ year, month, logsByDate, goal, colors, hasAccess = true, onLockedPress, cardWidth }) {
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
          return (
            <View
              key={cell.key}
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
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function StepsScreen() {
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

  const { prefs: notifPrefs } = useNotificationPrefs() ?? { prefs: {} };
  useEffect(() => {
    if (isLoading || !notifPrefs.stepsReminder) {
      if (!notifPrefs.stepsReminder) syncConditionalReminder('stepsReminder', true, 22, 0, '', '');
      return;
    }
    const todayStr = localDateStr(new Date());
    const loggedToday = logs.some(l => l.logged_at === todayStr);
    syncConditionalReminder('stepsReminder', loggedToday, 22, 0,
      "Log today's steps", "You haven't logged your steps for today yet.");
  }, [isLoading, notifPrefs.stepsReminder, logs]);

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
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['steps', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateStepGoal(user.id, parseInt(goal, 10)),
    onSuccess: () => { qc.invalidateQueries(['steps', user.id]); setGoalInput(''); setShowGoalSheet(false); },
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

  const repeatYesterday = () => {
    if (!yesterdayLog) return;
    setStepsInput(String(yesterdayLog.steps));
    setActType(yesterdayLog.activity_type || 'walk');
    setNote(yesterdayLog.note || '');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* App header */}
      <ScreenHeader title="STEPS" colors={colors} />

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
        ) : (
          <>
            {/* ── Hero ── */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.heroLabelRow}>
                    <Text style={styles.heroEmojiInline}>🚀</Text>
                    <Text style={styles.heroLabel}>AVG STEPS/DAY · {MONTH_NAMES[month].toUpperCase()} {year}</Text>
                  </View>
                  <Text style={styles.heroNum}>{actStats ? actStats.avgSteps.toLocaleString() : '—'}</Text>
                  <Text style={styles.heroSub}>{actStats ? `${actStats.daysLogged} days logged` : 'No data logged for this month yet'}</Text>
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
                  <Tile value={actStats ? `${actStats.goalDaysCount}/${actStats.daysLogged} (${actStats.hitRate}%)` : '—'} label="GOAL DAYS" color={colors.warn} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile value={actStats ? actStats.totalSteps.toLocaleString() : '—'} label="TOTAL STEPS" color={colors.text} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile value={actStats ? `${toDispKm(actStats.totalKm, distUnit).toFixed(1)}${distUnit}` : '—'} label={`${distUnit.toUpperCase()} WALKED`} color={colors.good} colors={colors} />
                </View>
                <View style={styles.tileRowDivider} />
                <View style={styles.tileRow}>
                  <Tile value={actStats ? actStats.totalCal.toLocaleString() : '—'} label="KCAL BURNED" color={colors.pink} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile value={actStats ? `${actStats.totalFatG.toFixed(1)}g` : '—'} label="🔥 FAT BURNED" color={colors.warn} colors={colors} />
                  <View style={styles.tileColDivider} />
                  <Tile
                    value={actStats ? (actStats.totalMins >= 60 ? `${Math.floor(actStats.totalMins / 60)}h ${actStats.totalMins % 60}m` : `${actStats.totalMins}m`) : '—'}
                    label="⏱ DURATION" color={colors.text} colors={colors}
                  />
                </View>
              </View>

              <View style={styles.pbInlineRow}>
                <Text style={styles.pbInlineTrophy}>🏆</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pbInlineLabel}>PERSONAL BEST DAY</Text>
                  <Text style={styles.pbInlineVal}>{personalBest ? `${personalBest.steps.toLocaleString()} steps` : '—'}{personalBest ? ` · ${fmtDateShort(personalBest.logged_at)}` : ''}</Text>
                </View>
                {lifetimeSteps > 0 && (
                  <View style={styles.pbChip}>
                    <Text style={styles.pbChipText}>{(lifetimeSteps / 1000000).toFixed(2)}M lifetime</Text>
                  </View>
                )}
              </View>

              <View style={styles.streakRow}>
                <View style={styles.streakPill}>
                  <Text style={styles.streakPillEmoji}>🔥</Text>
                  <Text style={styles.streakPillText}>{streaks.current} day streak</Text>
                  {streaks.longest > streaks.current && (
                    <Text style={styles.streakPillSub}>best {streaks.longest}</Text>
                  )}
                </View>
              </View>

              {todaySteps < defaultGoal && (
                <View style={styles.nudgeBanner}>
                  <Ionicons name="walk-outline" size={15} color="#f59e0b" />
                  <Text style={styles.nudgeText}>
                    {todaySteps > 0
                      ? `Walk ${stepsNeededToday.toLocaleString()} more today to hit your goal`
                      : `Log today's steps — ${defaultGoal.toLocaleString()} to hit your goal`}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={heroExport.ref} title="Steps" subtitle={`${MONTH_NAMES[month]} ${year}`} colors={colors} width={340}>
                <View>
                  <Text style={styles.heroNum}>{actStats ? actStats.avgSteps.toLocaleString() : '—'}</Text>
                  <Text style={styles.heroSub}>{actStats ? `${actStats.daysLogged} days logged` : 'No data logged for this month yet'}</Text>
                  <View style={[styles.tileCard, { marginTop: 14 }]}>
                    <View style={styles.tileRow}>
                      <Tile value={actStats ? `${actStats.goalDaysCount}/${actStats.daysLogged} (${actStats.hitRate}%)` : '—'} label="GOAL DAYS" color={colors.warn} colors={colors} />
                      <View style={styles.tileColDivider} />
                      <Tile value={actStats ? actStats.totalSteps.toLocaleString() : '—'} label="TOTAL STEPS" color={colors.text} colors={colors} />
                      <View style={styles.tileColDivider} />
                      <Tile value={actStats ? `${toDispKm(actStats.totalKm, distUnit).toFixed(1)}${distUnit}` : '—'} label={`${distUnit.toUpperCase()} WALKED`} color={colors.good} colors={colors} />
                    </View>
                  </View>
                </View>
              </ExportCardTemplate>
            </View>

            {/* ── This Week sections — only meaningful for the current real month ── */}
            {isCurrentMonth && (
              <>
                <View style={styles.weekCompareCardMerged}>
                  <View style={styles.weekCompareCell}>
                    <Text style={styles.weekCompareTitle}>THIS WEEK</Text>
                    <Text style={[styles.weekCompareVal, { color: colors.accent }]}>{thisWeekAvg ? thisWeekAvg.toLocaleString() : '—'}</Text>
                    <View style={styles.weekCompareBarTrack}>
                      <View style={[styles.weekCompareBarFill, { width: `${thisWeekAvg ? Math.min(100, (thisWeekAvg / maxWeek) * 100) : 0}%`, backgroundColor: colors.accent }]} />
                    </View>
                    <Text style={styles.weekCompareSub}>avg/day · {thisWeekLogs.length}d</Text>
                  </View>
                  <View style={styles.weekCompareDivider} />
                  <View style={styles.weekCompareCell}>
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
                    <WeekStatCell value={`${weekGoalDays}/7`} label="GOAL DAYS" color={colors.good} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={weekAvg ? weekAvg.toLocaleString() : '—'} label="AVG/DAY" color={colors.accent} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={weekBest ? weekBest.toLocaleString() : '—'} label="BEST DAY" color="#22d3ee" colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={weekTotal ? weekTotal.toLocaleString() : '—'} label="TOTAL" color={colors.text} colors={colors} />
                  </View>
                </View>
              </>
            )}

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>MONTHLY HEATMAP</Text>
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
                <Text style={styles.hmLegendLabel}>Less</Text>
                {['rgba(56,189,248,0.22)', 'rgba(34,211,238,0.42)', 'rgba(20,184,166,0.65)', 'rgba(52,211,153,0.88)'].map((c, i) => (
                  <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                ))}
                <Text style={styles.hmLegendLabel}>More</Text>
              </View>
              <StepsHeatmap year={year} month={month} logsByDate={logsByDate} goal={defaultGoal} colors={colors} hasAccess={hasAccess} onLockedPress={() => heroExport.setShowPaywall(true)} />
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={heatmapExport.ref} title="Monthly Heatmap" subtitle={`${MONTH_NAMES[month]} ${year}`} colors={colors} width={340}>
                <StepsHeatmap year={year} month={month} logsByDate={logsByDate} goal={defaultGoal} colors={colors} hasAccess={true} cardWidth={258} />
              </ExportCardTemplate>
            </View>

            {/* ── Steps Trend ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>STEPS - TREND</Text>
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
                      <Text style={[styles.segmentText, trendRangeDays === d && styles.segmentTextActive]}>{d === 0 ? 'ALL' : `${d}D`}{d !== 30 && !hasAccess ? ' 🔒' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#67e8f9' }]} /><Text style={styles.legendLabel}>Daily</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} /><Text style={styles.legendLabel}>7D Avg</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#c4b5fd' }]} /><Text style={styles.legendLabel}>{trendRangeDays === 0 ? 'All' : `${trendRangeDays}D`} Avg</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#34d399' }]} /><Text style={styles.legendLabel}>Goal</Text></View>
              </View>
              <StepsTrendChart data={trendData} goal={defaultGoal} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={styles.weekStatsRow}>
                  <WeekStatCell value={trendStats.avgPerDay.toLocaleString()} label="AVG/DAY" color={colors.accent} colors={colors} />
                  <View style={styles.weekStatDivider} />
                  <WeekStatCell value={`${trendStats.goalDaysHit}/${trendStats.totalDays}`} label="GOAL DAYS" color={colors.good} colors={colors} />
                  <View style={styles.weekStatDivider} />
                  <WeekStatCell value={trendStats.bestDay.toLocaleString()} label="BEST DAY" color="#22d3ee" colors={colors} />
                  <View style={styles.weekStatDivider} />
                  <WeekStatCell value={trendStats.totalSteps.toLocaleString()} label="TOTAL" color={colors.text} colors={colors} />
                </View>
              )}
            </View>

            {/* ── Analysis & Insights (Pro) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>ANALYSIS & INSIGHTS</Text>
                {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
              </View>
              {hasAccess ? (
                <>
                  <View style={styles.weekStatsRow}>
                    <WeekStatCell value={String(streaks.longest)} label="BEST STREAK" color="#f59e0b" colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={consistency8wk != null ? `${consistency8wk}%` : '—'} label="8WK CONSISTENCY" color={colors.good} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value={busiestDow ? busiestDow.label : '—'} label="BUSIEST DAY" color="#22d3ee" colors={colors} />
                  </View>
                  <View style={{ marginTop: 12, gap: 8 }}>
                    {goalSuggestion && (
                      <View style={styles.tipRow}>
                        <Text style={styles.tipEmoji}>📈</Text>
                        <Text style={styles.tipText}>You're averaging {goalSuggestion.avg.toLocaleString()} steps/day and hitting your goal {goalSuggestion.hitRate}% of the time — consider raising your goal to {goalSuggestion.suggested.toLocaleString()}.</Text>
                      </View>
                    )}
                    {sleepCorrelation && sleepCorrelation.diff > 200 && (
                      <View style={styles.tipRow}>
                        <Text style={styles.tipEmoji}>😴</Text>
                        <Text style={styles.tipText}>After nights with under 6h sleep, you average {sleepCorrelation.diff.toLocaleString()} fewer steps ({sleepCorrelation.avgLow.toLocaleString()} vs {sleepCorrelation.avgNormal.toLocaleString()}).</Text>
                      </View>
                    )}
                    {milestone.best && (
                      <View style={styles.tipRow}>
                        <Text style={styles.tipEmoji}>🌍</Text>
                        <Text style={styles.tipText}>You've walked the distance of {milestone.best.name} ({Math.round(milestone.totalKm).toLocaleString()} km lifetime).</Text>
                      </View>
                    )}
                    {!goalSuggestion && !sleepCorrelation && !milestone.best && (
                      <Text style={styles.emptyText}>Log a few more days to unlock personalized insights.</Text>
                    )}
                  </View>
                </>
              ) : (
                <TouchableOpacity onPress={() => setShowInsightsPaywall(true)}>
                  <View style={styles.weekStatsRow}>
                    <WeekStatCell value="••" label="BEST STREAK" color={colors.textDim} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value="••%" label="8WK CONSISTENCY" color={colors.textDim} colors={colors} />
                    <View style={styles.weekStatDivider} />
                    <WeekStatCell value="••" label="BUSIEST DAY" color={colors.textDim} colors={colors} />
                  </View>
                  <Text style={[styles.emptyText, { paddingTop: 12, paddingBottom: 0 }]}>Unlock streak history, sleep correlation & adaptive goal tips with Pro.</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Day-of-Week Average (Pro) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>AVG STEPS BY DAY OF WEEK</Text>
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
                  <Text style={styles.emptyText}>Unlock weekday patterns with Pro.</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Activity Breakdown (Pro) ── */}
            {actBreakdown.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle}>ACTIVITY BREAKDOWN</Text>
                  {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
                </View>
                {hasAccess ? (
                  <View style={{ gap: 10 }}>
                    {actBreakdown.map(a => (
                      <View key={a.key}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={styles.actBreakdownLabel}>{a.icon} {a.label} · {a.count}x</Text>
                          <Text style={styles.actBreakdownVal}>{a.steps.toLocaleString()} steps · {a.km.toFixed(1)}km · {a.cal}cal</Text>
                        </View>
                        <View style={styles.weekCompareBarTrack}>
                          <View style={[styles.weekCompareBarFill, { width: `${a.pct}%`, backgroundColor: colors.accent }]} />
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setShowInsightsPaywall(true)}>
                    <Text style={styles.emptyText}>Unlock activity-type breakdown with Pro.</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Daily Log ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>DAILY LOG</Text>
              {allMonthSorted.length === 0 && <Text style={styles.emptyText}>No step entries for this month.</Text>}
              {groupByWeek(allMonthSorted, l => l.logged_at).map(week => (
                <View key={week.key} style={styles.weekGroupBox}>
                  {week.items.map((log, i) => (
                    <View key={log.id} style={[styles.logRowWrap, i === week.items.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={styles.logRow}>
                        <Text style={styles.logDate}>{fmtDateShort(log.logged_at)}</Text>
                        <Text style={styles.logActEmoji}>{ACT_ICON[log.activity_type] || ACT_ICON.walk}</Text>
                        <DailyLogBar steps={log.steps} goal={log.goal ?? defaultGoal} barMax={allTimeMaxSteps} colors={colors} />
                        <Text style={[styles.logSteps, { color: log.steps >= (log.goal ?? defaultGoal) ? colors.good : colors.warn }]}>
                          {fmtK(log.steps)}
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
          <Text style={styles.sheetTitle}>LOG STEPS</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {yesterdayLog && (
          <TouchableOpacity style={styles.repeatYesterdayBtn} onPress={repeatYesterday}>
            <Ionicons name="repeat" size={13} color={colors.accent} />
            <Text style={styles.repeatYesterdayText}>Repeat yesterday ({fmtK(yesterdayLog.steps)} steps)</Text>
          </TouchableOpacity>
        )}

        <View style={styles.sheetFieldRow}>
          <View style={styles.sheetFieldCol}>
            <Text style={styles.sheetFieldLabel}>DATE</Text>
            <DatePickerField
              value={logDate}
              onChange={setLogDate}
              colors={colors}
              maxDate={localDateStr(new Date())}
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

      {/* Step Goal bottom sheet */}
      <BottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>SET DAILY GOAL</Text>
          <TouchableOpacity onPress={() => setShowGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{(parseInt(goalInput, 10) || defaultGoal).toLocaleString()}</Text>
        <Text style={styles.goalBigSub}>steps / day</Text>

        <TextInput
          style={styles.sheetInput}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={defaultGoal.toLocaleString()}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        <Text style={styles.sheetFieldLabel}>QUICK PRESETS</Text>
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
          {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Goal</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={heroExport.showPaywall} onClose={() => heroExport.setShowPaywall(false)} />
      <PaywallModal visible={showTrendPaywall} onClose={() => setShowTrendPaywall(false)} />
      <PaywallModal visible={showInsightsPaywall} onClose={() => setShowInsightsPaywall(false)} />
    </SafeAreaView>
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

  goalPill: { borderWidth: 1, borderColor: colors.accent, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  goalPillText: { fontSize: 10, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.mono },

  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: colors.textMuted },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  logRowWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logDate: { width: 76, fontSize: 10, color: colors.text, fontFamily: fontFamily.bodyMedium },
  logActEmoji: { fontSize: 13, width: 18, textAlign: 'center' },
  logNote: { fontSize: typography.xs, color: colors.textMuted, paddingLeft: 70, paddingTop: 4 },
  logSteps: { fontSize: 12, fontWeight: weight.bold, minWidth: 54, textAlign: 'right', fontFamily: fontFamily.monoBold },
  logDelBtn: { padding: 3 },
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

  repeatYesterdayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.accent + '14', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.accent + '44', marginBottom: 16,
  },
  repeatYesterdayText: { fontSize: 11, color: colors.accent, fontWeight: weight.bold },

  tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tipEmoji: { fontSize: 14 },
  tipText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15 },

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
