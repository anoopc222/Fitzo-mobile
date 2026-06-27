import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
  Modal, KeyboardAvoidingView, Platform, Dimensions, findNodeHandle, UIManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Line, Circle, Path, Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import MonthYearPicker from '../components/ui/MonthYearPicker';
import DatePickerField from '../components/ui/DatePickerField';
import Sparkline from '../components/Sparkline';
import BodyHeatmap from '../components/BodyHeatmap';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import PaywallModal from '../components/ui/PaywallModal';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';
import { useGatedExport } from '../hooks/useGatedExport';
import { useExportCard } from '../hooks/useExportCard';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { syncConditionalReminder } from '../lib/notifications';

// ─── Data Layer ───────────────────────────────────────────────────────────────
async function fetchSessions(userId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`
      id, date, notes, total_volume, duration_min, calories_burned,
      workout_exercises (
        id, exercise_name, order_index, group_id,
        sets ( id, set_number, weight_kg, reps, rpe, duration_min, distance_km, avg_rpm, speed_kmh, incline_pct, calories )
      )
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(150);
  if (error) throw error;
  return data ?? [];
}

async function fetchWorkoutGoal(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('workout_weekly_goal')
    .eq('id', userId)
    .single();
  return data?.workout_weekly_goal ?? 4;
}

async function updateWorkoutGoal(userId, goal) {
  const { error } = await supabase
    .from('profiles')
    .update({ workout_weekly_goal: goal })
    .eq('id', userId);
  if (error) throw error;
}

async function fetchTemplates(userId) {
  const { data, error } = await supabase
    .from('workout_templates')
    .select('id, name, exercises, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function saveTemplate(userId, name, exercises) {
  const clean = (exercises ?? []).map(ex => ({
    name: ex.name,
    sets: (ex.sets ?? []).map(s => ({ weight_kg: s.weight_kg, reps: s.reps })),
  })).filter(ex => ex.name?.trim());
  const { error } = await supabase
    .from('workout_templates')
    .insert({ user_id: userId, name: name?.trim() || 'Workout', exercises: clean });
  if (error) throw error;
}

// Repeats a template's exercises (names + planned weight/reps) for N future weekly sessions
async function repeatTemplateForWeeks(userId, template, weeks, startDate) {
  const exs = (template.exercises ?? []).map(ex => ({
    name: ex.name,
    sets: (ex.sets ?? []).length ? ex.sets : [{ weight_kg: '', reps: '' }],
  }));
  for (let w = 1; w <= weeks; w++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + w * 7);
    await saveSession(userId, {
      sessionId: null,
      date: localDateStr(d),
      name: template.name,
      exercises: exs,
    });
  }
}

async function saveSession(userId, { sessionId, date, name, exercises, duration_min }) {
  let sid = sessionId;
  const durPatch = duration_min != null ? { duration_min } : {};
  if (!sid) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: userId, date, notes: name || 'Workout', ...durPatch })
      .select().single();
    if (error) throw error;
    sid = data.id;
  } else {
    const { error } = await supabase
      .from('workout_sessions')
      .update({ date, notes: name || 'Workout', ...durPatch })
      .eq('id', sid);
    if (error) throw error;
  }

  // Delete old exercises + sets
  const { data: existingEx } = await supabase
    .from('workout_exercises').select('id').eq('session_id', sid);
  const exIds = (existingEx ?? []).map(e => e.id);
  if (exIds.length > 0) {
    await supabase.from('sets').delete().in('exercise_id', exIds);
    await supabase.from('workout_exercises').delete().eq('session_id', sid);
  }

  // Insert new exercises + sets
  let totalVol = 0;
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    if (!ex.name.trim()) continue;
    const { data: newEx, error: exErr } = await supabase
      .from('workout_exercises')
      .insert({ session_id: sid, exercise_name: ex.name.trim(), order_index: i, group_id: ex.group_id ?? null })
      .select().single();
    if (exErr) throw exErr;

    for (let j = 0; j < (ex.sets ?? []).length; j++) {
      const s = ex.sets[j];
      const num = (v) => {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };
      const wVal = num(s.weight_kg);
      const rVal = s.reps === '' || s.reps == null ? null : (isNaN(parseInt(s.reps, 10)) ? null : parseInt(s.reps, 10));
      const rpeVal = num(s.rpe);
      const durVal = num(s.duration_min);
      const distVal = num(s.distance_km);
      const rpmVal = num(s.avg_rpm);
      const speedVal = num(s.speed_kmh);
      const inclineVal = num(s.incline_pct);
      const calVal = num(s.calories) ?? (durVal != null
        ? calcCardioEntryKcal(ex.name, {
            duration_min: durVal, speed_kmh: speedVal, incline_pct: inclineVal, avg_rpm: rpmVal,
          }) || null
        : null);
      const hasAny = [wVal, rVal, rpeVal, durVal, distVal, rpmVal, speedVal, inclineVal, calVal]
        .some(v => v !== null);
      if (hasAny) {
        if (wVal && rVal) totalVol += wVal * rVal;
        await supabase.from('sets').insert({
          exercise_id: newEx.id, set_number: j + 1,
          weight_kg: wVal, reps: rVal, rpe: rpeVal,
          duration_min: durVal, distance_km: distVal, avg_rpm: rpmVal,
          speed_kmh: speedVal, incline_pct: inclineVal, calories: calVal,
        });
      }
    }
  }
  await supabase.from('workout_sessions')
    .update({ total_volume: Math.round(totalVol) }).eq('id', sid);
}

async function deleteFullSession(sessionId) {
  const { data: exs } = await supabase
    .from('workout_exercises').select('id').eq('session_id', sessionId);
  const exIds = (exs ?? []).map(e => e.id);
  if (exIds.length > 0) {
    await supabase.from('sets').delete().in('exercise_id', exIds);
    await supabase.from('workout_exercises').delete().eq('session_id', sessionId);
  }
  const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const DEFAULT_WEEKLY_GOAL = 4;
const DOW_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// session "type" — used for cardio/rest-specific UI branches
function getSessionType(name) {
  if (!name) return 'gym';
  const n = name.toLowerCase().trim();
  if (n === 'rest' || n === 'rest day' || n.startsWith('rest')) return 'rest';
  if (n.includes('cardio') || n.includes('run') || n.includes('treadmill') || n.includes('cycling') ||
      n.includes('hiit') || n.includes('swim') || n.includes('stair') || n.includes('air bike') ||
      n.includes('elliptical') || n.includes('row machine'))
    return 'cardio';
  return 'gym';
}

// Cardio activity types — mirrors CARDIO_TYPES in the web app (addCardioActivity)
const CARDIO_TYPES = [
  { label: '🚶 Incline Walk',   val: 'Incline Walk' },
  { label: '🚴 Air Bike',       val: 'Air Bike' },
  { label: '🏃 Treadmill Run',  val: 'Treadmill Run' },
  { label: '🪜 Stairmaster',    val: 'Stairmaster' },
  { label: '🚣 Rowing',         val: 'Rowing' },
  { label: '🔄 Elliptical',     val: 'Elliptical' },
  { label: '🏊 Swimming',       val: 'Swimming' },
  { label: '🏃 Other',          val: 'Other' },
];

function getCardioIcon(type) {
  const t = CARDIO_TYPES.find(c => c.val === type);
  return t ? t.label.split(' ')[0] : '🏃';
}

// MET-based estimate, ~78kg body weight assumed — ported from calcCardioKcal() in the web app
function calcCardioKcal(type, dur, speed, incline, rpm) {
  const bw = 78;
  dur = parseFloat(dur) || 0;
  speed = parseFloat(speed) || 0;
  incline = parseFloat(incline) || 0;
  rpm = parseFloat(rpm) || 0;
  if (!dur) return 0;
  let met;
  if (type === 'Incline Walk') {
    met = 2.5 + (speed > 0 ? speed * 0.9 : 3) + incline * 0.18;
  } else if (type === 'Air Bike') {
    met = rpm > 0 ? Math.min(14, 8 + rpm / 30) : 10;
  } else if (type === 'Treadmill Run') {
    met = speed > 0 ? Math.min(18, speed * 1.2 + 1) : 8;
  } else if (type === 'Stairmaster') {
    met = 9;
  } else if (type === 'Rowing') {
    met = 7;
  } else if (type === 'Elliptical') {
    met = 6;
  } else if (type === 'Swimming') {
    met = 8;
  } else {
    met = 5;
  }
  return Math.round(met * bw * dur / 60);
}

// Per-type field mapping onto the sets table's dedicated cardio columns
function getCardioFieldDefs(type) {
  if (type === 'Incline Walk')
    return { secondary: { key: 'speed_kmh', label: 'SPEED (KM/H)', placeholder: '3.5' },
              tertiary:  { key: 'incline_pct', label: 'INCLINE (%)', placeholder: '12' } };
  if (type === 'Air Bike')
    return { secondary: { key: 'distance_km', label: 'DISTANCE (KM)', placeholder: 'optional' },
              tertiary:  { key: 'avg_rpm', label: 'AVG RPM', placeholder: 'optional' } };
  if (type === 'Treadmill Run')
    return { secondary: { key: 'distance_km', label: 'DISTANCE (KM)', placeholder: '5' },
              tertiary:  { key: 'speed_kmh', label: 'SPEED (KM/H)', placeholder: '10' } };
  return { secondary: null, tertiary: null };
}

function calcCardioEntryKcal(type, entry) {
  const dur = entry.duration_min;
  const speed = entry.speed_kmh ?? 0;
  const incline = entry.incline_pct ?? 0;
  const rpm = entry.avg_rpm ?? 0;
  return calcCardioKcal(type, dur, speed, incline, rpm);
}

// Returns { icon, cardBg, cardBorder, iconBg, titleColor }
function getWorkoutStyle(name, colors) {
  const type = getSessionType(name);
  const n = (name ?? '').toLowerCase().trim();

  if (type === 'rest')
    return { icon: '😴', cardBg: colors.good + '14', cardBorder: colors.good + '55', iconBg: colors.good + '22', titleColor: colors.good };

  if (type === 'cardio')
    return { icon: '🏃', cardBg: colors.blue + '14', cardBorder: colors.blue + '55', iconBg: colors.blue + '22', titleColor: colors.blue };

  if (n.includes('leg') || n.includes('squat') || n.includes('glute') || n.includes('hamstring') || n.includes('quad'))
    return { icon: '🦵', cardBg: colors.card, cardBorder: colors.accent + '40', iconBg: colors.accent + '1f', titleColor: colors.text };

  if (n.includes('chest') || n.includes('bench') || n.includes('push'))
    return { icon: '🫁', cardBg: colors.card, cardBorder: colors.accent2 + '40', iconBg: colors.accent2 + '1f', titleColor: colors.text };

  if (n.includes('back') || n.includes('pull') || n.includes('deadlift') || n.includes('row'))
    return { icon: '🦾', cardBg: colors.card, cardBorder: colors.blue + '40', iconBg: colors.blue + '1f', titleColor: colors.text };

  if (n.includes('shoulder') || n.includes('delt') || n.includes('overhead') || n.includes('press'))
    return { icon: '💪', cardBg: colors.card, cardBorder: colors.purple + '40', iconBg: colors.purple + '1f', titleColor: colors.text };

  if (n.includes('arm') || n.includes('bicep') || n.includes('tricep') || n.includes('curl'))
    return { icon: '💪', cardBg: colors.card, cardBorder: colors.purple + '40', iconBg: colors.purple + '1f', titleColor: colors.text };

  if (n.includes('full') || n.includes('body'))
    return { icon: '🏋️', cardBg: colors.card, cardBorder: colors.good + '40', iconBg: colors.good + '1f', titleColor: colors.text };

  return { icon: '🏋️', cardBg: colors.card, cardBorder: colors.border, iconBg: colors.dim, titleColor: colors.text };
}

function calcSessionVol(session) {
  return Math.round(
    (session.workout_exercises ?? []).reduce((s, ex) =>
      s + (ex.sets ?? []).reduce((ss, st) => ss + (st.weight_kg ?? 0) * (st.reps ?? 0), 0), 0)
  );
}

function getBestSetIndex(sets) {
  if (!sets || sets.length === 0) return -1;
  let best = -1, bestV = -1;
  sets.forEach((s, i) => {
    const v = (s.weight_kg ?? 0) * (s.reps ?? 0);
    if (v > bestV) { bestV = v; best = i; }
  });
  return best;
}

function computePBMap(sessions) {
  const bestByEx = {};
  const pbMap = {};
  const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const session of sorted) {
    const pbs = new Set();
    for (const ex of (session.workout_exercises ?? [])) {
      const key = (ex.exercise_name ?? '').toLowerCase();
      const best = (ex.sets ?? []).reduce((b, s) => Math.max(b, s.weight_kg ?? 0), 0);
      if (best > 0 && best > (bestByEx[key] ?? 0)) { pbs.add(key); bestByEx[key] = best; }
    }
    pbMap[session.id] = pbs;
  }
  return pbMap;
}

function getVolumeDelta(session, allSessions) {
  const name = (session.notes ?? '').toLowerCase().trim();
  if (!name) return null;
  const curVol = session.total_volume ?? calcSessionVol(session);
  const prev = allSessions.find(s =>
    s.id !== session.id &&
    (s.notes ?? '').toLowerCase().trim() === name &&
    new Date(s.date) < new Date(session.date)
  );
  if (!prev) return null;
  const prevVol = prev.total_volume ?? calcSessionVol(prev);
  const delta = Math.round(curVol - prevVol);
  const pct = prevVol > 0 ? Math.abs(Math.round((delta / prevVol) * 100)) : 0;
  return { delta, pct, prevDate: prev.date };
}

function fmtDate(d) {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}
function fmtDateShort(d) {
  const dt = new Date(d);
  return `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]}`;
}

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
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

// ─── Volume Trend Chart (Daily + 7-entry Avg) — mirrors StepsTrendChart ───
function VolumeTrendChart({ data, colors, width }) {
  const { t } = useTranslation();
  const H = 170;
  const P = { t: 18, r: 8, b: 22, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('workout.notEnoughDataYet')}</Text>
      </View>
    );
  }
  const rawVals = data.map(e => e.vol);
  const avgVals = data.map((_, i) => {
    const win = data.slice(Math.max(0, i - 6), i + 1);
    return Math.round(win.reduce((s, x) => s + x.vol, 0) / win.length);
  });
  const allVals = [...rawVals, ...avgVals];
  const minV = Math.min(...allVals, 0) * 0.96;
  const maxV = Math.max(...allVals, 1) * 1.06;
  const range = maxV - minV || 1;
  const n = data.length;
  const xs = pw / Math.max(n - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + i * xs;
  const rawPts = rawVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const rawLine = smoothPath(rawPts);
  const avgPts = avgVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const avgLine = smoothPath(avgPts);
  const lastAvg = avgPts[avgPts.length - 1];
  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="workoutTrendFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.accent} stopOpacity="0.22" />
          <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {[0, 1, 2, 3].map(i => {
        const y = P.t + (ph / 3) * i;
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke={colors.border} strokeWidth={1} />;
      })}
      {avgPts.length > 1 && (
        <Path d={`${avgLine} L ${avgPts[avgPts.length - 1].x.toFixed(1)},${H - P.b} L ${avgPts[0].x.toFixed(1)},${H - P.b} Z`} fill="url(#workoutTrendFill)" />
      )}
      {rawPts.length > 1 && (
        <Path d={rawLine} fill="none" stroke={colors.purple} strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {avgPts.length > 1 && (
        <Path d={avgLine} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {rawPts.map((p, i) => (<Circle key={i} cx={p.x} cy={p.y} r={2} fill={colors.purple} fillOpacity={0.6} />))}
      {lastAvg && <Circle cx={lastAvg.x} cy={lastAvg.y} r={3.5} fill={colors.accent} />}
    </Svg>
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

// ─── Weekly Bar Chart (volume per day, colored by session type) ───────────
function WorkoutWeekBarChart({ days, colors, width }) {
  const H = 140;
  const padTop = 22, padBot = 30;
  const chartH = H - padTop - padBot;
  const barGap = 8;
  const barW = (width - barGap * 8) / 7;
  const TYPE_COLOR = { gym: colors.accent, cardio: colors.blue, rest: colors.good };

  const vols = days.filter(d => !d.isFuture).map(d => d.vol);
  const maxVal = Math.max(...vols, 1) * 1.15;
  const toY = v => padTop + chartH - (v / maxVal) * chartH;

  return (
    <Svg width={width} height={H}>
      {days.map((day, i) => {
        const x = barGap + i * (barW + barGap);
        const isRest = day.type === 'rest';
        const barH = isRest ? Math.max(3, chartH * 0.06) : (day.vol > 0 ? Math.max(3, (day.vol / maxVal) * chartH) : 0);
        const barY = padTop + chartH - barH;
        const color = TYPE_COLOR[day.type] ?? colors.dim;
        return (
          <React.Fragment key={day.date}>
            {!day.isFuture && (day.vol > 0 || isRest) ? (
              <Rect x={x} y={barY} width={barW} height={barH} rx={5} fill={color} fillOpacity={0.85} />
            ) : (
              <Rect x={x} y={padTop} width={barW} height={chartH} rx={5} fill={colors.dim} />
            )}
            {day.isToday && (
              <Rect x={x - 1} y={padTop - 2} width={barW + 2} height={chartH + 2} rx={5} fill="none" stroke={colors.accent} strokeOpacity={0.6} strokeWidth={1.5} />
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

const HM_TYPE_ICON = { gym: 'barbell-outline', cardio: 'bicycle-outline', rest: 'moon-outline' };

function WorkoutHeatmap({ year, month, sessionsByDate, colors, hasAccess = true, onLockedPress, onDayPress }) {
  const SCREEN_W = Dimensions.get('window').width;
  const cellSize = Math.floor((SCREEN_W - 32 - 48 - 12) / 7);
  const firstDay = new Date(year, month, 1).getDay();
  let startDow = firstDay - 1; if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());
  const cutoffStr = localDateStr(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));
  const TYPE_COLOR = { gym: colors.accent, cardio: colors.blue, rest: colors.good };

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ key: `e${i}`, empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const info = sessionsByDate[ds];
    const count = info?.count ?? 0;
    const type = info?.type ?? null;
    let lvl = 0;
    if (type === 'rest') lvl = 1;
    else if (count === 1) lvl = 2;
    else if (count === 2) lvl = 3;
    else if (count >= 3) lvl = 4;
    const locked = !hasAccess && ds < cutoffStr;
    cells.push({ key: ds, day: d, count, type, lvl, isToday: ds === todayStr, locked });
  }

  const ALPHA = { 0: 0, 1: 0.45, 2: 0.4, 3: 0.65, 4: 0.88 };

  return (
    <View>
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {DOW_LABELS.map(d => (
          <View key={d} style={{ width: cellSize, marginHorizontal: 2, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textMuted, fontFamily: fontFamily.mono }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
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
          const typeColor = cell.type ? TYPE_COLOR[cell.type] : colors.dim;
          const bg = cell.lvl === 0 ? colors.dim : `${typeColor}${Math.round(ALPHA[cell.lvl] * 255).toString(16).padStart(2, '0')}`;
          return (
            <TouchableOpacity
              key={cell.key}
              activeOpacity={onDayPress ? 0.7 : 1}
              onPress={onDayPress && cell.count > 0 ? () => onDayPress(cell.key) : undefined}
              style={[
                { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
                { width: cellSize, height: cellSize, backgroundColor: bg },
                cell.isToday && { borderWidth: 2, borderColor: '#f59e0b' },
              ]}
            >
              {cell.type && (
                <Ionicons
                  name={HM_TYPE_ICON[cell.type]}
                  size={11}
                  color={cell.lvl === 0 ? colors.textDim : colors.text}
                  style={{ opacity: cell.lvl === 0 ? 0.5 : 0.9 }}
                />
              )}
              <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: fontFamily.mono, color: cell.lvl === 0 ? colors.textDim : colors.text, marginTop: 1 }}>
                {cell.day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const MUSCLE_KW = [
  { keys: ['incline', 'upper chest'], m: ['Upper Chest', 'Front Delts'] },
  { keys: ['bench press', 'chest press'], m: ['Chest', 'Front Delts', 'Triceps'] },
  { keys: ['pec fly', 'cable fly', 'chest fly', ' fly', 'pec deck'], m: ['Chest'] },
  { keys: ['dip'], m: ['Chest', 'Triceps'] },
  { keys: ['lat pull', 'pull down', 'pulldown', 'pull-down'], m: ['Lats', 'Biceps'] },
  { keys: ['seated row', 'cable row', 'chest supported row', 'bent over row'], m: ['Mid Back', 'Rhomboids', 'Biceps'] },
  { keys: ['row'], m: ['Mid Back', 'Rhomboids'] },
  { keys: ['deadlift'], m: ['Lower Back', 'Glutes', 'Hamstrings'] },
  { keys: ['shoulder press', 'overhead press', 'ohp', 'military press'], m: ['Shoulders', 'Triceps'] },
  { keys: ['lateral raise', 'side raise'], m: ['Side Delts'] },
  { keys: ['front raise'], m: ['Front Delts'] },
  { keys: ['leg press'], m: ['Quads', 'Glutes'] },
  { keys: ['leg extension'], m: ['Quads'] },
  { keys: ['leg curl', 'hamstring curl', 'lying curl'], m: ['Hamstrings'] },
  { keys: ['squat'], m: ['Quads', 'Glutes', 'Hamstrings'] },
  { keys: ['calf raise', 'calf press'], m: ['Calves'] },
  { keys: ['hip thrust', 'glute bridge'], m: ['Glutes'] },
  { keys: ['bicep curl', 'barbell curl', 'dumbbell curl', ' curl'], m: ['Biceps'] },
  { keys: ['tricep', 'skull crusher', 'pushdown', 'extension'], m: ['Triceps'] },
  { keys: ['stairmaster', 'air bike', 'treadmill', 'cycling', 'running', 'elliptical'], m: ['Cardiovascular'] },
];

const STANDARD_EXERCISE_NAMES = [
  'Bench Press', 'Incline Chest Press Machine', 'Pec Fly', 'Shoulder Press', 'Overhead Press',
  'Lat Pulldown', 'Pull Up', 'Seated Row', 'Chest Supported Row', 'Cable Row', 'Deadlift',
  'Squat', 'Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raise', 'Bicep Curl', 'Hammer Curl',
  'Preacher Curl', 'Tricep Rope Pushdown', 'Face Pull', 'Dumbbell Shrugs',
];

// Historical exercise names first, then the standard list, deduped — mirrors qlGetExNames() on web
function getExerciseNamePool(allSessions) {
  const seen = new Set();
  const names = [];
  for (const s of allSessions ?? []) {
    for (const ex of s.workout_exercises ?? []) {
      const n = ex.exercise_name;
      if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); names.push(n); }
    }
  }
  for (const n of STANDARD_EXERCISE_NAMES) {
    if (!seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); names.push(n); }
  }
  return names;
}

function getExerciseMuscles(exerciseName) {
  const name = (exerciseName ?? '').toLowerCase();
  for (const { keys, m } of MUSCLE_KW) {
    if (keys.some(k => name.includes(k))) return m.slice(0, 3);
  }
  return [];
}

function getMuscleGroups(exercises) {
  const groups = new Set();
  for (const ex of (exercises ?? [])) {
    getExerciseMuscles(ex.exercise_name).forEach(g => groups.add(g));
  }
  return [...groups].slice(0, 7);
}

const PLATE_KG = [25, 20, 15, 10, 5, 2.5, 1.25];
function calcPlates(totalKg, barKg = 20) {
  let perSide = (totalKg - barKg) / 2;
  if (!totalKg || perSide <= 0) return [];
  const plates = [];
  for (const p of PLATE_KG) {
    while (perSide >= p - 0.001) { plates.push(p); perSide -= p; }
  }
  return plates;
}

function getPrevSetSummary(allSessions, exerciseName, beforeDate) {
  const name = (exerciseName ?? '').trim().toLowerCase();
  if (!name) return null;
  const candidates = (allSessions ?? [])
    .filter(s => !beforeDate || s.date < beforeDate)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const sess of candidates) {
    const ex = (sess.workout_exercises ?? []).find(
      e => (e.exercise_name ?? '').trim().toLowerCase() === name
    );
    if (ex && (ex.sets ?? []).length) {
      const best = ex.sets.slice().sort(
        (a, b) => (b.weight_kg ?? 0) * (b.reps ?? 0) - (a.weight_kg ?? 0) * (a.reps ?? 0)
      )[0];
      if (best.weight_kg) return { weight: best.weight_kg, reps: best.reps, rpe: best.rpe, date: sess.date };
    }
  }
  return null;
}

function suggestProgressiveOverload(prev) {
  if (!prev || !prev.weight) return null;
  const rpe = parseFloat(prev.rpe);
  if (!isNaN(rpe) && rpe >= 9) {
    return { weight: prev.weight, reps: prev.reps, note: 'last RPE was high — hold steady' };
  }
  if ((prev.reps ?? 0) >= 10) {
    return { weight: Math.round((prev.weight + 5) / 5) * 5, reps: Math.max(6, prev.reps - 2), note: 'increase weight' };
  }
  return { weight: prev.weight, reps: (prev.reps ?? 0) + 1, note: 'add a rep' };
}

const WARMUP_PCTS = [0.4, 0.6, 0.8];
function getWarmupSets(topWeightKg) {
  if (!topWeightKg) return [];
  return WARMUP_PCTS.map(p => Math.round((topWeightKg * p) / 5) * 5);
}

const SUBSTITUTE_MAP = {
  'bench press': ['Dumbbell Bench Press', 'Push-up', 'Machine Chest Press'],
  'squat': ['Goblet Squat', 'Leg Press', 'Hack Squat'],
  'deadlift': ['Romanian Deadlift', 'Trap Bar Deadlift', 'Hip Thrust'],
  'overhead press': ['Dumbbell Shoulder Press', 'Arnold Press', 'Machine Shoulder Press'],
  'pull-up': ['Lat Pulldown', 'Assisted Pull-up', 'Band Pull-up'],
  'barbell row': ['Dumbbell Row', 'Seated Cable Row', 'Chest-Supported Row'],
  'bicep curl': ['Hammer Curl', 'Cable Curl', 'Preacher Curl'],
  'leg press': ['Goblet Squat', 'Hack Squat', 'Bulgarian Split Squat'],
};
function getSubstitutes(exerciseName) {
  const name = (exerciseName ?? '').toLowerCase();
  for (const k of Object.keys(SUBSTITUTE_MAP)) {
    if (name.includes(k)) return SUBSTITUTE_MAP[k];
  }
  return [];
}

function detectDeload(sessions) {
  const gym = sessions
    .filter(s => getSessionType(s.notes) === 'gym')
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const rpeOf = (s) => {
    const all = (s.workout_exercises ?? [])
      .flatMap(e => e.sets ?? [])
      .map(x => parseFloat(x.rpe))
      .filter(v => !isNaN(v));
    if (!all.length) return null;
    return all.reduce((a, b) => a + b, 0) / all.length;
  };
  const recent = gym.slice(0, 3).map(rpeOf).filter(v => v != null);
  if (recent.length < 2) return null;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (avg >= 8.5) return { avg: avg.toFixed(1) };
  return null;
}

function getMuscleVolumeThisWeek(sessions) {
  const [start, end] = getWeekRange(new Date(), 0);
  const map = {};
  for (const s of sessions) {
    if (s.date < start || s.date > end) continue;
    for (const ex of s.workout_exercises ?? []) {
      const muscles = getExerciseMuscles(ex.exercise_name);
      if (!muscles.length) continue;
      const vol = (ex.sets ?? []).reduce((sum, st) => sum + (st.weight_kg ?? 0) * (st.reps ?? 0), 0);
      if (!vol) continue;
      muscles.forEach(m => { map[m] = (map[m] ?? 0) + vol / muscles.length; });
    }
  }
  return Object.entries(map).map(([m, v]) => ({ muscle: m, vol: Math.round(v) })).sort((a, b) => b.vol - a.vol).slice(0, 6);
}

// All-time best (weight, reps, volume) for an exercise, used for PR detection — same data source as getPrevSetSummary
function getAllTimeBest(allSessions, exerciseName, beforeDate) {
  const name = (exerciseName ?? '').trim().toLowerCase();
  if (!name) return null;
  let bestWeight = 0, bestReps = 0, bestVol = 0;
  for (const sess of allSessions ?? []) {
    if (beforeDate && sess.date >= beforeDate) continue;
    const ex = (sess.workout_exercises ?? []).find(e => (e.exercise_name ?? '').trim().toLowerCase() === name);
    if (!ex) continue;
    for (const st of ex.sets ?? []) {
      const w = st.weight_kg ?? 0, r = st.reps ?? 0;
      bestWeight = Math.max(bestWeight, w);
      bestReps = Math.max(bestReps, r);
      bestVol = Math.max(bestVol, w * r);
    }
  }
  return { bestWeight, bestReps, bestVol };
}

// Detects which kind of PR a just-logged set hits, vs all-time best — used for the inline PR banner
function detectSetPR(allSessions, exerciseName, weightKg, reps, beforeDate) {
  const w = parseFloat(weightKg), r = parseInt(reps, 10);
  if (!w || !r) return null;
  const best = getAllTimeBest(allSessions, exerciseName, beforeDate);
  if (!best) return null;
  const vol = w * r;
  if (w > best.bestWeight && best.bestWeight > 0) return { kind: 'weight', delta: Math.round((w - best.bestWeight) * 10) / 10 };
  if (r > best.bestReps && best.bestReps > 0) return { kind: 'reps', delta: r - best.bestReps };
  if (vol > best.bestVol && best.bestVol > 0) return { kind: 'volume', delta: Math.round(vol - best.bestVol) };
  return null;
}

// Most recent session matching the same type/day-name — source for "Copy last session"
function findLastSessionOfType(allSessions, name) {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return null;
  return (allSessions ?? [])
    .filter(s => (s.notes ?? '').trim().toLowerCase() === n)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

// Epley formula — used for the live per-set 1RM estimate
function estimate1RM(weightKg, reps) {
  const w = parseFloat(weightKg), r = parseInt(reps, 10);
  if (!w || !r) return null;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

// Top-set weight (heaviest set) per session for an exercise, oldest -> newest, last 8 sessions — feeds the strength trend Sparkline
function getExerciseTopSetTrend(allSessions, exerciseName) {
  const name = (exerciseName ?? '').trim().toLowerCase();
  if (!name) return [];
  const points = [];
  for (const sess of (allSessions ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const ex = (sess.workout_exercises ?? []).find(e => (e.exercise_name ?? '').trim().toLowerCase() === name);
    if (!ex) continue;
    const top = Math.max(0, ...(ex.sets ?? []).map(st => st.weight_kg ?? 0));
    if (top > 0) points.push(top);
  }
  return points.slice(-8);
}

// Consecutive-week streak of meeting workout_weekly_goal, walking back from the most recently completed week
function getWeeklyGoalStreak(sessions, weeklyGoal, today) {
  let current = 0, longest = 0, run = 0;
  for (let w = 1; w <= 52; w++) {
    const [monStr, sunStr] = getWeekRange(today, w);
    const count = sessions.filter(s => getSessionType(s.notes) !== 'rest' && s.date >= monStr && s.date <= sunStr).length;
    const met = count >= weeklyGoal;
    if (met) { run++; longest = Math.max(longest, run); if (w === current + 1) current = run; }
    else { run = 0; if (w === current + 1) { /* streak broken */ } }
    if (!met && current === w - 1) break;
  }
  return { current, longest };
}

// 3+ consecutive calendar days training the same muscle with no rest between — overtraining/imbalance alert
function detectOvertraining(sessions) {
  const byDate = {};
  for (const s of sessions) {
    if (getSessionType(s.notes) !== 'gym') continue;
    const muscles = new Set();
    for (const ex of s.workout_exercises ?? []) getExerciseMuscles(ex.exercise_name).forEach(m => muscles.add(m));
    byDate[s.date] = muscles;
  }
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return null;
  const lastDate = dates[dates.length - 1];
  let streak = 1;
  let hitMuscle = null;
  for (const m of byDate[lastDate]) {
    let run = 1;
    let d = new Date(lastDate + 'T00:00:00');
    for (let i = 1; i < 7; i++) {
      d.setDate(d.getDate() - 1);
      const ds = localDateStr(d);
      if (byDate[ds]?.has(m)) run++;
      else break;
    }
    if (run >= 3 && run > streak) { streak = run; hitMuscle = m; }
  }
  if (!hitMuscle) return null;
  return { muscle: hitMuscle, days: streak };
}

function suggestAutoReg(prevSetInSession) {
  const rpe = parseFloat(prevSetInSession?.rpe);
  const w = parseFloat(prevSetInSession?.weight_kg);
  if (isNaN(rpe) || isNaN(w) || !w) return null;
  if (rpe >= 9) return { weight: Math.round(w * 0.95 / 5) * 5, note: 'RPE was high last set — ease off' };
  if (rpe <= 6) return { weight: Math.round(w * 1.05 / 5) * 5, note: 'RPE was low last set — push more' };
  return null;
}

function generateDayList(sessions) {
  return sessions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(session => ({ type: 'session', session, date: session.date }));
}

function getRecentTypes(sessions) {
  const seen = new Set(); const result = [];
  for (const s of sessions) {
    const n = (s.notes ?? '').trim();
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); result.push(n); if (result.length >= 8) break; }
  }
  return result;
}

let _tid = 0;
function tid() { return `_t${++_tid}`; }
function blankSet() {
  return {
    _key: tid(), weight_kg: '', reps: '', rpe: '',
    duration_min: '', distance_km: '', avg_rpm: '', speed_kmh: '', incline_pct: '', calories: '',
  };
}
function blankEx() { return { _key: tid(), name: '', sets: [blankSet()] }; }

// ─── Session Detail Modal ─────────────────────────────────────────────────────
function SessionDetailModal({ session, pbMap, allSessions, visible, onClose, onEdit, onRepeat, onDelete }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dS = useMemo(() => createDS(colors), [colors]);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [historyEx, setHistoryEx] = useState(null);
  const sessionExport = useGatedExport();

  useEffect(() => {
    if (visible && session) {
      const allIds = new Set((session.workout_exercises ?? []).map(ex => ex.id));
      setExpandedIds(allIds);
    }
  }, [visible, session]);

  if (!session) return null;

  const ws = getWorkoutStyle(session.notes, colors);
  const sType = getSessionType(session.notes);
  const isRestDay = (session.notes ?? '').toLowerCase() === 'rest day';
  const isCardio = sType === 'cardio';
  const exercises = (session.workout_exercises ?? []).slice().sort((a, b) => a.order_index - b.order_index);
  const totalSets = exercises.reduce((s, ex) => s + (ex.sets?.length ?? 0), 0);
  const vol = session.total_volume ?? calcSessionVol(session);
  const totalMin = exercises.reduce((s, ex) =>
    s + (ex.sets ?? []).reduce((ss, st) => ss + (st.duration_min ?? 0), 0), 0);
  const cardioKcal = exercises.reduce((s, ex) =>
    s + (ex.sets ?? []).reduce((ss, st) => ss + calcCardioEntryKcal(ex.exercise_name, st), 0), 0);
  const kcal = session.calories_burned ?? (isCardio ? cardioKcal : 0) ?? 0;
  const pbSet = pbMap[session.id] ?? new Set();
  const muscleGroups = getMuscleGroups(exercises);
  const allExpanded = exercises.every(ex => expandedIds.has(ex.id));

  const toggleEx = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (allExpanded) setExpandedIds(new Set());
    else setExpandedIds(new Set(exercises.map(ex => ex.id)));
  };

  return (
    <>
    <BottomSheet visible={visible} onClose={onClose} style={dS.popup}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={dS.header}>
          <View style={[dS.typeIconBox, { backgroundColor: ws.iconBg, borderColor: ws.cardBorder }]}>
            <Text style={{ fontSize: 24 }}>{ws.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dS.headerName}>{session.notes || t('workout.workout')}</Text>
            <Text style={dS.headerDate}>{fmtDate(session.date)}</Text>
          </View>
          {!isRestDay && (
            <TouchableOpacity
              onPress={sessionExport.onExportPress}
              disabled={sessionExport.exporting}
              style={dS.closeBtn}
            >
              {sessionExport.exporting ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Ionicons name="share-outline" size={18} color={colors.textMuted} />
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={dS.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {isRestDay ? (
          <View style={dS.exScroll}>
            <View style={dS.restInfoRow}>
              <View style={dS.restInfoCell}>
                <Text style={{ fontSize: 18 }}>😴</Text>
                <Text style={dS.restInfoValue}>{t('workout.rest')}</Text>
                <Text style={dS.statLabel}>{t('workout.dayType')}</Text>
              </View>
              <View style={dS.restInfoDivider} />
              <View style={dS.restInfoCell}>
                <Text style={{ fontSize: 18 }}>💚</Text>
                <Text style={dS.restInfoValue}>{t('workout.recovery')}</Text>
                <Text style={dS.statLabel}>{t('workout.mode')}</Text>
              </View>
            </View>

            <View style={dS.restCallout}>
              <Text style={{ fontSize: 40 }}>😴</Text>
              <Text style={dS.restCalloutTitle}>{t('workout.recoveryDay')}</Text>
              <Text style={dS.restCalloutSub}>{t('workout.musclesGrowDuringRest')}</Text>
            </View>

            <View style={dS.actionRow}>
              <TouchableOpacity style={dS.editBtn} onPress={onEdit}>
                <Text style={{ fontSize: 14 }}>✏️</Text>
                <Text style={dS.editBtnText}>{t('common.edit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={dS.deleteBtn} onPress={onDelete}>
                <Text style={{ fontSize: 14 }}>🗑️</Text>
                <Text style={dS.deleteBtnText}>{t('common.delete')}</Text>
              </TouchableOpacity>
            </View>
            <View style={{ height: 12 }} />
          </View>
        ) : (
        <>
        {/* Stats row */}
        <View style={dS.statsRow}>
          {(isCardio ? [
            { label: t('workout.activities'), icon: '🏃', value: exercises.length },
            { label: t('workout.minutes'),    icon: '⏱',  value: totalMin > 0 ? totalMin : '—' },
            { label: t('workout.kcal'),       icon: '🔥', value: kcal > 0 ? kcal : '—' },
          ] : [
            { label: t('workout.exr'),    icon: '🏋️', value: exercises.length },
            { label: t('workout.sets'),   icon: '🔄', value: totalSets },
            { label: t('workout.kgVol'), icon: '⚡', value: vol > 0 ? vol.toLocaleString() : '—' },
            { label: t('workout.kcal'),   icon: '🔥', value: kcal > 0 ? kcal : '—' },
          ]).map(({ label, icon, value }, i, arr) => (
            <View key={label} style={[dS.statCell, i < arr.length - 1 && dS.statCellBorder]}>
              <Text style={{ fontSize: 18 }}>{icon}</Text>
              <Text style={dS.statValue}>{value}</Text>
              <Text style={dS.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Session muscle tags */}
        {muscleGroups.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={[{ marginTop: 10 }, dS.tagScroll]} contentContainerStyle={dS.tagRow}>
            {muscleGroups.map(m => (
              <View key={m} style={dS.muscleTag}>
                <Text style={dS.muscleTagText}>{m}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
          <ExportCardTemplate ref={sessionExport.ref} title={session.notes || t('workout.workout')} subtitle={fmtDate(session.date)} colors={colors} width={340}>
            <View style={dS.statsRow}>
              {(isCardio ? [
                { label: t('workout.activities'), icon: '🏃', value: exercises.length },
                { label: t('workout.minutes'),    icon: '⏱',  value: totalMin > 0 ? totalMin : '—' },
                { label: t('workout.kcal'),       icon: '🔥', value: kcal > 0 ? kcal : '—' },
              ] : [
                { label: t('workout.exr'),    icon: '🏋️', value: exercises.length },
                { label: t('workout.sets'),   icon: '🔄', value: totalSets },
                { label: t('workout.kgVol'), icon: '⚡', value: vol > 0 ? vol.toLocaleString() : '—' },
                { label: t('workout.kcal'),   icon: '🔥', value: kcal > 0 ? kcal : '—' },
              ]).map(({ label, icon, value }, i, arr) => (
                <View key={label} style={[dS.statCell, i < arr.length - 1 && dS.statCellBorder]}>
                  <Text style={{ fontSize: 18 }}>{icon}</Text>
                  <Text style={dS.statValue}>{value}</Text>
                  <Text style={dS.statLabel}>{label}</Text>
                </View>
              ))}
            </View>
            {muscleGroups.length > 0 && (
              <View style={[dS.tagRow, { marginTop: 10, flexWrap: 'wrap' }]}>
                {muscleGroups.map(m => (
                  <View key={m} style={dS.muscleTag}>
                    <Text style={dS.muscleTagText}>{m}</Text>
                  </View>
                ))}
              </View>
            )}
          </ExportCardTemplate>
        </View>

        {/* Exercises */}
        <View style={dS.exScroll}>
          <View style={dS.exSectionHeader}>
            <Text style={dS.exLabel}>{isCardio ? t('workout.activities') : t('workout.exercises')}</Text>
            <TouchableOpacity onPress={toggleAll} style={dS.collapseToggleWrap}>
              <Text style={dS.collapseToggleText}>{allExpanded ? t('workout.collapseAll') : t('workout.expandAll')}</Text>
              <View style={[dS.toggleSwitch, allExpanded && dS.toggleSwitchOn]}>
                <View style={[dS.toggleKnob, allExpanded && dS.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

          {exercises.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('workout.noExercisesLogged')}</Text>
            </View>
          )}

          {exercises.map(ex => {
            const isPB = pbSet.has((ex.exercise_name ?? '').toLowerCase());
            const isExpanded = expandedIds.has(ex.id);
            const sortedSets = (ex.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number);
            const bestIdx = getBestSetIndex(sortedSets);
            const exMuscles = getExerciseMuscles(ex.exercise_name);
            const exStyle = getWorkoutStyle(ex.exercise_name, colors);

            if (isCardio) {
              const exMin = sortedSets.reduce((s, st) => s + (st.duration_min ?? 0), 0);
              const exKcal = sortedSets.reduce((s, st) => s + calcCardioEntryKcal(ex.exercise_name, st), 0);
              return (
                <View key={ex.id} style={dS.exCard}>
                  <View style={dS.exCardHeader}>
                    <View style={[dS.exIcon, { backgroundColor: exStyle.iconBg, borderColor: exStyle.cardBorder }]}>
                      <Text style={{ fontSize: 18 }}>{getCardioIcon(ex.exercise_name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={dS.exName}>{(ex.exercise_name ?? '').toUpperCase()}</Text>
                      <View style={dS.chipRow}>
                        <View style={dS.pillChip}>
                          <Text style={dS.pillChipText}>⏱ {exMin > 0 ? `${exMin} min` : '—'}</Text>
                        </View>
                        <View style={dS.pillChip}>
                          <Text style={dS.pillChipText}>🔥 {exKcal > 0 ? `${exKcal} kcal` : '—'}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              );
            }

            return (
              <TouchableOpacity key={ex.id} style={dS.exCard} onPress={() => toggleEx(ex.id)} activeOpacity={0.85}>
                {/* Exercise header */}
                <View style={dS.exCardHeader}>
                  <View style={[dS.exIcon, { backgroundColor: exStyle.iconBg, borderColor: exStyle.cardBorder }]}>
                    <Text style={{ fontSize: 18 }}>{exStyle.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={dS.exName}>{(ex.exercise_name ?? '').toUpperCase()}</Text>
                      {isPB && (
                        <View style={dS.pbBadge}>
                          <Text style={dS.pbBadgeText}>🏆 PB</Text>
                        </View>
                      )}
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation?.(); setHistoryEx(ex.exercise_name); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="time-outline" size={15} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                    {exMuscles.length > 0 && (
                      <View style={dS.exMuscleRow}>
                        {exMuscles.map(m => (
                          <Text key={m} style={dS.exMuscleTag}>{m}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                    size={14} color={colors.textDim}
                  />
                </View>

                {/* Set table */}
                {isExpanded && sortedSets.length > 0 && (
                  <>
                    <View style={dS.setTableHdr}>
                      <Text style={[dS.setTH, { width: 32 }]}>{t('workout.set')}</Text>
                      <Text style={[dS.setTH, { width: 20 }]}></Text>
                      <Text style={[dS.setTH, { flex: 1 }]}>{t('workout.weightXReps')}</Text>
                      <Text style={[dS.setTH, { width: 56 }]}></Text>
                    </View>
                    {sortedSets.map((s, idx) => {
                      const isBest = idx === bestIdx;
                      return (
                        <View key={s.id} style={[dS.setRow, isBest && dS.bestSetRow]}>
                          <Text style={dS.setNum}>S{s.set_number}</Text>
                          <View style={dS.setDotWrap}>
                            <View style={[dS.dot, { backgroundColor: isBest ? colors.accent : colors.textDim }]} />
                          </View>
                          <Text style={dS.setWeight}>{s.weight_kg != null ? `${s.weight_kg}kg` : '—'}</Text>
                          <Text style={dS.setXText}>×</Text>
                          <Text style={dS.setReps}>{s.reps != null ? String(s.reps) : '—'}</Text>
                          {/* Fixed-width slot keeps all rows aligned */}
                          <View style={{ width: 58, alignItems: 'flex-end' }}>
                            {isBest && (
                              <View style={dS.bestBadge}>
                                <Text style={dS.bestBadgeText}>★ best</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </>
                )}
                {isExpanded && sortedSets.length === 0 && (
                  <Text style={{ fontSize: typography.xs, color: colors.textDim, padding: 8 }}>{t('workout.noSetsRecorded')}</Text>
                )}
              </TouchableOpacity>
            );
          })}

          {/* Action buttons */}
          <View style={dS.actionRow}>
            <TouchableOpacity style={dS.editBtn} onPress={onEdit}>
              <Text style={{ fontSize: 14 }}>✏️</Text>
              <Text style={dS.editBtnText}>{t('common.edit')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dS.repeatBtn} onPress={onRepeat}>
              <Ionicons name="refresh" size={16} color={colors.bg} />
              <Text style={dS.repeatBtnText}>{t('workout.repeat')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dS.deleteBtn} onPress={onDelete}>
              <Text style={{ fontSize: 14 }}>🗑️</Text>
              <Text style={dS.deleteBtnText}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 12 }} />
        </View>
        </>
        )}
      </ScrollView>
    </BottomSheet>
    <ExerciseHistoryModal
      exerciseName={historyEx}
      allSessions={allSessions}
      visible={!!historyEx}
      onClose={() => setHistoryEx(null)}
    />
    <PaywallModal visible={sessionExport.showPaywall} onClose={() => sessionExport.setShowPaywall(false)} />
    </>
  );
}

// ─── Exercise History Modal ───────────────────────────────────────────────────
function ExerciseHistoryModal({ exerciseName, allSessions, visible, onClose }) {
  const { colors } = useTheme();
  const ehS = useMemo(() => createEhS(colors), [colors]);

  const entries = useMemo(() => {
    if (!exerciseName) return [];
    const needle = exerciseName.toLowerCase();
    const rows = [];
    for (const s of allSessions ?? []) {
      const match = (s.workout_exercises ?? []).find(
        ex => (ex.exercise_name ?? '').toLowerCase() === needle
      );
      if (match) {
        const sortedSets = (match.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number);
        const bestKg = sortedSets.reduce((m, st) => Math.max(m, st.weight_kg ?? 0), 0);
        rows.push({ date: s.date, type: s.notes, sets: sortedSets, bestKg });
      }
    }
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    return rows.map((row, i) => {
      const prev = rows[i + 1];
      let delta = null;
      if (prev) {
        const diff = row.bestKg - prev.bestKg;
        delta = diff === 0 ? { same: true } : { same: false, diff };
      }
      return { ...row, delta };
    });
  }, [exerciseName, allSessions]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={ehS.container}>
        <View style={ehS.handle} />
        <View style={ehS.header}>
          <Text style={ehS.title}>{(exerciseName ?? '').toUpperCase()}</Text>
          <TouchableOpacity onPress={onClose} style={ehS.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          {entries.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: colors.textDim, fontSize: typography.sm }}>No history yet</Text>
            </View>
          )}
          {entries.map((row, i) => (
            <View key={i} style={ehS.entryCard}>
              <Text style={ehS.entryDate}>{fmtDateShort(row.date)} · {(row.type ?? '').toUpperCase()}</Text>
              <View style={ehS.chipRow}>
                {row.sets.map(st => (
                  <View key={st.id} style={ehS.chip}>
                    <Text style={ehS.chipText}>
                      S{st.set_number}: {st.weight_kg != null ? `${st.weight_kg}kg` : '—'}×{st.reps ?? '—'}
                    </Text>
                  </View>
                ))}
              </View>
              {row.delta && (
                row.delta.same ? (
                  <Text style={ehS.deltaMuted}>— same as prev</Text>
                ) : (
                  <Text style={[ehS.deltaText, { color: row.delta.diff > 0 ? colors.good : colors.danger }]}>
                    {row.delta.diff > 0 ? '▲' : '▼'} {row.delta.diff > 0 ? '+' : ''}{row.delta.diff}kg vs prev
                  </Text>
                )
              )}
            </View>
          ))}
          <View style={{ height: 30 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const createEhS = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border2, alignSelf: 'center', marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontFamily: fontFamily.displayItalic, fontStyle: 'italic', fontSize: typography.lg, color: colors.text },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim },
  entryCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 10 },
  entryDate: { fontFamily: fontFamily.bodyBold, fontSize: typography.xs, color: colors.textDim, marginBottom: 8, letterSpacing: 0.3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: colors.dim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontFamily: fontFamily.monoBold, fontSize: typography.xs, color: colors.text },
  deltaText: { fontFamily: fontFamily.bodyBold, fontSize: typography.xs, marginTop: 8 },
  deltaMuted: { fontFamily: fontFamily.bodyMedium, fontSize: typography.xs, color: colors.textDim, marginTop: 8 },
});

// ─── Edit Session Modal ───────────────────────────────────────────────────────
// Always show these two as default chip suggestions
const DEFAULT_CHIPS = ['Rest Day', 'Cardio'];

function EditSessionModal({
  visible, isNew, initialData, recentTypes, allSessions, onSave, onCancel, isSaving,
  hasAccess, templates, onSaveTemplate, onOpenToolsPaywall,
  onRepeatTemplate, isRepeatingTemplate,
}) {
  const { colors } = useTheme();
  const eS = useMemo(() => createES(colors), [colors]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [exercises, setExercises] = useState([]);
  const [activeExIdx, setActiveExIdx] = useState(null);
  const [acOpenIdx, setAcOpenIdx] = useState(null);
  const [subOpenIdx, setSubOpenIdx] = useState(null);
  const [restTimer, setRestTimer] = useState(null); // { exIdx, secondsLeft, total }
  const [programTemplate, setProgramTemplate] = useState(null);
  const scrollRef = useRef(null);
  const cardRefs = useRef({});
  const scrollCardToTop = useCallback((exIdx) => {
    setTimeout(() => {
      const card = cardRefs.current[exIdx];
      const scroller = scrollRef.current;
      if (!card || !scroller) return;
      const cardHandle = findNodeHandle(card);
      const scrollerHandle = findNodeHandle(scroller);
      if (!cardHandle || !scrollerHandle) return;
      UIManager.measureLayout(cardHandle, scrollerHandle, () => {}, (x, y) => {
        scroller.scrollTo({ y: Math.max(y - 8, 0), animated: true });
      });
    }, 100);
  }, []);
  const [programWeeks, setProgramWeeks] = useState(4);

  useEffect(() => {
    if (!restTimer) return;
    if (restTimer.secondsLeft <= 0) return;
    const t = setTimeout(() => {
      setRestTimer(prev => prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : prev);
    }, 1000);
    return () => clearTimeout(t);
  }, [restTimer]);

  const startRestTimer = (exIdx, seconds = 90) => setRestTimer({ exIdx, secondsLeft: seconds, total: seconds });
  const cancelRestTimer = () => setRestTimer(null);

  // Session auto-timer — starts the moment a brand-new session modal opens.
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  const [sessionTimerRunning, setSessionTimerRunning] = useState(false);
  const [durationManuallySet, setDurationManuallySet] = useState(false);
  const [manualDuration, setManualDuration] = useState('');

  useEffect(() => {
    if (visible && isNew) {
      setSessionElapsedSec(0);
      setSessionTimerRunning(true);
      setDurationManuallySet(false);
      setManualDuration('');
    } else if (!visible) {
      setSessionTimerRunning(false);
    }
  }, [visible, isNew]);

  useEffect(() => {
    if (!sessionTimerRunning) return;
    const t = setInterval(() => setSessionElapsedSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [sessionTimerRunning]);

  const fmtElapsed = (totalSec) => {
    const m = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // Best weight + best volume (weight*reps) ever logged per exercise, for PR detection.
  const exerciseBests = useMemo(() => {
    const map = {};
    for (const sess of allSessions ?? []) {
      for (const ex of sess.workout_exercises ?? []) {
        const key = (ex.exercise_name ?? '').trim().toLowerCase();
        if (!key) continue;
        if (!map[key]) map[key] = { weight: 0, volume: 0 };
        for (const st of ex.sets ?? []) {
          const w = st.weight_kg ?? 0;
          const r = st.reps ?? 0;
          if (w > map[key].weight) map[key].weight = w;
          if (w * r > map[key].volume) map[key].volume = w * r;
        }
      }
    }
    return map;
  }, [allSessions]);

  const getSetPR = (exName, weightKg, reps) => {
    const key = (exName ?? '').trim().toLowerCase();
    const best = exerciseBests[key];
    const w = parseFloat(weightKg);
    const r = parseInt(reps, 10);
    if (!key || isNaN(w) || !w) return null;
    if (!best) return reps && !isNaN(r) ? { type: 'weight' } : null;
    if (w > best.weight) return { type: 'weight' };
    if (!isNaN(r) && w * r > best.volume) return { type: 'volume' };
    return null;
  };

  // Copy last session — finds the most recent past session of the same getSessionType
  // and copies just exercise names (fresh blank sets, not old weights/reps).
  const copyLastSession = (sessionTypeName) => {
    const targetType = getSessionType(sessionTypeName);
    const candidates = (allSessions ?? [])
      .filter(s => getSessionType(s.notes) === targetType && (s.workout_exercises ?? []).length > 0)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
    const match = candidates[0];
    if (!match) {
      Alert.alert('No previous session', `No past "${sessionTypeName || targetType}" session found to copy.`);
      return;
    }
    const exs = (match.workout_exercises ?? [])
      .slice().sort((a, b) => a.order_index - b.order_index)
      .map(ex => ({ _key: tid(), name: ex.exercise_name, sets: [blankSet()] }));
    setExercises(exs);
  };

  const loadTemplate = (tpl) => {
    const exs = (tpl.exercises ?? []).map(ex => ({
      _key: tid(),
      name: ex.name ?? '',
      sets: (ex.sets ?? []).length
        ? ex.sets.map(s => ({ ...blankSet(), weight_kg: String(s.weight_kg ?? ''), reps: String(s.reps ?? '') }))
        : [blankSet()],
    }));
    setExercises(exs);
    setName(tpl.name ?? name);
  };

  const namePool = useMemo(() => getExerciseNamePool(allSessions), [allSessions]);

  // All chips: defaults first, then unique recent types excluding defaults
  const allChips = useMemo(() => {
    const extra = recentTypes.filter(t => !DEFAULT_CHIPS.some(d => d.toLowerCase() === t.toLowerCase()));
    return [...DEFAULT_CHIPS, ...extra];
  }, [recentTypes]);

  useEffect(() => {
    if (visible && initialData) {
      setDate(initialData.date ?? '');
      setName(initialData.name ?? '');
      setExercises(initialData.exercises ?? []);
      setActiveExIdx(null);
    }
  }, [visible, initialData]);

  const addExercise = () => {
    const ex = blankEx();
    if (isCardio) ex.name = CARDIO_TYPES[0].val;
    const newIdx = exercises.length;
    setExercises(prev => [...prev, ex]);
    setActiveExIdx(newIdx);
    scrollCardToTop(newIdx);
  };

  const removeExercise = (idx) => {
    setExercises(prev => prev.filter((_, i) => i !== idx));
    if (activeExIdx === idx) setActiveExIdx(null);
    else if (activeExIdx > idx) setActiveExIdx(activeExIdx - 1);
  };

  const updateExName = (idx, val) =>
    setExercises(prev => prev.map((ex, i) => i === idx ? { ...ex, name: val } : ex));

  const addSet = (exIdx) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: [...(ex.sets ?? []), blankSet()],
    }));

  const insertWarmupSet = (exIdx, weightKg) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: [{ ...blankSet(), weight_kg: String(weightKg), reps: '8' }, ...(ex.sets ?? [])],
    }));

  const applySwap = (exIdx, newName) => {
    updateExName(exIdx, newName);
    setSubOpenIdx(null);
  };

  // Toggling joins/leaves a superset group; a fresh group_id is minted on first toggle,
  // and reused for up to 3 consecutive exercises so the rest timer can treat them as one circuit.
  const toggleExerciseGroup = (exIdx) => {
    setExercises(prev => {
      const target = prev[exIdx];
      if (target.group_id) {
        return prev.map((ex, i) => i === exIdx ? { ...ex, group_id: null } : ex);
      }
      const openGroup = [...prev].reverse().find((ex, ri) => {
        const i = prev.length - 1 - ri;
        return ex.group_id && i !== exIdx && prev.filter(e => e.group_id === ex.group_id).length < 3;
      });
      const groupId = openGroup?.group_id ?? tid();
      return prev.map((ex, i) => i === exIdx ? { ...ex, group_id: groupId } : ex);
    });
  };

  const removeSet = (exIdx, sIdx) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: (ex.sets ?? []).filter((_, j) => j !== sIdx),
    }));

  const updateSet = (exIdx, sIdx, field, val) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: (ex.sets ?? []).map((s, j) => j !== sIdx ? s : { ...s, [field]: val }),
    }));

  const handleSave = () => {
    if (!date.trim()) { Alert.alert('Date required', 'Please pick a date.'); return; }
    const isRest = name.toLowerCase() === 'rest day';
    setSessionTimerRunning(false);
    const manualMin = parseFloat(manualDuration);
    const duration_min = durationManuallySet && !isNaN(manualMin)
      ? manualMin
      : (isNew && sessionElapsedSec > 0 ? Math.round(sessionElapsedSec / 60) : undefined);
    onSave({
      date: date.trim(), name: name.trim() || 'Workout', exercises: isRest ? [] : exercises,
      ...(duration_min != null ? { duration_min } : {}),
    });
  };

  const isRestDay = name.toLowerCase() === 'rest day';
  const isCardio  = !isRestDay && ['cardio','run','stair','hiit','bike','swim','walk','cycle'].some(k => name.toLowerCase().includes(k));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={eS.container}>
          <ScrollView ref={scrollRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={eS.header}>
            <View style={{ flex: 1 }}>
              <Text style={eS.headerTop}>
                <Text style={eS.headerLOG}>LOG </Text>
                <Text style={eS.headerSub}>{isNew ? 'New Session' : 'Edit Session'}</Text>
              </Text>
              <Text style={eS.trackLabel}>TRACK YOUR WORKOUT</Text>
            </View>
            <TouchableOpacity onPress={onCancel} style={eS.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Session type chips — only the selected chip is highlighted */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={eS.typeScroll} contentContainerStyle={eS.typeRow}>
            {allChips.map(t => {
              const active = name.toLowerCase() === t.toLowerCase();
              return (
                <TouchableOpacity key={t}
                  style={[eS.typeChip, active && eS.typeChipActive]}
                  onPress={() => setName(t)}>
                  <Text style={[eS.typeChipText, active && eS.typeChipTextActive]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {isNew && !isRestDay && (
            <View style={eS.toolsRow}>
              <View style={eS.timerPill}>
                <Ionicons name="time-outline" size={13} color={colors.accent} />
                <Text style={eS.timerPillText}>{fmtElapsed(sessionElapsedSec)}</Text>
              </View>
              <TouchableOpacity style={eS.copyLastBtn} onPress={() => copyLastSession(name)}>
                <Ionicons name="copy-outline" size={13} color={colors.purple} />
                <Text style={eS.copyLastBtnText}>Copy last session</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Date + Type */}
          <View style={eS.fieldRow}>
            <View style={eS.fieldCol}>
              <Text style={eS.fieldLabel}>DATE</Text>
              <DatePickerField
                value={date}
                onChange={setDate}
                colors={colors}
                maxDate={localDateStr(new Date())}
                placeholder="Pick date"
                style={eS.datePickerBtn}
              />
            </View>
            <View style={eS.fieldCol}>
              <Text style={eS.fieldLabel}>TYPE</Text>
              <TextInput style={eS.fieldInput} value={name} onChangeText={setName}
                placeholder="e.g. Chest & Back" placeholderTextColor={colors.textDim} />
            </View>
          </View>

          {/* Content area — differs by type */}
          {isRestDay ? (
            /* ── Rest Day UI ── */
            <View style={eS.restDayWrap}>
              <Text style={eS.restDayEmoji}>😴</Text>
              <Text style={eS.restDayTitle}>Rest & Recovery</Text>
              <Text style={eS.restDaySub}>No exercises needed on rest days.{'\n'}Recovery is part of progress!</Text>
              <View style={eS.restDayBadges}>
                {['💤 Sleep', '🧘 Stretch', '🥗 Nutrition'].map(b => (
                  <View key={b} style={eS.restBadge}>
                    <Text style={eS.restBadgeText}>{b}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            /* ── Workout / Cardio exercise list ── */
            <View style={eS.exScroll}>
              {isCardio && (
                <View style={eS.cardioHint}>
                  <Ionicons name="fitness-outline" size={14} color={colors.blue} />
                  <Text style={eS.cardioHintText}>Add activities — Distance (km) × Duration (min)</Text>
                </View>
              )}

              {exercises.map((ex, exIdx) => {
                const isActive = activeExIdx === exIdx;
                return (
                  <View key={ex._key} ref={r => { cardRefs.current[exIdx] = r; }} style={[eS.exCard, isActive && eS.exCardActive]}>
                    <TouchableOpacity style={eS.exCardHeader}
                      onPress={() => {
                        const next = isActive ? null : exIdx;
                        setActiveExIdx(next);
                        if (next != null) scrollCardToTop(next);
                      }}>
                      <View style={[eS.exNumBadge, isActive && eS.exNumBadgeActive]}>
                        <Text style={[eS.exNumText, isActive && eS.exNumTextActive]}>{exIdx + 1}</Text>
                      </View>
                      <Text style={[eS.exCardName, isActive && eS.exCardNameActive]} numberOfLines={1}>
                        {ex.name.trim() || (isCardio ? 'New Activity' : 'New Exercise')}
                      </Text>
                      <Text style={eS.exSetsCount}>
                        {isCardio ? `${(ex.sets ?? []).length} entr${(ex.sets ?? []).length === 1 ? 'y' : 'ies'}` : `${(ex.sets ?? []).length} sets`}
                      </Text>
                      <TouchableOpacity onPress={() => removeExercise(exIdx)} style={eS.exDeleteBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <View style={eS.exDeleteX}>
                          <Ionicons name="close" size={12} color={colors.danger} />
                        </View>
                      </TouchableOpacity>
                    </TouchableOpacity>

                    {isActive && (
                      <View style={eS.exExpanded}>
                        {isCardio ? (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false}
                            style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
                            {CARDIO_TYPES.map(t => {
                              const active = ex.name === t.val;
                              return (
                                <TouchableOpacity key={t.val}
                                  style={[eS.typeChip, active && eS.typeChipActive]}
                                  onPress={() => updateExName(exIdx, t.val)}>
                                  <Text style={[eS.typeChipText, active && eS.typeChipTextActive]}>{t.label}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        ) : (
                          <View style={eS.exNameRow}>
                            <View style={eS.hashIcon}>
                              <Text style={eS.hashText}>#</Text>
                            </View>
                            <TextInput
                              style={eS.exNameInput}
                              value={ex.name}
                              onChangeText={v => { updateExName(exIdx, v); setAcOpenIdx(exIdx); }}
                              onFocus={() => { setAcOpenIdx(exIdx); scrollCardToTop(exIdx); }}
                              onBlur={() => setTimeout(() => setAcOpenIdx(cur => (cur === exIdx ? null : cur)), 150)}
                              placeholder="Exercise name"
                              placeholderTextColor={colors.textDim}
                              autoFocus
                            />
                            {!!ex.name.trim() && getSubstitutes(ex.name).length > 0 && (
                              <TouchableOpacity
                                style={eS.swapBtn}
                                onPress={() => hasAccess ? setSubOpenIdx(subOpenIdx === exIdx ? null : exIdx) : onOpenToolsPaywall?.()}
                              >
                                <Text style={eS.swapBtnText}>{hasAccess ? '🔄' : '🔒'}</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={[eS.swapBtn, ex.group_id && { backgroundColor: colors.purple + '33' }]}
                              onPress={() => hasAccess ? toggleExerciseGroup(exIdx) : onOpenToolsPaywall?.()}
                            >
                              <Text style={eS.swapBtnText}>{hasAccess ? '🔗' : '🔒'}</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {!isCardio && !!ex.name.trim() && (() => {
                          const trend = getExerciseTopSetTrend(allSessions, ex.name);
                          if (trend.length < 2) return null;
                          return hasAccess ? (
                            <View style={eS.trendRow}>
                              <Text style={eS.trendLabel}>STRENGTH TREND</Text>
                              <Sparkline data={trend} color={colors.accent} width={70} height={24} />
                              <Text style={eS.trendVal}>{trend[trend.length - 1]}kg</Text>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => onOpenToolsPaywall?.()} style={eS.trendRow}>
                              <Text style={eS.trendLabel}>🔒 PRO: strength trend</Text>
                            </TouchableOpacity>
                          );
                        })()}

                        {ex.group_id && (
                          <View style={eS.groupHint}>
                            <Text style={eS.groupHintText}>
                              🔗 Grouped — rest timer waits until the last exercise in this group
                            </Text>
                          </View>
                        )}

                        {!isCardio && hasAccess && subOpenIdx === exIdx && (
                          <View style={eS.acDropdown}>
                            <Text style={eS.subHeader}>SWAP EXERCISE — PRO</Text>
                            {getSubstitutes(ex.name).map(n => (
                              <TouchableOpacity key={n} style={eS.acItem} onPress={() => applySwap(exIdx, n)}>
                                <Text style={{ fontSize: 14 }}>🔄</Text>
                                <Text style={eS.acItemText}>{n}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        )}

                        {!isCardio && acOpenIdx === exIdx && (() => {
                          const q = ex.name.trim().toLowerCase();
                          const matches = namePool.filter(n => !q || n.toLowerCase().includes(q)).slice(0, 8);
                          if (!matches.length || matches.some(n => n.toLowerCase() === q)) return null;
                          return (
                            <View style={eS.acDropdown}>
                              {matches.map(n => {
                                const exStyleAc = getWorkoutStyle(n, colors);
                                return (
                                  <TouchableOpacity
                                    key={n}
                                    style={eS.acItem}
                                    onPress={() => { updateExName(exIdx, n); setAcOpenIdx(null); }}
                                  >
                                    <Text style={{ fontSize: 14 }}>{exStyleAc.icon}</Text>
                                    <Text style={eS.acItemText}>{n}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          );
                        })()}

                        {!isCardio && !!ex.name.trim() && (() => {
                          const prev = getPrevSetSummary(allSessions, ex.name, date || undefined);
                          if (!prev) return null;
                          const suggestion = suggestProgressiveOverload(prev);
                          const warmups = getWarmupSets(suggestion?.weight ?? prev.weight);
                          return (
                            <View style={eS.prevPerfBox}>
                              <Text style={eS.prevPerfText}>
                                📈 Last: <Text style={eS.prevPerfBold}>{prev.weight}kg × {prev.reps}</Text>
                                {prev.rpe ? ` @ RPE ${prev.rpe}` : ''}
                              </Text>
                              {hasAccess ? (
                                suggestion && (
                                  <Text style={eS.suggestText}>
                                    🎯 Suggested: <Text style={eS.prevPerfBold}>{suggestion.weight}kg × {suggestion.reps}</Text> ({suggestion.note})
                                  </Text>
                                )
                              ) : (
                                <TouchableOpacity onPress={() => onOpenToolsPaywall?.()}>
                                  <Text style={eS.suggestTextLocked}>🔒 Pro: see your suggested next target</Text>
                                </TouchableOpacity>
                              )}
                              {(ex.sets ?? []).length === 1 && !ex.sets[0].weight_kg && (
                                <View style={eS.warmupRow}>
                                  <Text style={eS.warmupLabel}>WARM-UP:</Text>
                                  {warmups.map((w, wi) => (
                                    <TouchableOpacity key={wi} style={eS.warmupChip} onPress={() => insertWarmupSet(exIdx, w)}>
                                      <Text style={eS.warmupChipText}>{w}kg</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              )}
                            </View>
                          );
                        })()}

                        {!isCardio && restTimer && restTimer.exIdx === exIdx && (
                          <View style={eS.restBanner}>
                            <Text style={eS.restBannerText}>
                              ⏱ Rest: {Math.floor(restTimer.secondsLeft / 60)}:{String(restTimer.secondsLeft % 60).padStart(2, '0')}
                            </Text>
                            <TouchableOpacity onPress={cancelRestTimer}>
                              <Text style={eS.restBannerCancel}>Skip</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {isCardio ? (
                          (ex.sets ?? []).map((s, sIdx) => {
                            const def = getCardioFieldDefs(ex.name);
                            const autoKcal = calcCardioEntryKcal(ex.name, {
                              duration_min: parseFloat(s.duration_min) || 0,
                              speed_kmh: parseFloat(s.speed_kmh) || 0,
                              incline_pct: parseFloat(s.incline_pct) || 0,
                              avg_rpm: parseFloat(s.avg_rpm) || 0,
                            });
                            return (
                              <View key={s._key} style={eS.cardioFieldCard}>
                                <View style={eS.cardioFieldRow}>
                                  <View style={eS.cardioFieldCol}>
                                    <Text style={eS.cardioFieldLabel}>DURATION (MIN)</Text>
                                    <TextInput
                                      style={eS.setInput}
                                      value={s.duration_min}
                                      onChangeText={v => updateSet(exIdx, sIdx, 'duration_min', v)}
                                      onFocus={() => scrollCardToTop(exIdx)}
                                      keyboardType="numeric"
                                      placeholder="min"
                                      placeholderTextColor={colors.textDim}
                                    />
                                  </View>
                                  <View style={eS.cardioFieldCol}>
                                    <Text style={eS.cardioFieldLabel}>CALORIES (AUTO)</Text>
                                    <Text style={eS.cardioAutoValue}>{autoKcal > 0 ? `${autoKcal} kcal` : '—'}</Text>
                                  </View>
                                  <TouchableOpacity onPress={() => removeSet(exIdx, sIdx)} style={eS.setDeleteBtn}>
                                    <Ionicons name="close" size={14} color={colors.textDim} />
                                  </TouchableOpacity>
                                </View>
                                {(def.secondary || def.tertiary) && (
                                  <View style={eS.cardioFieldRow}>
                                    {def.secondary && (
                                      <View style={eS.cardioFieldCol}>
                                        <Text style={eS.cardioFieldLabel}>{def.secondary.label}</Text>
                                        <TextInput
                                          style={eS.setInput}
                                          value={s[def.secondary.key]}
                                          onChangeText={v => updateSet(exIdx, sIdx, def.secondary.key, v)}
                                          onFocus={() => scrollCardToTop(exIdx)}
                                          keyboardType="decimal-pad"
                                          placeholder={def.secondary.placeholder}
                                          placeholderTextColor={colors.textDim}
                                        />
                                      </View>
                                    )}
                                    {def.tertiary && (
                                      <View style={eS.cardioFieldCol}>
                                        <Text style={eS.cardioFieldLabel}>{def.tertiary.label}</Text>
                                        <TextInput
                                          style={eS.setInput}
                                          value={s[def.tertiary.key]}
                                          onChangeText={v => updateSet(exIdx, sIdx, def.tertiary.key, v)}
                                          onFocus={() => scrollCardToTop(exIdx)}
                                          keyboardType="decimal-pad"
                                          placeholder={def.tertiary.placeholder}
                                          placeholderTextColor={colors.textDim}
                                        />
                                      </View>
                                    )}
                                  </View>
                                )}
                              </View>
                            );
                          })
                        ) : (
                          (ex.sets ?? []).map((s, sIdx) => {
                            const plates = calcPlates(parseFloat(s.weight_kg));
                            const autoReg = hasAccess && sIdx > 0 ? suggestAutoReg(ex.sets[sIdx - 1]) : null;
                            const pr = getSetPR(ex.name, s.weight_kg, s.reps);
                            const oneRM = hasAccess ? estimate1RM(s.weight_kg, s.reps) : null;
                            return (
                              <View key={s._key}>
                                <View style={eS.setRow}>
                                  <Text style={eS.setNumLabel}>{sIdx + 1}</Text>
                                  <TextInput
                                    style={eS.setInput}
                                    value={s.weight_kg}
                                    onChangeText={v => updateSet(exIdx, sIdx, 'weight_kg', v)}
                                    onFocus={() => scrollCardToTop(exIdx)}
                                    keyboardType="decimal-pad"
                                    placeholder={autoReg ? String(autoReg.weight) : 'kg'}
                                    placeholderTextColor={autoReg ? colors.accent : colors.textDim}
                                  />
                                  <Text style={eS.setX}>×</Text>
                                  <TextInput
                                    style={eS.setInput}
                                    value={s.reps}
                                    onChangeText={v => updateSet(exIdx, sIdx, 'reps', v)}
                                    onFocus={() => scrollCardToTop(exIdx)}
                                    keyboardType="numeric"
                                    placeholder="reps"
                                    placeholderTextColor={colors.textDim}
                                  />
                                  <TextInput
                                    onFocus={() => scrollCardToTop(exIdx)}
                                    style={[eS.setInput, { maxWidth: 50 }]}
                                    value={s.rpe}
                                    onChangeText={v => updateSet(exIdx, sIdx, 'rpe', v)}
                                    keyboardType="decimal-pad"
                                    placeholder="RPE"
                                    placeholderTextColor={colors.textDim}
                                  />
                                  <TouchableOpacity onPress={() => removeSet(exIdx, sIdx)} style={eS.setDeleteBtn}>
                                    <Ionicons name="close" size={14} color={colors.textDim} />
                                  </TouchableOpacity>
                                </View>
                                {plates.length > 0 && (
                                  <Text style={eS.plateText}>🏋️ Plates/side: {plates.join(' + ')}kg</Text>
                                )}
                                {autoReg && (
                                  <Text style={eS.autoRegText}>⚙️ Auto-reg suggests {autoReg.weight}kg — {autoReg.note}</Text>
                                )}
                                {oneRM && (
                                  <Text style={eS.oneRmText}>💪 Est. 1RM: {oneRM}kg</Text>
                                )}
                                {!hasAccess && s.weight_kg && s.reps && (
                                  <TouchableOpacity onPress={() => onOpenToolsPaywall?.()}>
                                    <Text style={eS.oneRmTextLocked}>🔒 PRO: see estimated 1RM</Text>
                                  </TouchableOpacity>
                                )}
                                {pr && (
                                  <View style={eS.prBanner}>
                                    <Text style={eS.prBannerText}>
                                      🎉 New PR! {pr.type === 'weight' ? 'Heaviest weight yet' : 'Best volume yet'}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            );
                          })
                        )}

                        <View style={eS.addSetRow}>
                          <TouchableOpacity style={[eS.addSetBtn, { flex: 1 }]} onPress={() => addSet(exIdx)}>
                            <Text style={eS.addSetText}>{isCardio ? '+ Add Entry' : '+ Add Set'}</Text>
                          </TouchableOpacity>
                          {!isCardio && (() => {
                            // In a superset, the rest timer only fires once the last exercise in the group is reached
                            const isLastInGroup = !ex.group_id || !exercises.some((other, oi) => oi > exIdx && other.group_id === ex.group_id);
                            if (!isLastInGroup) return null;
                            return (
                              <TouchableOpacity style={eS.restBtn} onPress={() => startRestTimer(exIdx, 90)}>
                                <Ionicons name="timer-outline" size={14} color={colors.blue} />
                                <Text style={eS.restBtnText}>90s Rest</Text>
                              </TouchableOpacity>
                            );
                          })()}
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}

              {isNew && exercises.length === 0 && !isCardio && (
                <View style={eS.templateRow}>
                  <Text style={eS.templateRowLabel}>📋 LOAD TEMPLATE {!hasAccess && '— PRO'}</Text>
                  {hasAccess ? (
                    templates.length > 0 ? (
                      <>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                          {templates.map(t => (
                            <TouchableOpacity
                              key={t.id}
                              style={eS.templateChip}
                              onPress={() => loadTemplate(t)}
                              onLongPress={() => setProgramTemplate(t)}
                            >
                              <Text style={eS.templateChipText}>{t.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                        <Text style={eS.programHintText}>Long-press a template to build a multi-week program</Text>
                      </>
                    ) : (
                      <Text style={eS.templateEmptyText}>Save a session below to build your first template.</Text>
                    )
                  ) : (
                    <TouchableOpacity style={eS.templateChip} onPress={onOpenToolsPaywall}>
                      <Text style={eS.templateChipText}>🔒 Unlock saved templates</Text>
                    </TouchableOpacity>
                  )}

                  {hasAccess && programTemplate && (
                    <View style={eS.programBox}>
                      <Text style={eS.programBoxTitle}>📅 Repeat "{programTemplate.name}" weekly</Text>
                      <View style={eS.programWeekRow}>
                        {[2, 4, 6, 8, 12].map(w => (
                          <TouchableOpacity
                            key={w}
                            style={[eS.programWeekChip, programWeeks === w && eS.programWeekChipActive]}
                            onPress={() => setProgramWeeks(w)}
                          >
                            <Text style={[eS.programWeekChipText, programWeeks === w && eS.programWeekChipTextActive]}>{w}w</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <TouchableOpacity
                          style={[eS.programCreateBtn, isRepeatingTemplate && { opacity: 0.6 }]}
                          disabled={isRepeatingTemplate}
                          onPress={() => {
                            onRepeatTemplate?.({ template: programTemplate, weeks: programWeeks, startDate: date || new Date() });
                            setProgramTemplate(null);
                          }}
                        >
                          <Text style={eS.programCreateBtnText}>
                            {isRepeatingTemplate ? 'Creating…' : `Create ${programWeeks} sessions`}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={eS.programCancelBtn} onPress={() => setProgramTemplate(null)}>
                          <Text style={eS.programCancelBtnText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

              <TouchableOpacity style={eS.addExBtn} onPress={addExercise}>
                <Ionicons name="add" size={18} color={colors.accent} />
                <Text style={eS.addExText}>{isCardio ? 'Add Activity' : 'Add Exercise'}</Text>
              </TouchableOpacity>

              {!isCardio && exercises.length > 0 && (
                <TouchableOpacity
                  style={eS.saveTemplateBtn}
                  onPress={() => hasAccess ? onSaveTemplate({ name: name.trim() || 'Workout', exercises }) : onOpenToolsPaywall?.()}
                >
                  <Ionicons name="bookmark-outline" size={14} color={hasAccess ? colors.purple : colors.textDim} />
                  <Text style={eS.saveTemplateBtnText}>
                    {hasAccess ? 'Save as Template' : '🔒 Save as Template (Pro)'}
                  </Text>
                </TouchableOpacity>
              )}
              <View style={{ height: 20 }} />
            </View>
          )}

          {isNew && !isRestDay && (
            <View style={eS.durationOverrideRow}>
              <Text style={eS.durationOverrideLabel}>DURATION (MIN)</Text>
              <TextInput
                style={eS.durationOverrideInput}
                value={manualDuration}
                onChangeText={v => { setManualDuration(v); setDurationManuallySet(v.trim() !== ''); }}
                keyboardType="numeric"
                placeholder={String(Math.round(sessionElapsedSec / 60))}
                placeholderTextColor={colors.textDim}
              />
            </View>
          )}
          </ScrollView>

          {/* Bottom buttons */}
          <View style={eS.bottomRow}>
            <TouchableOpacity style={eS.cancelBtn} onPress={onCancel}>
              <Text style={eS.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={eS.saveBtn} onPress={handleSave} disabled={isSaving}>
              {isSaving
                ? <ActivityIndicator color={colors.bg} />
                : <Text style={eS.saveBtnText}>{isNew ? 'Save Session' : 'Update Session'}</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function WorkoutScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { hasAccess, isPro } = useSubscription();
  const s = useMemo(() => createS(colors), [colors]);
  const qc = useQueryClient();
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = screenWidth - 32 - 32;

  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [detailSession, setDetailSession] = useState(null);
  const [showDetail, setShowDetail]       = useState(false);
  const [showEdit, setShowEdit]           = useState(false);
  const [editIsNew, setEditIsNew]         = useState(false);
  const [editInitial, setEditInitial]     = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [trendRange, setTrendRange]       = useState('30D');
  const [showTrendPaywall, setShowTrendPaywall] = useState(false);
  const [muscleExpanded, setMuscleExpanded] = useState(false);
  const [showInsightsPaywall, setShowInsightsPaywall] = useState(false);
  const [showWorkoutGoalSheet, setShowWorkoutGoalSheet] = useState(false);
  const [workoutGoalInput, setWorkoutGoalInput] = useState(4);
  const [showToolsPaywall, setShowToolsPaywall] = useState(false);
  const [hideRestDays, setHideRestDays] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('fitzo:hideRestDays').then(stored => {
      if (stored === 'true' || stored === 'false') setHideRestDays(stored === 'true');
    });
  }, []);

  const toggleHideRestDays = useCallback(() => {
    if (!hasAccess) { setShowToolsPaywall(true); return; }
    setHideRestDays(prev => {
      const next = !prev;
      AsyncStorage.setItem('fitzo:hideRestDays', next ? 'true' : 'false');
      return next;
    });
  }, [hasAccess]);

  const { data: sessions = [], isLoading, refetch } = useQuery({
    queryKey: ['sessions', user?.id],
    queryFn: () => fetchSessions(user.id),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const { prefs: notifPrefs, times: notifTimes } = useNotificationPrefs() ?? { prefs: {}, times: {} };
  const workoutReminderTime = notifTimes.workoutReminder ?? { hour: 22, minute: 0 };
  useEffect(() => {
    if (isLoading || !notifPrefs.workoutReminder) {
      if (!notifPrefs.workoutReminder) syncConditionalReminder('workoutReminder', true, workoutReminderTime.hour, workoutReminderTime.minute, '', '');
      return;
    }
    const todayStr = localDateStr(new Date());
    const loggedToday = sessions.some(sess => sess.date === todayStr);
    syncConditionalReminder('workoutReminder', loggedToday, workoutReminderTime.hour, workoutReminderTime.minute,
      "Log today's workout", "You haven't logged a workout session today.");
  }, [isLoading, notifPrefs.workoutReminder, sessions, workoutReminderTime.hour, workoutReminderTime.minute]);

  const { data: weeklyGoal = DEFAULT_WEEKLY_GOAL } = useQuery({
    queryKey: ['workoutGoal', user?.id],
    queryFn: () => fetchWorkoutGoal(user.id),
    enabled: !!user?.id,
  });

  const saveMut = useMutation({
    mutationFn: (params) => saveSession(user.id, params),
    // NOTE: not optimistic — server computes total_volume and generates
    // exercise/set ids across multiple round trips (delete-then-reinsert),
    // so the cached shape can't be reliably reconstructed client-side
    // without risking incorrect derived data (PRs, volume, trend badges).
    onSuccess: () => { qc.invalidateQueries(['sessions', user.id]); setShowEdit(false); },
    onError: (e) => Alert.alert('Error saving', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteFullSession,
    onMutate: async (sessionId) => {
      await qc.cancelQueries(['sessions', user.id]);
      const previous = qc.getQueryData(['sessions', user.id]);
      qc.setQueryData(['sessions', user.id], (old) =>
        (old ?? []).filter((s) => s.id !== sessionId)
      );
      setShowDetail(false);
      return { previous };
    },
    onError: (e, sessionId, context) => {
      if (context?.previous) qc.setQueryData(['sessions', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => { qc.invalidateQueries(['sessions', user.id]); },
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateWorkoutGoal(user.id, goal),
    onMutate: async (goal) => {
      await qc.cancelQueries(['workoutGoal', user.id]);
      const previous = qc.getQueryData(['workoutGoal', user.id]);
      qc.setQueryData(['workoutGoal', user.id], goal);
      setShowWorkoutGoalSheet(false);
      return { previous };
    },
    onError: (e, goal, context) => {
      if (context?.previous !== undefined) qc.setQueryData(['workoutGoal', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => { qc.invalidateQueries(['workoutGoal', user.id]); },
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['workoutTemplates', user?.id],
    queryFn: () => fetchTemplates(user.id),
    enabled: !!user?.id && hasAccess,
  });

  const saveTemplateMut = useMutation({
    mutationFn: ({ name, exercises }) => saveTemplate(user.id, name, exercises),
    onSuccess: () => { qc.invalidateQueries(['workoutTemplates', user.id]); Alert.alert('Saved', 'Template saved.'); },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const repeatTemplateMut = useMutation({
    mutationFn: ({ template, weeks, startDate }) => repeatTemplateForWeeks(user.id, template, weeks, startDate),
    onSuccess: (_, { weeks }) => {
      qc.invalidateQueries(['sessions', user.id]);
      Alert.alert('Program scheduled', `Created ${weeks} future session${weeks === 1 ? '' : 's'} from this template.`);
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const pbMap       = useMemo(() => computePBMap(sessions), [sessions]);
  const recentTypes = useMemo(() => getRecentTypes(sessions), [sessions]);
  const deload       = useMemo(() => detectDeload(sessions), [sessions]);
  const overtraining = useMemo(() => detectOvertraining(sessions), [sessions]);
  const muscleVolume = useMemo(() => getMuscleVolumeThisWeek(sessions), [sessions]);

  const TYPE_PRIORITY = { gym: 2, cardio: 1, rest: 0 };
  const heatmapByDate = useMemo(() => {
    const map = {};
    for (const sess of sessions) {
      const d = new Date(sess.date);
      if (d.getFullYear() !== viewYear || d.getMonth() + 1 !== viewMonth) continue;
      const type = getSessionType(sess.notes);
      const vol = calcSessionVol(sess);
      const entry = map[sess.date] ?? { count: 0, type: null, vol: 0 };
      entry.count += 1;
      entry.vol += vol;
      if (entry.type === null || TYPE_PRIORITY[type] > TYPE_PRIORITY[entry.type]) entry.type = type;
      map[sess.date] = entry;
    }
    return map;
  }, [sessions, viewYear, viewMonth]);

  const openDetailForDate = (dateStr) => {
    const match = sessions.find(s => s.date === dateStr);
    if (match) openDetail(match);
  };

  const isViewingCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1;

  const heroStats = useMemo(() => {
    const monthSessions = sessions.filter(s => {
      const d = new Date(s.date);
      return d.getFullYear() === viewYear && d.getMonth() + 1 === viewMonth;
    });
    const activeSessions = monthSessions.filter(s => getSessionType(s.notes) !== 'rest');
    const totalVol = monthSessions.reduce((sum, s) => sum + (s.total_volume ?? calcSessionVol(s)), 0);
    const allSets = monthSessions.flatMap(s => (s.workout_exercises ?? []).flatMap(ex => ex.sets ?? []));
    const totalSets = allSets.length;
    const rpeSets = allSets.filter(st => st.rpe != null);
    const avgRpe = rpeSets.length
      ? (rpeSets.reduce((sum, st) => sum + st.rpe, 0) / rpeSets.length).toFixed(1)
      : null;
    const pbCount = activeSessions.reduce((sum, s) => sum + (pbMap[s.id]?.size ?? 0), 0);
    const avgVolPerSession = activeSessions.length ? Math.round(totalVol / activeSessions.length) : 0;
    const heaviestLift = allSets.reduce((max, st) => Math.max(max, st.weight_kg ?? 0), 0);
    const muscleGroupsHit = getMuscleGroups(monthSessions.flatMap(s => s.workout_exercises ?? [])).length;
    return {
      totalVol: Math.round(totalVol),
      sessionCount: activeSessions.length,
      totalSets,
      avgRpe,
      pbCount,
      avgVolPerSession,
      heaviestLift,
      muscleGroupsHit,
    };
  }, [sessions, viewYear, viewMonth, pbMap]);

  const weekDays = useMemo(() => {
    const [mondayStr, sundayStr, monday] = getWeekRange(today, 0);
    const todayStr = localDateStr(today);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = localDateStr(d);
      const sess = sessions.find(s => s.date === dateStr);
      const type = sess ? getSessionType(sess.notes) : null;
      return {
        date: dateStr,
        vol: sess ? (sess.total_volume ?? calcSessionVol(sess)) : 0,
        type,
        isToday: dateStr === todayStr,
        isFuture: dateStr > todayStr,
      };
    });
  }, [sessions, today]);

  const weekCompare = useMemo(() => {
    const [thisMonStr, thisSunStr] = getWeekRange(today, 0);
    const [lastMonStr, lastSunStr] = getWeekRange(today, 1);
    const thisWeekSessions = sessions.filter(s => s.date >= thisMonStr && s.date <= thisSunStr);
    const lastWeekSessions = sessions.filter(s => s.date >= lastMonStr && s.date <= lastSunStr);
    const thisVol = thisWeekSessions.reduce((sum, s) => sum + (s.total_volume ?? calcSessionVol(s)), 0);
    const lastVol = lastWeekSessions.reduce((sum, s) => sum + (s.total_volume ?? calcSessionVol(s)), 0);
    const pct = lastVol > 0 ? Math.round(((thisVol - lastVol) / lastVol) * 100) : null;
    return {
      thisVol: Math.round(thisVol),
      lastVol: Math.round(lastVol),
      thisGymCount: thisWeekSessions.filter(s => getSessionType(s.notes) === 'gym').length,
      thisCardioCount: thisWeekSessions.filter(s => getSessionType(s.notes) === 'cardio').length,
      lastGymCount: lastWeekSessions.filter(s => getSessionType(s.notes) === 'gym').length,
      lastCardioCount: lastWeekSessions.filter(s => getSessionType(s.notes) === 'cardio').length,
      lastCount: lastWeekSessions.filter(s => getSessionType(s.notes) !== 'rest').length,
      pct,
    };
  }, [sessions, today]);

  // Active (non-rest) session dates — used for weekly consistency (cardio still counts)
  const activeDateSet = useMemo(
    () => new Set(sessions.filter(s => getSessionType(s.notes) !== 'rest').map(s => s.date)),
    [sessions]
  );

  // Gym-only session dates — streaks are gym-specific; cardio doesn't count toward them
  const gymDateSet = useMemo(
    () => new Set(sessions.filter(s => getSessionType(s.notes) === 'gym').map(s => s.date)),
    [sessions]
  );

  const consistency = useMemo(() => {
    const todayStr = localDateStr(today);

    // Current streak: consecutive days logged, walking back from today (today not
    // having a session yet doesn't break the streak — it just hasn't continued).
    let currentStreak = 0;
    for (let i = 0; i < 365; i++) {
      const d = localDateStr(new Date(today.getTime() - i * 86400000));
      if (gymDateSet.has(d)) currentStreak++;
      else if (d !== todayStr) break;
    }

    // Longest-ever streak within the last 365 days
    let longestStreak = 0, run = 0;
    for (let i = 364; i >= 0; i--) {
      const d = localDateStr(new Date(today.getTime() - i * 86400000));
      if (gymDateSet.has(d)) { run++; longestStreak = Math.max(longestStreak, run); }
      else run = 0;
    }

    const lastActiveDate = [...gymDateSet].sort().pop() ?? null;
    const daysSinceLast = lastActiveDate
      ? Math.floor((today.getTime() - new Date(lastActiveDate).getTime()) / 86400000)
      : null;

    // Weekly frequency over the last 8 full weeks (excluding the current, in-progress week)
    const WEEKS = 8;
    const weeklyCounts = [];
    for (let w = 1; w <= WEEKS; w++) {
      const [monStr, sunStr] = getWeekRange(today, w);
      const count = sessions.filter(s =>
        getSessionType(s.notes) !== 'rest' && s.date >= monStr && s.date <= sunStr
      ).length;
      weeklyCounts.push(count);
    }
    const weeksMeetingGoal = weeklyCounts.filter(c => c >= weeklyGoal).length;
    const consistencyPct = weeklyCounts.length > 0
      ? Math.round((weeksMeetingGoal / weeklyCounts.length) * 100)
      : 0;
    const avgPerWeek = weeklyCounts.length > 0
      ? weeklyCounts.reduce((a, b) => a + b, 0) / weeklyCounts.length
      : 0;

    // Same split for the prior 8-week block, to compare trend
    const prevWeeklyCounts = [];
    for (let w = WEEKS + 1; w <= WEEKS * 2; w++) {
      const [monStr, sunStr] = getWeekRange(today, w);
      const count = sessions.filter(s =>
        getSessionType(s.notes) !== 'rest' && s.date >= monStr && s.date <= sunStr
      ).length;
      prevWeeklyCounts.push(count);
    }
    const prevWeeksMeetingGoal = prevWeeklyCounts.filter(c => c >= weeklyGoal).length;
    const prevConsistencyPct = prevWeeklyCounts.length > 0
      ? Math.round((prevWeeksMeetingGoal / prevWeeklyCounts.length) * 100)
      : 0;

    // Busiest day of week, over all logged active sessions
    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    for (const d of activeDateSet) dowCounts[new Date(d + 'T00:00:00').getDay()]++;
    const maxDowCount = Math.max(...dowCounts);
    const busiestDow = maxDowCount > 0 ? DOW_NAMES[dowCounts.indexOf(maxDowCount)] : null;

    return {
      currentStreak,
      longestStreak,
      daysSinceLast,
      consistencyPct,
      prevConsistencyPct,
      avgPerWeek,
      busiestDow,
    };
  }, [sessions, activeDateSet, gymDateSet, today, weeklyGoal]);

  // Weekly-goal streak — distinct from the day-based gym streak above: counts
  // consecutive completed weeks (Mon-Sun) where active-session count >= weeklyGoal.
  const weekStreak = useMemo(() => {
    const weekMeetsGoal = (offset) => {
      const [monStr, sunStr] = getWeekRange(today, offset);
      const count = sessions.filter(s =>
        getSessionType(s.notes) !== 'rest' && s.date >= monStr && s.date <= sunStr
      ).length;
      return count >= weeklyGoal;
    };
    let current = 0;
    if (weekMeetsGoal(0)) current++;
    for (let w = 1; w <= 104; w++) {
      if (weekMeetsGoal(w)) current++;
      else break;
    }
    let longest = 0, run = 0;
    for (let w = 104; w >= 0; w--) {
      if (weekMeetsGoal(w)) { run++; longest = Math.max(longest, run); }
      else run = 0;
    }
    return { current, longest: Math.max(longest, current) };
  }, [sessions, weeklyGoal, today]);

  const insights = useMemo(() => {
    const out = [];
    const c = consistency;
    if (c.consistencyPct > c.prevConsistencyPct) {
      out.push({ icon: '📈', text: 'Consistency is up ', bold: `${c.consistencyPct - c.prevConsistencyPct}%`, rest: ' vs the previous 8 weeks — keep the momentum going.' });
    } else if (c.consistencyPct < c.prevConsistencyPct) {
      out.push({ icon: '📉', text: 'Consistency dipped ', bold: `${c.prevConsistencyPct - c.consistencyPct}%`, rest: ' vs the previous 8 weeks.' });
    }
    if (c.currentStreak >= c.longestStreak && c.currentStreak > 0) {
      out.push({ icon: '🔥', text: 'You\'re on your ', bold: 'best-ever streak', rest: ` at ${c.currentStreak} day${c.currentStreak === 1 ? '' : 's'} — don\'t break it now!` });
    } else if (c.longestStreak > c.currentStreak && c.currentStreak > 0) {
      out.push({ icon: '🎯', text: `${c.longestStreak - c.currentStreak} more day${c.longestStreak - c.currentStreak === 1 ? '' : 's'} `, bold: 'ties your record', rest: ` of ${c.longestStreak} days.` });
    }
    if (c.daysSinceLast != null && c.daysSinceLast >= 3) {
      out.push({ icon: '⚠️', text: 'It\'s been ', bold: `${c.daysSinceLast} days`, rest: ' since your last workout — time to get back in.' });
    }
    if (c.busiestDow) {
      out.push({ icon: '📅', text: 'You train most often on ', bold: c.busiestDow, rest: ` — averaging ${c.avgPerWeek.toFixed(1)} sessions/week overall.` });
    }
    // Forecast: can the weekly goal still be hit with the days remaining this week?
    const doneThisWeek = weekDays.filter(d => d.type && d.type !== 'rest' && !d.isFuture).length;
    const daysLeftThisWeek = weekDays.filter(d => d.isFuture).length + (weekDays.find(d => d.isToday && !d.type) ? 1 : 0);
    const remaining = weeklyGoal - doneThisWeek;
    if (remaining > 0 && remaining <= daysLeftThisWeek) {
      out.push({ icon: '✅', text: 'On pace — ', bold: `${remaining} more session${remaining === 1 ? '' : 's'}`, rest: ` this week hits your goal of ${weeklyGoal}.` });
    } else if (remaining > daysLeftThisWeek) {
      out.push({ icon: '🚨', text: 'Goal at risk — only ', bold: `${daysLeftThisWeek} day${daysLeftThisWeek === 1 ? '' : 's'} left`, rest: ` to log ${remaining} more session${remaining === 1 ? '' : 's'} for your ${weeklyGoal}/week goal.` });
    }
    return out;
  }, [consistency, weekDays, weeklyGoal]);

  const RANGE_DAYS = { '30D': 30, '60D': 60, '90D': 90, 'ALL': Infinity };
  const trendData = useMemo(() => {
    const days = RANGE_DAYS[trendRange];
    const cutoff = days === Infinity ? null : localDateStr(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
    const inRange = sessions
      .filter(s => getSessionType(s.notes) !== 'rest')
      .filter(s => !cutoff || s.date >= cutoff)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    return inRange.map(s => ({ date: s.date, vol: s.total_volume ?? calcSessionVol(s) }));
  }, [sessions, trendRange]);

  const trendStats = useMemo(() => {
    if (trendData.length < 2) return null;
    const vols = trendData.map(e => e.vol);
    const totalVol = vols.reduce((s, v) => s + v, 0);
    const avgVol = Math.round(totalVol / vols.length);
    const bestVol = Math.max(...vols);
    const span = Math.max(1, Math.round((new Date(trendData[trendData.length - 1].date) - new Date(trendData[0].date)) / 86400000)) + 1;
    return { avgVol, bestVol, totalVol, sessionCount: trendData.length, totalDays: span };
  }, [trendData]);

  const filteredSessions = useMemo(() => {
    return sessions.filter(s => {
      const d = new Date(s.date);
      return d.getFullYear() === viewYear && d.getMonth() + 1 === viewMonth;
    });
  }, [sessions, viewYear, viewMonth]);

  const dayList = useMemo(() => generateDayList(filteredSessions), [filteredSessions]);

  const visibleDayList = useMemo(() => {
    if (!hideRestDays) return dayList;
    return dayList.filter(item => {
      if (item.type === 'rest') return false;
      return getSessionType(item.session?.notes) !== 'rest';
    });
  }, [dayList, hideRestDays]);

  const canGoNext = viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth < today.getMonth() + 1);

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (!canGoNext) return;
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const openDetail = (session) => {
    const live = sessions.find(s => s.id === session.id) ?? session;
    setDetailSession(live);
    setShowDetail(true);
  };

  const openEdit = (session) => {
    setEditIsNew(false);
    setEditInitial({
      sessionId: session.id,
      date: session.date,
      name: session.notes ?? '',
      exercises: (session.workout_exercises ?? [])
        .slice().sort((a, b) => a.order_index - b.order_index)
        .map(ex => ({
          _key: ex.id,
          name: ex.exercise_name,
          sets: (ex.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
            .map(s => ({
              _key: s.id,
              weight_kg: s.weight_kg != null ? String(s.weight_kg) : '',
              reps: s.reps != null ? String(s.reps) : '',
              rpe: s.rpe != null ? String(s.rpe) : '',
              duration_min: s.duration_min != null ? String(s.duration_min) : '',
              distance_km: s.distance_km != null ? String(s.distance_km) : '',
              avg_rpm: s.avg_rpm != null ? String(s.avg_rpm) : '',
              speed_kmh: s.speed_kmh != null ? String(s.speed_kmh) : '',
              incline_pct: s.incline_pct != null ? String(s.incline_pct) : '',
              calories: s.calories != null ? String(s.calories) : '',
            })),
        })),
    });
    setShowDetail(false);
    setShowEdit(true);
  };

  const openNew = () => {
    setEditIsNew(true);
    setEditInitial({ sessionId: null, date: today.toISOString().split('T')[0], name: '', exercises: [] });
    setShowEdit(true);
  };

  const handleRepeat = (session) => {
    setEditIsNew(true);
    setEditInitial({
      sessionId: null,
      date: today.toISOString().split('T')[0],
      name: session.notes ?? '',
      exercises: (session.workout_exercises ?? [])
        .slice().sort((a, b) => a.order_index - b.order_index)
        .map(ex => ({ _key: tid(), name: ex.exercise_name, sets: [{ _key: tid(), weight_kg: '', reps: '' }] })),
    });
    setShowDetail(false);
    setShowEdit(true);
  };

  const confirmDelete = (sessionId) => {
    Alert.alert('Delete Workout', 'Remove this session and all data?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(sessionId) },
    ]);
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <ScreenHeader title="WORKOUT" colors={colors} right={<Text style={s.sessionCount}>{sessions.length} SESSIONS</Text>} />

      {/* Month nav */}
      <View style={s.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={s.monthBtn}>
          <Text style={s.monthChevron}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowMonthPicker(true)}>
          <Text style={s.monthLabel}>{MONTH_FULL[viewMonth - 1]} {viewYear}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={nextMonth} style={s.monthBtn} disabled={!canGoNext}>
          <Text style={[s.monthChevron, !canGoNext && { color: colors.textDim }]}>›</Text>
        </TouchableOpacity>
      </View>

      <MonthYearPicker
        visible={showMonthPicker}
        month={viewMonth - 1}
        year={viewYear}
        onSelect={(m, y) => { setViewMonth(m + 1); setViewYear(y); }}
        onClose={() => setShowMonthPicker(false)}
      />

      {/* List */}
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {isLoading && <SkeletonScreen cards={4} linesPerCard={3} />}

        {!isLoading && (
          <>
            {/* Hero stats — sessions & consistency first, volume secondary */}
            <View style={s.card}>
              <View style={s.heroHeaderRow}>
                <View style={{ flex: 1 }}>
                  <View style={s.heroTopRow}>
                    <Text style={s.heroNum}>{heroStats.sessionCount}</Text>
                    <Text style={s.heroLabel}>workout sessions</Text>
                  </View>
                  <Text style={s.heroSub}>this month · {heroStats.totalVol.toLocaleString()} kg total volume</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <TouchableOpacity
                    style={s.goalPillBtn}
                    onPress={() => { if (!isPro) { setShowToolsPaywall(true); return; } setWorkoutGoalInput(weeklyGoal); setShowWorkoutGoalSheet(true); }}
                  >
                    <Text style={s.goalPillBtnText}>🎯 {weeklyGoal}/wk</Text>
                    <Ionicons name={isPro ? 'pencil' : 'lock-closed'} size={11} color={colors.accent} />
                  </TouchableOpacity>
                  {weekStreak.current > 0 && (
                    <View style={s.weekStreakPill}>
                      <Text style={s.weekStreakPillText}>🔥 {weekStreak.current}wk streak</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={s.tileRow}>
                <View style={s.tile}>
                  <Text style={s.tileVal}>🔥 {consistency.currentStreak}</Text>
                  <Text style={s.tileLbl}>DAY STREAK</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.totalSets}</Text>
                  <Text style={s.tileLbl}>TOTAL SETS</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.avgRpe ?? '—'}</Text>
                  <Text style={s.tileLbl}>AVG RPE</Text>
                </View>
              </View>
              <View style={[s.tileRow, s.tileRow2]}>
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.avgVolPerSession.toLocaleString()}</Text>
                  <Text style={s.tileLbl}>AVG VOL/SESSION</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.heaviestLift > 0 ? `${heroStats.heaviestLift}kg` : '—'}</Text>
                  <Text style={s.tileLbl}>HEAVIEST LIFT</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.muscleGroupsHit}</Text>
                  <Text style={s.tileLbl}>MUSCLE GROUPS</Text>
                </View>
              </View>
              {heroStats.pbCount > 0 && (
                <View style={s.pbInlineRow}>
                  <Text style={{ fontSize: 14 }}>🏆</Text>
                  <Text style={s.pbInlineLabel}>{heroStats.pbCount} personal best{heroStats.pbCount > 1 ? 's' : ''} this month</Text>
                </View>
              )}
            </View>

            {/* Analysis & Insights — Pro */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>ANALYSIS & INSIGHTS</Text>
                <View style={s.proBadge}><Text style={s.proBadgeText}>PRO</Text></View>
              </View>

              <View style={s.tileRow}>
                <View style={s.tile}>
                  <Text style={s.tileVal}>{hasAccess ? consistency.longestStreak : '●●'}</Text>
                  <Text style={s.tileLbl}>BEST STREAK</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{hasAccess ? `${consistency.consistencyPct}%` : '●●%'}</Text>
                  <Text style={s.tileLbl}>8-WK CONSISTENCY</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{hasAccess ? consistency.avgPerWeek.toFixed(1) : '●.●'}</Text>
                  <Text style={s.tileLbl}>AVG / WEEK</Text>
                </View>
              </View>

              {hasAccess ? (
                insights.length > 0 && (
                  <View style={s.insightsList}>
                    {insights.map((ins, i) => (
                      <View key={i} style={s.insightRow}>
                        <Text style={s.insightIcon}>{ins.icon}</Text>
                        <Text style={s.insightText}>
                          {ins.text}<Text style={s.insightBold}>{ins.bold}</Text>{ins.rest}
                        </Text>
                      </View>
                    ))}
                  </View>
                )
              ) : (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowInsightsPaywall(true)}>
                  <View style={s.insightsList}>
                    {[['📈', 0.92], ['🔥', 0.68], ['📅', 0.8]].map(([icon, w], i) => (
                      <View key={i} style={s.insightRow}>
                        <Text style={s.insightIcon}>{icon}</Text>
                        <View style={[s.skeletonBar, { width: `${w * 100}%` }]} />
                      </View>
                    ))}
                  </View>
                  <Text style={s.lockedHint}>
                    🔒 Unlock your streak record, consistency score, and personalized training insights
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* This Week vs Last Week — session count, the consistency-first framing */}
            {isViewingCurrentMonth && (
              <View style={s.weekCompareCardMerged}>
                <View style={s.weekCompareCell}>
                  <Text style={s.weekCompareTitle}>THIS WEEK</Text>
                  <Text style={s.weekCompareVal}>{weekCompare.thisGymCount} / {weeklyGoal} sessions</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textMuted }]}>{weekCompare.thisCardioCount} cardio</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textMuted }]}>{weekCompare.thisVol.toLocaleString()} kg volume</Text>
                </View>
                <View style={s.weekCompareDivider} />
                <View style={s.weekCompareCell}>
                  <Text style={s.weekCompareTitle}>LAST WEEK</Text>
                  <Text style={[s.weekCompareVal, { color: colors.textMuted }]}>{weekCompare.lastGymCount} sessions</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textDim }]}>{weekCompare.lastCardioCount} cardio</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textDim }]}>{weekCompare.lastVol.toLocaleString()} kg volume</Text>
                </View>
              </View>
            )}

            {/* Week Volume bar chart */}
            {isViewingCurrentMonth && (
              <View style={s.card}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardTitle}>WEEK VOLUME</Text>
                </View>
                <View style={s.legendRow}>
                  <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.accent }]} /><Text style={s.legendLabel}>Gym</Text></View>
                  <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.blue }]} /><Text style={s.legendLabel}>Cardio</Text></View>
                  <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.good }]} /><Text style={s.legendLabel}>Rest</Text></View>
                </View>
                <WorkoutWeekBarChart days={weekDays} colors={colors} width={chartWidth} />
              </View>
            )}

            {/* Monthly heatmap */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>MONTHLY HEATMAP</Text>
              </View>
              <View style={s.legendRow}>
                <View style={s.legendItem}><Ionicons name="barbell-outline" size={11} color={colors.accent} /><Text style={s.legendLabel}>Gym</Text></View>
                <View style={s.legendItem}><Ionicons name="bicycle-outline" size={11} color={colors.blue} /><Text style={s.legendLabel}>Cardio</Text></View>
                <View style={s.legendItem}><Ionicons name="moon-outline" size={11} color={colors.good} /><Text style={s.legendLabel}>Rest</Text></View>
              </View>
              <WorkoutHeatmap
                sessionsByDate={heatmapByDate}
                colors={colors}
                month={viewMonth - 1}
                year={viewYear}
                hasAccess={hasAccess}
                onLockedPress={() => setShowToolsPaywall(true)}
                onDayPress={openDetailForDate}
              />
              {!hasAccess && (
                <Text style={s.lockedHint}>🔒 Unlock full workout history beyond the last 14 days</Text>
              )}
            </View>

            {/* Volume trend */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>VOLUME TREND</Text>
              </View>
              <View style={s.segmentRow}>
                {['30D', '60D', '90D', 'ALL'].map(r => {
                  const locked = !hasAccess && r !== '30D';
                  return (
                    <TouchableOpacity
                      key={r}
                      style={[s.segmentBtn, trendRange === r && s.segmentBtnActive]}
                      onPress={() => locked ? setShowTrendPaywall(true) : setTrendRange(r)}
                    >
                      <Text style={[s.segmentText, trendRange === r && s.segmentTextActive]}>
                        {r}{locked ? ' 🔒' : ''}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.legendRow}>
                <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.purple }]} /><Text style={s.legendLabel}>Daily</Text></View>
                <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.accent }]} /><Text style={s.legendLabel}>7D Avg</Text></View>
              </View>
              <VolumeTrendChart data={trendData} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={s.trendStatsRow}>
                  <WeekStatCell value={trendStats.avgVol.toLocaleString()} label="AVG/SESSION" color={colors.accent} colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={`${trendStats.sessionCount}/${trendStats.totalDays}`} label="SESSIONS" color={colors.good} colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={trendStats.bestVol.toLocaleString()} label="BEST" color="#22d3ee" colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={trendStats.totalVol.toLocaleString()} label="TOTAL" color={colors.text} colors={colors} />
                </View>
              )}
            </View>

            {/* Muscle Group Volume + Auto-Deload — Pro */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>MUSCLE GROUP VOLUME · THIS WEEK</Text>
                <View style={s.proBadge}><Text style={s.proBadgeText}>PRO</Text></View>
              </View>

              {muscleExpanded && (hasAccess ? (
                <>
                  {deload && (
                    <View style={s.deloadBanner}>
                      <Text style={s.deloadBannerText}>
                        ⚠️ Avg RPE {deload.avg} over your last 3 sessions — consider a deload week.
                      </Text>
                    </View>
                  )}
                  {overtraining && (
                    <View style={s.deloadBanner}>
                      <Text style={s.deloadBannerText}>
                        🔥 {overtraining.muscle} trained {overtraining.days} days in a row with no rest — risk of overtraining.
                      </Text>
                    </View>
                  )}
                  {muscleVolume.length > 0 ? (
                    <>
                      <BodyHeatmap data={muscleVolume} color={colors.purple} width={180} height={290} />
                      <View style={[s.muscleBarList, { marginTop: 14 }]}>
                        {muscleVolume.map(({ muscle, vol }) => {
                          const max = muscleVolume[0].vol || 1;
                          return (
                            <View key={muscle} style={s.muscleBarRow}>
                              <Text style={s.muscleBarLabel}>{muscle}</Text>
                              <View style={s.muscleBarTrack}>
                                <View style={[s.muscleBarFill, { width: `${Math.max(6, (vol / max) * 100)}%` }]} />
                              </View>
                              <Text style={s.muscleBarVal}>{vol.toLocaleString()}kg</Text>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  ) : (
                    <Text style={s.lockedHint}>Log a gym session this week to see your muscle group balance.</Text>
                  )}
                </>
              ) : (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowToolsPaywall(true)}>
                  <View style={s.muscleBarList}>
                    {['Chest', 'Back', 'Legs'].map(m => (
                      <View key={m} style={s.muscleBarRow}>
                        <Text style={s.muscleBarLabel}>{m}</Text>
                        <View style={s.muscleBarTrack}>
                          <View style={[s.muscleBarFill, { width: '40%', opacity: 0.3 }]} />
                        </View>
                        <Text style={s.muscleBarVal}>●●●kg</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={s.lockedHint}>
                    🔒 Unlock muscle group balance, deload alerts, exercise swaps, progressive overload targets, auto-regulation, and saved templates
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                onPress={() => setMuscleExpanded(v => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: muscleExpanded ? 12 : 0 }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.accent }}>
                  {muscleExpanded ? 'Collapse' : 'Expand'}
                </Text>
                <Ionicons name={muscleExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.accent} />
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>WORKOUT HISTORY</Text>
            <TouchableOpacity onPress={toggleHideRestDays} style={s.collapseToggleWrap} activeOpacity={0.75}>
              <Text style={s.collapseToggleText}>
                {hasAccess ? (hideRestDays ? 'SHOW ALL' : 'HIDE REST DAYS') : '🔒 HIDE REST DAYS'}
              </Text>
              <View style={[s.toggleSwitch, hideRestDays && s.toggleSwitchOn]}>
                <View style={[s.toggleKnob, hideRestDays && s.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

        {!isLoading && visibleDayList.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="barbell-outline" size={52} color={colors.textDim} />
            <Text style={s.emptyTitle}>
              {dayList.length === 0
                ? `No sessions in ${MONTH_NAMES[viewMonth - 1]} ${viewYear}`
                : 'All sessions this month are rest days'}
            </Text>
            <Text style={s.emptySub}>Tap + to log a workout</Text>
          </View>
        )}

        {visibleDayList.map(item => {
          if (item.type === 'rest') {
            return (
              <TouchableOpacity
                key={item.date}
                style={s.restCard}
                onPress={() => {
                  setEditIsNew(true);
                  setEditInitial({ sessionId: null, date: item.date, name: 'Rest Day', exercises: [] });
                  setShowEdit(true);
                }}
                activeOpacity={0.75}
              >
                <View style={s.restIcon}>
                  <Text style={{ fontSize: 20 }}>😴</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.restTitle}>Rest Day</Text>
                  <Text style={s.restSub}>{fmtDate(item.date)} · Recovery · no workout</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.good} />
              </TouchableOpacity>
            );
          }

          const sess = item.session;
          const ws   = getWorkoutStyle(sess.notes, colors);
          const vol  = sess.total_volume ?? calcSessionVol(sess);
          const delta = vol > 0 ? getVolumeDelta(sess, sessions) : null;
          const exs  = sess.workout_exercises ?? [];

          // Subtitle: cardio (vol=0) → show ex names; weighted → show count + vol
          let subtitle = fmtDate(sess.date);
          if (vol === 0 && exs.length > 0) {
            const names = exs.slice(0, 2).map(e => e.exercise_name).filter(Boolean).join(', ');
            const more = exs.length > 2 ? ` +${exs.length - 2}` : '';
            subtitle += ` · ${names}${more}`;
            if (sess.duration_min) subtitle += ` · ${sess.duration_min}min`;
            if (sess.calories_burned) subtitle += ` · 🔥${sess.calories_burned}kcal`;
          } else {
            if (exs.length > 0) subtitle += ` · ${exs.length}ex`;
            if (vol > 0) subtitle += ` · ${vol.toLocaleString()}kg`;
            if (sess.calories_burned) subtitle += ` · 🔥${sess.calories_burned}kcal`;
          }

          return (
            <TouchableOpacity
              key={sess.id}
              style={[s.sessionCard, { backgroundColor: ws.cardBg, borderColor: ws.cardBorder }]}
              onPress={() => openDetail(sess)}
              activeOpacity={0.82}
            >
              <View style={[s.sessionIcon, { backgroundColor: ws.iconBg, borderColor: ws.cardBorder }]}>
                <Text style={{ fontSize: 18 }}>{ws.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.sessionNameRow}>
                  <Text style={[s.sessionName, { color: ws.titleColor }]} numberOfLines={1}>
                    {sess.notes || 'Workout'}
                  </Text>
                  {delta && (
                    <View style={[s.deltaBadge, { backgroundColor: delta.delta >= 0 ? colors.good + '22' : colors.danger + '22' }]}>
                      <Text style={[s.deltaText, { color: delta.delta >= 0 ? colors.success : colors.danger }]}>
                        {delta.delta >= 0 ? '▲' : '▼'}{Math.abs(delta.delta).toLocaleString()}kg
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={s.sessionSub} numberOfLines={1}>{subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.textDim} />
            </TouchableOpacity>
          );
        })}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={openNew} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      <SessionDetailModal
        session={detailSession}
        pbMap={pbMap}
        allSessions={sessions}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => openEdit(detailSession)}
        onRepeat={() => handleRepeat(detailSession)}
        onDelete={() => confirmDelete(detailSession?.id)}
      />

      <EditSessionModal
        visible={showEdit}
        isNew={editIsNew}
        initialData={editInitial}
        recentTypes={recentTypes}
        allSessions={sessions}
        onSave={(data) => saveMut.mutate({ ...data, sessionId: editInitial?.sessionId ?? null })}
        onCancel={() => setShowEdit(false)}
        isSaving={saveMut.isPending}
        hasAccess={hasAccess}
        templates={templates}
        onSaveTemplate={(params) => saveTemplateMut.mutate(params)}
        onRepeatTemplate={(params) => repeatTemplateMut.mutate(params)}
        isRepeatingTemplate={repeatTemplateMut.isPending}
        onOpenToolsPaywall={() => setShowToolsPaywall(true)}
      />

      <PaywallModal visible={showTrendPaywall} onClose={() => setShowTrendPaywall(false)} />
      <PaywallModal visible={showInsightsPaywall} onClose={() => setShowInsightsPaywall(false)} />
      <PaywallModal visible={showToolsPaywall} onClose={() => setShowToolsPaywall(false)} />

      <BottomSheet visible={showWorkoutGoalSheet} onClose={() => setShowWorkoutGoalSheet(false)} style={s.goalSheet}>
        <View style={s.goalSheetHeader}>
          <Text style={s.goalSheetTitle}>🎯 WEEKLY WORKOUT GOAL</Text>
          <TouchableOpacity onPress={() => setShowWorkoutGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={s.goalBigVal}>{workoutGoalInput}</Text>
        <Text style={s.goalBigSub}>session{workoutGoalInput === 1 ? '' : 's'} / week</Text>

        <Text style={s.goalFieldLabel}>DAYS PER WEEK</Text>
        <View style={s.goalChipRow}>
          {[1, 2, 3, 4, 5, 6, 7].map(n => (
            <TouchableOpacity
              key={n}
              style={[s.goalChip, workoutGoalInput === n && { backgroundColor: colors.accent }]}
              onPress={() => setWorkoutGoalInput(n)}
            >
              <Text style={[s.goalChipText, workoutGoalInput === n && { color: colors.bg }]}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.goalHint}>Drives your streak, consistency %, and weekly goal across the app. Cardio days don't count toward this goal.</Text>

        <TouchableOpacity
          style={s.goalSaveBtn}
          onPress={() => goalMut.mutate(workoutGoalInput)}
          disabled={goalMut.isPending}
        >
          <Text style={s.saveBtnText}>{goalMut.isPending ? 'Saving…' : 'Save Goal'}</Text>
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const createS = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 18, padding: 16, marginBottom: 14,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted, fontWeight: weight.bold, flexShrink: 1, marginRight: 8 },
  collapseToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  collapseToggleText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1 },
  toggleSwitch: {
    width: 34, height: 18, borderRadius: 9, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, padding: 2, justifyContent: 'center',
  },
  toggleSwitchOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textDim },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },

  heroHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  goalPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accent + '1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent + '66',
  },
  goalPillBtnText: { fontSize: 13, fontWeight: weight.bold, color: colors.accent },
  weekStreakPill: {
    backgroundColor: colors.purple + '1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.purple + '55',
  },
  weekStreakPillText: { fontSize: 11, fontWeight: weight.bold, color: colors.purple },
  goalSheet: {},
  goalSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  goalSheetTitle: { fontSize: 15, fontWeight: weight.bold, color: colors.text, letterSpacing: 0.5 },
  goalBigVal: { fontSize: 38, fontWeight: weight.black, color: colors.text, textAlign: 'center', marginTop: 8 },
  goalBigSub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 16 },
  goalFieldLabel: { fontSize: 11, color: colors.textMuted, fontWeight: weight.semibold, marginBottom: 10, letterSpacing: 0.5 },
  goalChipRow: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  goalChip: {
    flex: 1, minWidth: 36, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
    backgroundColor: colors.bgElevated ?? colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  goalChipText: { color: colors.text, fontWeight: weight.semibold, fontSize: 13 },
  goalHint: { fontSize: 11, color: colors.textDim, marginBottom: 16, lineHeight: 16 },
  goalSaveBtn: { padding: 14, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center' },

  heroTopRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 2 },
  heroNum: { fontSize: 38, fontWeight: weight.black, color: colors.accent },
  heroLabel: { fontSize: 13, color: colors.textMuted, fontWeight: weight.bold },
  heroSub: { fontSize: 12, color: colors.textDim, marginBottom: 14 },
  tileRow: { flexDirection: 'row' },
  tileRow2: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tileColDivider: { width: 1, backgroundColor: colors.border },
  tileVal: { fontSize: 18, fontWeight: weight.black, color: colors.text },
  tileLbl: { fontSize: 10, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  pbInlineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  pbInlineLabel: { fontSize: 12, color: colors.textMuted, fontWeight: weight.bold },

  weekCompareCardMerged: {
    flexDirection: 'row', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 18, marginBottom: 14, overflow: 'hidden',
  },
  weekCompareCell: { flex: 1, padding: 14 },
  weekCompareDivider: { width: 1, backgroundColor: colors.border },
  weekCompareTitle: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textDim, marginBottom: 6 },
  weekCompareVal: { fontSize: 22, fontWeight: weight.black, color: colors.text, marginBottom: 8 },
  weekCompareSub: { fontSize: 11, fontWeight: weight.bold },

  legendRow: { flexDirection: 'row', gap: 14, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 9, height: 9, borderRadius: 3 },
  legendLabel: { fontSize: 11, color: colors.textMuted },
  trendStatsRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 8 },
  statDividerInline: { width: 1, height: 24, backgroundColor: colors.border },

  segmentRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 10, backgroundColor: colors.dim },
  segmentBtnActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 12, fontWeight: weight.bold, color: colors.textMuted },
  segmentTextActive: { color: colors.accentText },

  proBadge: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  proBadgeText: { fontSize: 9, fontWeight: weight.black, color: colors.accentText, letterSpacing: 0.5 },
  lockedHint: { fontSize: 12, color: colors.textMuted, marginTop: 12, lineHeight: 17 },

  deloadBanner: {
    backgroundColor: colors.danger + '14', borderWidth: 1, borderColor: colors.danger + '55',
    borderRadius: 10, padding: 10, marginBottom: 12,
  },
  deloadBannerText: { fontSize: typography.xs, color: colors.danger, fontWeight: weight.semibold },
  muscleBarList: { gap: 10 },
  muscleBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muscleBarLabel: { width: 64, fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
  muscleBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  muscleBarFill: { height: 8, borderRadius: 4, backgroundColor: colors.purple },
  muscleBarVal: { width: 64, textAlign: 'right', fontSize: typography.xs, color: colors.textDim },
  insightsList: { marginTop: 14, gap: 10 },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  insightIcon: { fontSize: 14, marginTop: 1 },
  insightText: { flex: 1, fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  skeletonBar: { flex: 0, height: 12, marginTop: 3, borderRadius: 4, backgroundColor: colors.dim, borderWidth: 1, borderColor: colors.border },
  insightBold: { fontWeight: weight.bold, color: colors.text },

  appHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  },
  logoText: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.accent },
  screenLabel: { fontSize: typography.xs, fontWeight: weight.bold, letterSpacing: 2, color: colors.textMuted },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },

  sessionCount: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.textMuted, letterSpacing: 1.5 },

  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, marginBottom: 4,
  },
  monthBtn: { padding: 6 },
  monthChevron: { fontSize: 22, color: colors.text, fontWeight: '300' },
  monthLabel: { fontSize: typography.sm, fontFamily: fontFamily.displayItalic, color: colors.text, fontStyle: 'italic' },

  content: { paddingHorizontal: 16, paddingBottom: 32 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim },

  restCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.good + '14', borderWidth: 1, borderColor: colors.good + '55',
    borderRadius: 14, padding: 12, marginBottom: 8,
  },
  restIcon: {
    width: 44, height: 44, borderRadius: 11, backgroundColor: colors.good + '22',
    borderWidth: 1, borderColor: colors.good + '55', alignItems: 'center', justifyContent: 'center',
  },
  restTitle: { fontSize: typography.sm, fontFamily: fontFamily.bodyBold, color: colors.good },
  restSub: { fontSize: typography.xs, color: colors.good, marginTop: 2 },

  sessionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 12, padding: 9, marginBottom: 6,
  },
  sessionIcon: {
    width: 36, height: 36, borderRadius: 9, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  sessionNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1, flexWrap: 'wrap' },
  sessionName: { fontSize: typography.sm, fontWeight: weight.bold },
  deltaBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  deltaText: { fontSize: 10, fontWeight: weight.bold },
  sessionSub: { fontSize: 11, color: colors.textDim },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },
});

const createDS = (colors) => StyleSheet.create({
  popup: {},

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: -16, paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  typeIconBox: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerName: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  headerDate: { fontSize: typography.xs, color: colors.textMuted, marginTop: 1 },
  closeBtn: { padding: 6, borderRadius: 18, backgroundColor: colors.surface },

  statsRow: { flexDirection: 'row', marginHorizontal: -16, borderBottomWidth: 1, borderBottomColor: colors.border },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: colors.border },
  statValue: { fontSize: typography.md, fontFamily: fontFamily.monoBold, color: colors.text, marginTop: 1 },
  statLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginTop: 1 },

  restInfoRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 14, marginTop: 10, paddingVertical: 10,
  },
  restInfoCell: { flex: 1, alignItems: 'center' },
  restInfoValue: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text, marginTop: 2 },
  restInfoDivider: { width: 1, height: 30, backgroundColor: colors.border },
  restCallout: { alignItems: 'center', paddingVertical: 18 },
  restCalloutTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.good, marginTop: 8 },
  restCalloutSub: {
    fontSize: typography.sm, color: colors.textMuted, marginTop: 4, textAlign: 'center', lineHeight: 19,
  },

  tagScroll: { maxHeight: 30 },
  tagRow: { paddingHorizontal: 16, gap: 6, paddingVertical: 2, alignItems: 'center' },
  muscleTag: {
    backgroundColor: colors.accent + '14', borderWidth: 1, borderColor: colors.accent + '40',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
  },
  muscleTagText: { fontSize: 11, color: colors.accent, fontWeight: weight.medium },

  exScroll: { paddingHorizontal: 16 },
  exSectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 10, marginBottom: 6,
  },
  exLabel: { fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5 },
  collapseToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  collapseToggleText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1 },
  toggleSwitch: {
    width: 34, height: 18, borderRadius: 9, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 2,
  },
  toggleSwitchOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textDim },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },

  exCard: {
    backgroundColor: colors.card, borderRadius: 12, padding: 10,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  exCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exIcon: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  exName: { fontSize: typography.sm, fontFamily: fontFamily.bodyExtraBold, color: colors.text, letterSpacing: 0.3 },
  exMuscleRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  exMuscleTag: { fontSize: 10, color: colors.textDim, fontWeight: weight.medium },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pillChip: { backgroundColor: colors.dim, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  pillChipText: { fontFamily: fontFamily.bodyBold, fontSize: typography.xs, color: colors.text },
  pbBadge: {
    backgroundColor: colors.accent + '14', borderWidth: 1, borderColor: colors.accent + '55',
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  pbBadgeText: { fontSize: 10, color: colors.accent, fontWeight: weight.bold },

  setTableHdr: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 4,
    borderBottomWidth: 1, borderBottomColor: colors.surface, marginBottom: 4,
  },
  setTH: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 1, textAlign: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  bestSetRow: { backgroundColor: colors.accent + '14', borderRadius: 8, marginHorizontal: -4, paddingHorizontal: 4 },
  setNum: { width: 32, fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.bold },
  setDotWrap: { width: 20, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  setWeight: { flex: 1, fontSize: typography.sm, color: colors.text, fontFamily: fontFamily.monoBold, textAlign: 'center' },
  setXText: { fontSize: typography.xs, color: colors.textDim, marginHorizontal: 4 },
  setReps: { flex: 1, fontSize: typography.sm, color: colors.text, fontFamily: fontFamily.monoBold, textAlign: 'center' },
  bestBadge: { backgroundColor: colors.accent + '22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  bestBadgeText: { fontSize: 10, color: colors.accent, fontWeight: weight.bold },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 11, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  editBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  repeatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 11, borderRadius: 12, backgroundColor: colors.good,
  },
  repeatBtnText: { fontSize: typography.sm, fontFamily: fontFamily.bodyBold, color: colors.bg },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 11, borderRadius: 12, backgroundColor: colors.danger + '1f',
    borderWidth: 1, borderColor: colors.danger + '55',
  },
  deleteBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.danger },
});

const createES = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTop: { fontSize: typography.lg },
  headerLOG: { fontWeight: weight.black, fontStyle: 'italic', color: colors.text },
  headerSub: { fontWeight: weight.bold, fontStyle: 'italic', color: colors.accent },
  trackLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 2, marginTop: 2 },
  closeBtn: { padding: 6, borderRadius: 18, backgroundColor: colors.card, marginTop: 0 },

  toolsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginTop: 6, alignItems: 'center' },
  timerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accent + '14', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: colors.accent + '55',
  },
  timerPillText: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.monoBold },
  copyLastBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.purple + '14', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: colors.purple + '55',
  },
  copyLastBtnText: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.purple },
  durationOverrideRow: { paddingHorizontal: 16, marginTop: 4, marginBottom: 2 },
  durationOverrideLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  durationOverrideInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 9, color: colors.text, fontSize: typography.sm, maxWidth: 120,
  },
  prBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accent + '1a', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2,
    marginLeft: 24, marginTop: -2, marginBottom: 4, alignSelf: 'flex-start',
  },
  prBannerText: { fontSize: 9, fontWeight: weight.bold, color: colors.accent },

  typeScroll: { maxHeight: 42 },
  typeRow: { paddingHorizontal: 16, gap: 6, alignItems: 'center', paddingVertical: 6 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  typeChipActive: { borderColor: colors.accent, backgroundColor: colors.accent + '1a' },
  typeChipDefault: { borderColor: colors.accent + '55', backgroundColor: colors.accent + '12' },
  typeChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },
  typeChipTextActive: { color: colors.accent, fontWeight: weight.bold },
  typeChipTextDefault: { color: colors.accent + 'aa', fontWeight: weight.medium },

  fieldRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 6 },
  fieldCol: { flex: 1 },
  fieldLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginBottom: 3 },
  fieldInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, color: colors.text, fontSize: typography.sm,
  },
  datePickerBtn: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },

  exScroll: { flex: 1, paddingHorizontal: 16, marginTop: 8 },
  exCard: {
    backgroundColor: colors.card, borderRadius: 12, marginBottom: 6,
    overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
  },
  exCardActive: { borderColor: colors.accent, borderWidth: 1.5 },
  exCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  exNumBadge: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  exNumBadgeActive: { backgroundColor: colors.accent },
  exNumText: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted },
  exNumTextActive: { color: colors.bg },
  exCardName: { flex: 1, fontSize: typography.sm, fontWeight: weight.semibold, color: colors.textMuted },
  exCardNameActive: { color: colors.text },
  exSetsCount: { fontSize: typography.xs, color: colors.textDim },
  exDeleteBtn: { padding: 4 },
  exDeleteX: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.danger + '1f',
    borderWidth: 1, borderColor: colors.danger + '55', alignItems: 'center', justifyContent: 'center',
  },

  exExpanded: { borderTopWidth: 1, borderTopColor: colors.border, padding: 8 },
  exNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  hashIcon: {
    width: 28, height: 32, borderRadius: 8, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  hashText: { fontSize: typography.sm, color: colors.textDim, fontWeight: weight.bold },
  exNameInput: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7, color: colors.text, fontSize: typography.sm,
    borderWidth: 1, borderColor: colors.border,
  },

  setRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  setNumLabel: { width: 18, fontSize: typography.xs, color: colors.textDim, textAlign: 'center', fontWeight: weight.bold },
  setInput: {
    flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontSize: typography.sm,
    textAlign: 'center', borderWidth: 1, borderColor: colors.border,
  },
  setX: { fontSize: typography.sm, color: colors.textDim },
  setDeleteBtn: { padding: 4 },

  addSetBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 8,
    paddingVertical: 6, alignItems: 'center', marginTop: 2,
  },
  addSetText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },

  addExBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.accent,
    borderRadius: 12, padding: 10, marginTop: 2, marginBottom: 6,
  },
  addExText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent },

  bottomRow: {
    flexDirection: 'row', gap: 10, padding: 12,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  cancelText: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.textMuted },
  saveBtn: { flex: 2, padding: 12, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  saveBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg },

  restDayWrap: {
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, paddingVertical: 12, gap: 6,
  },
  restDayEmoji: { fontSize: 40 },
  restDayTitle: { fontSize: typography.lg, fontFamily: fontFamily.bodyExtraBold, color: colors.good, textAlign: 'center' },
  restDaySub: { fontSize: typography.xs, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  restDayBadges: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' },
  restBadge: {
    backgroundColor: colors.good + '14', borderWidth: 1, borderColor: colors.good + '55',
    borderRadius: 16, paddingHorizontal: 11, paddingVertical: 5,
  },
  restBadgeText: { fontSize: typography.xs, color: colors.good, fontFamily: fontFamily.bodyMedium },

  cardioHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.blue + '14', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: colors.blue + '55', marginBottom: 10,
  },
  cardioHintText: { fontSize: typography.xs, color: colors.blue, flex: 1 },

  acDropdown: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginTop: 4, marginBottom: 8, overflow: 'hidden' },
  acItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  acItemText: { fontFamily: fontFamily.bodyMedium, fontSize: typography.sm, color: colors.text },
  subHeader: { fontSize: 10, fontWeight: weight.bold, color: colors.purple, letterSpacing: 1, padding: 10, paddingBottom: 4 },

  swapBtn: {
    width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.purple + '1a', marginLeft: 4,
  },
  swapBtnText: { fontSize: 14 },

  prevPerfBox: {
    backgroundColor: colors.dim, borderRadius: 10, padding: 10, marginBottom: 10, gap: 4,
  },
  prevPerfText: { fontSize: typography.xs, color: colors.textMuted },
  prevPerfBold: { fontWeight: weight.bold, color: colors.text },
  suggestText: { fontSize: typography.xs, color: colors.accent },
  suggestTextLocked: { fontSize: typography.xs, color: colors.purple, fontWeight: weight.semibold },
  warmupRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  warmupLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 },
  warmupChip: {
    backgroundColor: colors.blue + '14', borderWidth: 1, borderColor: colors.blue + '55',
    borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4,
  },
  warmupChipText: { fontSize: typography.xs, color: colors.blue, fontWeight: weight.semibold },

  restBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.blue + '14', borderWidth: 1, borderColor: colors.blue + '55',
    borderRadius: 10, padding: 10, marginBottom: 10,
  },
  restBannerText: { fontSize: typography.sm, color: colors.blue, fontWeight: weight.bold },
  restBannerCancel: { fontSize: typography.xs, color: colors.textDim, fontWeight: weight.semibold },

  plateText: { fontSize: 9, color: colors.textDim, marginTop: -2, marginBottom: 2, marginLeft: 24, lineHeight: 12 },
  autoRegText: { fontSize: 9, color: colors.accent, marginTop: -2, marginBottom: 2, marginLeft: 24, lineHeight: 12 },
  oneRmText: { fontSize: 9, color: colors.purple, marginTop: -2, marginBottom: 2, marginLeft: 24, lineHeight: 12 },
  oneRmTextLocked: { fontSize: 9, color: colors.textDim, marginTop: -2, marginBottom: 2, marginLeft: 24, lineHeight: 12, textDecorationLine: 'underline' },

  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  trendLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5 },
  trendVal: { fontSize: 10, fontWeight: weight.semibold, color: colors.accent },
  groupHint: {
    backgroundColor: colors.purple + '14', borderWidth: 1, borderColor: colors.purple + '55',
    borderRadius: 8, padding: 6, marginBottom: 6,
  },
  groupHintText: { fontSize: 10, color: colors.purple, fontWeight: weight.semibold },

  addSetRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  restBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.blue + '55', borderRadius: 8, backgroundColor: colors.blue + '14',
  },
  restBtnText: { fontSize: typography.xs, color: colors.blue, fontWeight: weight.semibold },

  templateRow: { marginBottom: 10, gap: 6 },
  templateRowLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1 },
  templateChip: {
    backgroundColor: colors.purple + '14', borderWidth: 1, borderColor: colors.purple + '55',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7,
  },
  templateChipText: { fontSize: typography.xs, color: colors.purple, fontWeight: weight.semibold },
  templateEmptyText: { fontSize: typography.xs, color: colors.textDim },
  programHintText: { fontSize: 10, color: colors.textDim, marginTop: 6 },
  programBox: {
    backgroundColor: colors.purple + '10', borderWidth: 1, borderColor: colors.purple + '40',
    borderRadius: 12, padding: 12, marginTop: 10,
  },
  programBoxTitle: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text, marginBottom: 10 },
  programWeekRow: { flexDirection: 'row', gap: 6 },
  programWeekChip: {
    flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dim,
  },
  programWeekChipActive: { backgroundColor: colors.purple },
  programWeekChipText: { fontSize: 11, fontWeight: weight.bold, color: colors.textMuted },
  programWeekChipTextActive: { color: '#fff' },
  programCreateBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: colors.purple,
  },
  programCreateBtnText: { fontSize: typography.xs, fontWeight: weight.bold, color: '#fff' },
  programCancelBtn: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.dim },
  programCancelBtnText: { fontSize: typography.xs, fontWeight: weight.semibold, color: colors.textMuted },

  saveTemplateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.purple + '66',
    borderRadius: 12, padding: 10, marginBottom: 8,
  },
  saveTemplateBtnText: { fontSize: typography.xs, fontWeight: weight.semibold, color: colors.purple },

  cardioFieldCard: { backgroundColor: colors.dim, borderRadius: 10, padding: 10, marginBottom: 8, gap: 8 },
  cardioFieldRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  cardioFieldCol: { flex: 1 },
  cardioFieldLabel: { fontFamily: fontFamily.bodyBold, fontSize: 9, color: colors.textDim, letterSpacing: 0.4, marginBottom: 4 },
  cardioAutoValue: { fontFamily: fontFamily.monoBold, fontSize: typography.sm, color: colors.pink, paddingVertical: 6 },
});

