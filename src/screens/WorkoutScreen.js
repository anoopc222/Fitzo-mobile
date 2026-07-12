import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
  Modal, KeyboardAvoidingView, Platform, Dimensions, findNodeHandle, UIManager, AppState,
  PanResponder, Image,
} from 'react-native';
import useExerciseDemo from '../hooks/useExerciseDemo';
import VoiceLogButton from '../components/VoiceLogButton';
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
import EmptyState from '../components/EmptyState';
import { useGatedExport } from '../hooks/useGatedExport';
import { useExportCard } from '../hooks/useExportCard';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { syncConditionalReminder } from '../lib/notifications';
import { haptics } from '../lib/haptics';

// ─── Data Layer ───────────────────────────────────────────────────────────────
async function fetchSessions(userId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`
      id, date, notes, coach_notes, total_volume, duration_min, calories_burned,
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

// ─── Workout Plans ────────────────────────────────────────────────────────────
async function fetchPlans(userId) {
  try {
    const { data, error } = await supabase
      .from('workout_plans')
      .select('id, name, created_at, template_exercises')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

async function createPlan(userId, name) {
  const { data, error } = await supabase
    .from('workout_plans')
    .insert({ user_id: userId, name: name.trim() })
    .select().single();
  if (error) throw error;
  return data;
}

async function copyPlan(userId, plan) {
  const newName = (plan.name ?? '').trim() + '_copy';
  const { data, error } = await supabase
    .from('workout_plans')
    .insert({ user_id: userId, name: newName, template_exercises: plan.template_exercises ?? null })
    .select().single();
  if (error) throw error;
  return data;
}

async function renamePlan(planId, newName) {
  const { error } = await supabase
    .from('workout_plans')
    .update({ name: newName.trim() })
    .eq('id', planId);
  if (error) throw error;
  // Also update notes on all sessions linked to this plan
  await supabase
    .from('workout_sessions')
    .update({ notes: newName.trim() })
    .eq('plan_id', planId);
}

async function deletePlan(planId, planName) {
  // Tag history sessions with _Deleted suffix, then unlink and delete the plan
  const tag = (planName ?? '').trim() + '_Deleted';
  await supabase.from('workout_sessions').update({ notes: tag, plan_id: null }).eq('plan_id', planId);
  const { error } = await supabase.from('workout_plans').delete().eq('id', planId);
  if (error) throw error;
}

async function updatePlanTemplate(planId, exercises) {
  const { error } = await supabase
    .from('workout_plans')
    .update({ template_exercises: exercises })
    .eq('id', planId);
  if (error) throw error;
}

async function linkSessionToPlan(sessionId, planId, planName) {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ plan_id: planId, notes: planName })
    .eq('id', sessionId);
  if (error) throw error;
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

// Parses a raw set's text-input fields into numeric DB-ready values. Shared by
// saveSession (real insert) and buildOptimisticSession (client-side preview),
// so the optimistic total_volume/sets match what the server will compute.
function computeSetRow(ex, s) {
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
  return { hasAny, weight_kg: wVal, reps: rVal, rpe: rpeVal, duration_min: durVal, distance_km: distVal,
    avg_rpm: rpmVal, speed_kmh: speedVal, incline_pct: inclineVal, calories: calVal };
}

// Builds a client-side preview of a session in the same shape fetchSessions
// returns, so the workout list can update instantly while the real save
// (multiple sequential round trips server-side) is still in flight.
function buildOptimisticSession(sessionId, { date, name, exercises, duration_min, coachNotes }, existing) {
  let totalVol = 0;
  const workout_exercises = (exercises ?? [])
    .filter(ex => ex.name.trim())
    .map((ex, i) => {
      const sets = (ex.sets ?? [])
        .map((s, j) => ({ row: computeSetRow(ex, s), j }))
        .filter(({ row }) => row.hasAny)
        .map(({ row, j }) => {
          if (row.weight_kg && row.reps) totalVol += row.weight_kg * row.reps;
          return { id: `optimistic-set-${sessionId}-${i}-${j}`, set_number: j + 1, ...row };
        });
      return { id: `optimistic-ex-${sessionId}-${i}`, exercise_name: ex.name.trim(), order_index: i, group_id: ex.group_id ?? null, sets };
    });
  return {
    id: sessionId,
    date, notes: name || 'Workout',
    coach_notes: coachNotes ?? existing?.coach_notes ?? null,
    total_volume: Math.round(totalVol),
    duration_min: duration_min != null ? duration_min : (existing?.duration_min ?? null),
    calories_burned: existing?.calories_burned ?? null,
    workout_exercises,
  };
}

async function saveSession(userId, { sessionId, date, name, exercises, duration_min, coachNotes, planId }) {
  let sid = sessionId;
  const durPatch = duration_min != null ? { duration_min } : {};
  const notesPatch = coachNotes !== undefined ? { coach_notes: coachNotes } : {};
  const planPatch = planId !== undefined ? { plan_id: planId } : {};
  if (!sid) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: userId, date, notes: name || 'Workout', ...durPatch, ...notesPatch, ...planPatch })
      .select().single();
    if (error) throw error;
    sid = data.id;
  } else {
    const { error } = await supabase
      .from('workout_sessions')
      .update({ date, notes: name || 'Workout', ...durPatch, ...notesPatch, ...planPatch })
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

  // Insert new exercises in one batch call, then all of their sets in another —
  // avoids one round trip per exercise/set, which is what made saving feel slow.
  const validExercises = exercises
    .map((ex, i) => ({ ex, order_index: i }))
    .filter(({ ex }) => ex.name.trim());
  let totalVol = 0;
  if (validExercises.length > 0) {
    const { data: newExs, error: exErr } = await supabase
      .from('workout_exercises')
      .insert(validExercises.map(({ ex, order_index }) => ({
        session_id: sid, exercise_name: ex.name.trim(), order_index, group_id: ex.group_id ?? null,
      })))
      .select('id, order_index');
    if (exErr) throw exErr;
    const idByOrder = new Map(newExs.map(row => [row.order_index, row.id]));

    const setRows = [];
    for (const { ex, order_index } of validExercises) {
      const exerciseId = idByOrder.get(order_index);
      (ex.sets ?? []).forEach((s, j) => {
        const row = computeSetRow(ex, s);
        if (!row.hasAny) return;
        if (row.weight_kg && row.reps) {
          totalVol += row.weight_kg * row.reps;
        }
        const { hasAny, ...dbRow } = row;
        setRows.push({ exercise_id: exerciseId, set_number: j + 1, ...dbRow });
      });
    }
    if (setRows.length > 0) {
      const { error: setErr } = await supabase.from('sets').insert(setRows);
      if (setErr) throw setErr;
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
function getCardioFieldDefs(type, t) {
  const tr = t ?? ((k, opts) => opts?.defaultValue ?? k);
  if (type === 'Incline Walk')
    return { secondary: { key: 'speed_kmh', label: tr('workout.speedKmhLabel'), placeholder: '3.5' },
              tertiary:  { key: 'incline_pct', label: tr('workout.inclinePctLabel'), placeholder: '12' } };
  if (type === 'Air Bike')
    return { secondary: { key: 'distance_km', label: tr('workout.distanceKmLabel'), placeholder: tr('workout.optionalPlaceholder') },
              tertiary:  { key: 'avg_rpm', label: tr('workout.avgRpmLabel'), placeholder: tr('workout.optionalPlaceholder') } };
  if (type === 'Treadmill Run')
    return { secondary: { key: 'distance_km', label: tr('workout.distanceKmLabel'), placeholder: '5' },
              tertiary:  { key: 'speed_kmh', label: tr('workout.speedKmhLabel'), placeholder: '10' } };
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

// Top set from each of the most recent `count` prior sessions (different days) that logged this exercise.
function getPrevSetSummaries(allSessions, exerciseName, beforeDate, count = 2) {
  const name = (exerciseName ?? '').trim().toLowerCase();
  if (!name) return [];
  const candidates = (allSessions ?? [])
    .filter(s => !beforeDate || s.date < beforeDate)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const out = [];
  for (const sess of candidates) {
    if (out.length >= count) break;
    const ex = (sess.workout_exercises ?? []).find(
      e => (e.exercise_name ?? '').trim().toLowerCase() === name
    );
    if (ex && (ex.sets ?? []).length) {
      const best = ex.sets.slice().sort(
        (a, b) => (b.weight_kg ?? 0) * (b.reps ?? 0) - (a.weight_kg ?? 0) * (a.reps ?? 0)
      )[0];
      if (best.weight_kg) out.push({ weight: best.weight_kg, reps: best.reps, rpe: best.rpe, date: sess.date });
    }
  }
  return out;
}

function getPrevSetSummary(allSessions, exerciseName, beforeDate) {
  return getPrevSetSummaries(allSessions, exerciseName, beforeDate, 1)[0] ?? null;
}

function suggestProgressiveOverload(prev, t) {
  const tr = t ?? ((k, opts) => opts?.defaultValue ?? k);
  if (!prev || !prev.weight) return null;
  const rpe = parseFloat(prev.rpe);
  if (!isNaN(rpe) && rpe >= 9) {
    return { weight: prev.weight, reps: prev.reps, note: tr('workout.lastRpeWasHighHoldSteady') };
  }
  if ((prev.reps ?? 0) >= 10) {
    return { weight: Math.round((prev.weight + 5) / 5) * 5, reps: Math.max(6, prev.reps - 2), note: tr('workout.increaseWeight') };
  }
  return { weight: prev.weight, reps: (prev.reps ?? 0) + 1, note: tr('workout.addARep') };
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

// RPE Trend Alert: per-exercise, detect if avg RPE has risen ≥1 point
// over the last 2 vs prior 2 sessions at the same exercise
function detectRpeTrend(sessions) {
  const byEx = {};
  for (const s of sessions) {
    for (const ex of s.workout_exercises ?? []) {
      const name = (ex.exercise_name ?? '').trim();
      if (!name) continue;
      const rpes = (ex.sets ?? []).map(st => parseFloat(st.rpe)).filter(v => !isNaN(v));
      if (!rpes.length) continue;
      const avg = rpes.reduce((a, b) => a + b, 0) / rpes.length;
      if (!byEx[name]) byEx[name] = [];
      byEx[name].push({ date: s.date, avg });
    }
  }
  const alerts = [];
  for (const [name, entries] of Object.entries(byEx)) {
    const sorted = entries.sort((a, b) => b.date.localeCompare(a.date));
    if (sorted.length < 4) continue;
    const recent = sorted.slice(0, 2).reduce((a, b) => a + b.avg, 0) / 2;
    const prior  = sorted.slice(2, 4).reduce((a, b) => a + b.avg, 0) / 2;
    if (recent - prior >= 1.0 && recent >= 8) {
      alerts.push({ exercise: name, recentRpe: recent.toFixed(1), delta: (recent - prior).toFixed(1) });
    }
  }
  return alerts.slice(0, 3);
}

// Muscle Group Balance: classify exercises into Push / Pull / Legs / Core
function getMuscleBalance(sessions) {
  const PUSH_KEYS  = ['press','fly','dip','push','chest','shoulder','tricep','overhead'];
  const PULL_KEYS  = ['row','pull','curl','lat','bicep','chin','face pull','deadlift'];
  const LEGS_KEYS  = ['squat','leg','lunge','calf','hip thrust','rdl','romanian','hack'];
  const CORE_KEYS  = ['plank','crunch','ab','core','oblique','hanging leg','sit'];
  const [start] = getWeekRange(new Date());
  const totals = { Push: 0, Pull: 0, Legs: 0, Core: 0 };
  for (const s of sessions) {
    if (s.date < start) continue;
    for (const ex of s.workout_exercises ?? []) {
      const n = (ex.exercise_name ?? '').toLowerCase();
      const vol = (ex.sets ?? []).reduce((sum, st) => sum + (st.weight_kg ?? 0) * (st.reps ?? 0), 0);
      if (!vol) continue;
      if (PUSH_KEYS.some(k => n.includes(k)))      totals.Push  += vol;
      else if (PULL_KEYS.some(k => n.includes(k))) totals.Pull  += vol;
      else if (LEGS_KEYS.some(k => n.includes(k))) totals.Legs  += vol;
      else if (CORE_KEYS.some(k => n.includes(k))) totals.Core  += vol;
    }
  }
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  if (!total) return null;
  return Object.entries(totals).map(([k, v]) => ({ group: k, vol: Math.round(v), pct: Math.round((v / total) * 100) }))
    .sort((a, b) => b.vol - a.vol);
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

// ─── Exercise Demo Button ─────────────────────────────────────────────────────
function ExerciseDemoButton({ exerciseName, colors }) {
  const [showDemo, setShowDemo] = useState(false);
  const { imageUrl, isLoading } = useExerciseDemo(showDemo ? exerciseName : null);
  return (
    <>
      <TouchableOpacity
        onPress={() => setShowDemo(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{ marginLeft: 2 }}
      >
        <Ionicons name="play-circle-outline" size={13} color={colors.textDim} />
      </TouchableOpacity>
      <Modal visible={showDemo} transparent animationType="fade" onRequestClose={() => setShowDemo(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 340, backgroundColor: colors.bgCard, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 14 }}>{(exerciseName ?? '').toUpperCase()}</Text>
            {isLoading ? (
              <ActivityIndicator color={colors.accent} style={{ height: 180 }} />
            ) : imageUrl ? (
              <Image source={{ uri: imageUrl }} style={{ width: 280, height: 200, borderRadius: 12 }} resizeMode="contain" />
            ) : (
              <View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="barbell-outline" size={48} color={colors.textDim} />
                <Text style={{ fontSize: 12, color: colors.textDim, marginTop: 10 }}>No demo available</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={() => setShowDemo(false)}
              style={{ marginTop: 16, backgroundColor: colors.bgElevated, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 10 }}
            >
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
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

function suggestAutoReg(prevSetInSession, t) {
  const tr = t ?? ((k, opts) => opts?.defaultValue ?? k);
  const rpe = parseFloat(prevSetInSession?.rpe);
  const w = parseFloat(prevSetInSession?.weight_kg);
  if (isNaN(rpe) || isNaN(w) || !w) return null;
  if (rpe >= 9) return { weight: Math.round(w * 0.95 / 5) * 5, note: tr('workout.rpeWasHighLastSetEaseOff') };
  if (rpe <= 6) return { weight: Math.round(w * 1.05 / 5) * 5, note: tr('workout.rpeWasLowLastSetPushMore') };
  return null;
}

function generateDayList(sessions) {
  const sorted = sessions.slice().sort((a, b) => b.date.localeCompare(a.date));
  const byDate = new Map();
  for (const s of sorted) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  return Array.from(byDate.entries()).map(([date, daySessions]) => ({
    type: 'day',
    date,
    sessions: daySessions,
  }));
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
  const totalVolume = session.total_volume ?? exercises.reduce((s, ex) =>
    s + (ex.sets ?? []).reduce((ss, st) => ss + ((parseFloat(st.weight_kg) || 0) * (parseFloat(st.reps) || 0)), 0), 0);
  const strengthKcalEst = !isCardio && totalVolume > 0 ? Math.round(totalVolume / 30) : 0;
  const durationKcalEst = !isCardio && (session.duration_min ?? 0) > 0 ? Math.round(session.duration_min * 6) : 0;
  const kcal = session.calories_burned ?? (isCardio ? cardioKcal : (durationKcalEst || strengthKcalEst)) ?? 0;
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

        {/* Coach Notes */}
        {!!session.coach_notes && (
          <View style={dS.coachNotesCard}>
            <View style={dS.coachNotesHeader}>
              <Text style={dS.coachNotesTitle}>📋 COACH NOTES</Text>
            </View>
            <Text style={dS.coachNotesText}>{session.coach_notes}</Text>
          </View>
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
          </View>

          {exercises.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('workout.noExercisesLogged')}</Text>
            </View>
          )}

          {(() => {
            const dExGroups = [];
            exercises.forEach((ex, idx) => {
              if (ex.group_id && dExGroups.length > 0 && dExGroups[dExGroups.length - 1].groupId === ex.group_id) {
                dExGroups[dExGroups.length - 1].indices.push(idx);
              } else {
                dExGroups.push({ groupId: ex.group_id || null, indices: [idx] });
              }
            });
            return dExGroups.map((group) => {
            const isGrouped = !!group.groupId;
            const groupCards = group.indices.map((exIdx, posInGroup) => {
            const ex = exercises[exIdx];
            const isPB = pbSet.has((ex.exercise_name ?? '').toLowerCase());
            const isExpanded = expandedIds.has(ex.id);
            const sortedSets = (ex.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number);
            const bestIdx = getBestSetIndex(sortedSets);
            const exMuscles = getExerciseMuscles(ex.exercise_name);
            const exStyle = getWorkoutStyle(ex.exercise_name, colors);
            const isLastInGroup = posInGroup === group.indices.length - 1;

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
              <View key={ex.id}
                style={[isGrouped ? dS.exCardInGroup : dS.exCard, isGrouped && !isLastInGroup && dS.exCardInGroupDivider, dS.exCardCompact]}>
                <View style={dS.exCardCompactRow}>
                  <View style={[dS.exIconCompact, { backgroundColor: exStyle.iconBg, borderColor: exStyle.cardBorder }]}>
                    <Text style={{ fontSize: 14 }}>{exStyle.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={dS.exNameCompact}>{(ex.exercise_name ?? '').toUpperCase()}</Text>
                      {isPB && <Text style={dS.pbCompact}>🏆</Text>}
                      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); setHistoryEx(ex.exercise_name); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="time-outline" size={12} color={colors.textDim} />
                      </TouchableOpacity>
                      <ExerciseDemoButton exerciseName={ex.exercise_name} colors={colors} />
                    </View>
                    {sortedSets.length > 0 && (
                      <View style={dS.compactSetRow}>
                        {sortedSets.map((s, idx) => {
                          const isBest = idx === bestIdx;
                          const wt = s.weight_kg != null ? `${s.weight_kg}kg` : null;
                          const rp = s.reps != null ? `${s.reps}` : null;
                          const dur = s.duration_min != null ? `${s.duration_min}min` : null;
                          const label = wt && rp ? `${wt}×${rp}` : rp ? `${rp} reps` : dur ? dur : '—';
                          return (
                            <View key={s.id} style={[dS.compactSetChip, isBest && dS.compactSetChipBest]}>
                              <Text style={[dS.compactSetChipText, isBest && dS.compactSetChipTextBest]}>
                                {label}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                  {exMuscles.length > 0 && (
                    <Text style={dS.compactMuscleText} numberOfLines={1}>{exMuscles[0]}</Text>
                  )}
                </View>
              </View>
            ); // end card
            }); // end groupCards
            if (!isGrouped) return <React.Fragment key={group.indices[0]}>{groupCards}</React.Fragment>;
            const dCardsWithDivider = [];
            groupCards.forEach((card, i) => {
              dCardsWithDivider.push(card);
              if (i < groupCards.length - 1) {
                dCardsWithDivider.push(
                  <View key={`div-${group.groupId}-${i}`} style={dS.supersetGroupDivider}>
                    <View style={dS.supersetGroupLine} />
                    <Ionicons name="link-outline" size={11} color={colors.purple} />
                    <Text style={dS.supersetGroupHeaderText}>SUPERSET</Text>
                    <Ionicons name="link-outline" size={11} color={colors.purple} />
                    <View style={dS.supersetGroupLine} />
                  </View>
                );
              }
            });
            return (
              <View key={group.groupId} style={dS.supersetGroup}>
                {dCardsWithDivider}
              </View>
            );
            }); // end dExGroups.map
          })()}

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
  const { t } = useTranslation();
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
      <SafeAreaView style={ehS.container} edges={['top', 'bottom']}>
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
              <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('workout.noHistoryYet')}</Text>
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
                  <Text style={ehS.deltaMuted}>{t('workout.sameAsPrev')}</Text>
                ) : (
                  <Text style={[ehS.deltaText, { color: row.delta.diff > 0 ? colors.good : colors.danger }]}>
                    {row.delta.diff > 0 ? '▲' : '▼'} {t('workout.deltaVsPrev', { value: `${row.delta.diff > 0 ? '+' : ''}${row.delta.diff}` })}
                  </Text>
                )
              )}
            </View>
          ))}
          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
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

// ─── Plans Screen (full-page) ─────────────────────────────────────────────────
const PLAN_ORDER_KEY = 'fitzo:planOrder';

function usePlanOrder(plans) {
  const [ordered, setOrdered] = useState(plans);
  useEffect(() => {
    AsyncStorage.getItem(PLAN_ORDER_KEY).then(raw => {
      if (!raw) { setOrdered(plans); return; }
      try {
        const ids = JSON.parse(raw);
        const map = Object.fromEntries(plans.map(p => [p.id, p]));
        const sorted = ids.map(id => map[id]).filter(Boolean);
        const rest = plans.filter(p => !ids.includes(p.id));
        setOrdered([...sorted, ...rest]);
      } catch { setOrdered(plans); }
    });
  }, [plans]);
  const saveOrder = useCallback((newOrder) => {
    setOrdered(newOrder);
    AsyncStorage.setItem(PLAN_ORDER_KEY, JSON.stringify(newOrder.map(p => p.id)));
  }, []);
  return [ordered, saveOrder];
}

function PlansModal({ visible, plans, onSaveOrder, onClose, onCreate, onRename, onDelete, onCopy, onSelect, onSaveTemplate, allSessions }) {
  const { colors, isDark } = useTheme();
  const [newPlanName, setNewPlanName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [templatePlanId, setTemplatePlanId] = useState(null);
  const [templateExercises, setTemplateExercises] = useState([]);
  const [newExName, setNewExName] = useState('');
  const orderedPlans = plans;
  const saveOrder = onSaveOrder ?? (() => {});

  // ── Drag state (plans) ──
  const dragFromIdx = useRef(-1);
  const dragItemsRef = useRef(orderedPlans);
  const [draggingIdx, setDraggingIdx] = useState(-1);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const ITEM_H = 52;

  // ── Drag state (template exercises) ──
  const exDragFromIdx = useRef(-1);
  const exDragItemsRef = useRef([]);
  const [exDraggingIdx, setExDraggingIdx] = useState(-1);
  const [exHoverIdx, setExHoverIdx] = useState(-1);
  const EX_ITEM_H = 48;

  useEffect(() => { dragItemsRef.current = orderedPlans; }, [orderedPlans]);
  useEffect(() => { exDragItemsRef.current = templateExercises; }, [templateExercises]);

  const dragPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => dragFromIdx.current >= 0,
    onMoveShouldSetPanResponder: () => dragFromIdx.current >= 0,
    onPanResponderGrant: () => {
      const from = dragFromIdx.current;
      if (from >= 0) setDraggingIdx(from);
    },
    onPanResponderMove: (_, gs) => {
      const from = dragFromIdx.current;
      if (from < 0) return;
      const to = Math.max(0, Math.min(dragItemsRef.current.length - 1, from + Math.round(gs.dy / ITEM_H)));
      setHoverIdx(to);
    },
    onPanResponderRelease: (_, gs) => {
      const from = dragFromIdx.current;
      if (from < 0) return;
      const items = dragItemsRef.current;
      const to = Math.max(0, Math.min(items.length - 1, from + Math.round(gs.dy / ITEM_H)));
      if (from !== to) {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        saveOrder(next);
      }
      dragFromIdx.current = -1;
      setDraggingIdx(-1);
      setHoverIdx(-1);
    },
    onPanResponderTerminate: () => {
      dragFromIdx.current = -1;
      setDraggingIdx(-1);
      setHoverIdx(-1);
    },
  })).current;

  const exDragPR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => exDragFromIdx.current >= 0,
    onMoveShouldSetPanResponder: () => exDragFromIdx.current >= 0,
    onPanResponderGrant: () => {
      const from = exDragFromIdx.current;
      if (from >= 0) setExDraggingIdx(from);
    },
    onPanResponderMove: (_, gs) => {
      const from = exDragFromIdx.current;
      if (from < 0) return;
      const to = Math.max(0, Math.min(exDragItemsRef.current.length - 1, from + Math.round(gs.dy / EX_ITEM_H)));
      setExHoverIdx(to);
    },
    onPanResponderRelease: (_, gs) => {
      const from = exDragFromIdx.current;
      if (from < 0) return;
      const items = exDragItemsRef.current;
      const to = Math.max(0, Math.min(items.length - 1, from + Math.round(gs.dy / EX_ITEM_H)));
      if (from !== to) {
        const next = [...items];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setTemplateExercises(next);
      }
      exDragFromIdx.current = -1;
      setExDraggingIdx(-1);
      setExHoverIdx(-1);
    },
    onPanResponderTerminate: () => {
      exDragFromIdx.current = -1;
      setExDraggingIdx(-1);
      setExHoverIdx(-1);
    },
  })).current;

  const handleCreate = () => {
    if (!newPlanName.trim()) return;
    onCreate(newPlanName.trim());
    setNewPlanName('');
  };

  const startEdit = (plan) => { setEditingId(plan.id); setEditingName(plan.name); };

  const submitEdit = () => {
    if (!editingName.trim() || editingName.trim() === plans.find(p => p.id === editingId)?.name) {
      setEditingId(null); return;
    }
    onRename(editingId, editingName.trim());
    setEditingId(null);
  };

  const openTemplate = (plan) => {
    let exs = [];
    if (Array.isArray(plan.template_exercises) && plan.template_exercises.length > 0) {
      exs = plan.template_exercises.map(e => (typeof e === 'string' ? e : e.name));
    } else {
      const match = (allSessions ?? [])
        .filter(s => (s.notes ?? '').toLowerCase() === plan.name.toLowerCase() && (s.workout_exercises ?? []).length > 0)
        .slice().sort((a, b) => b.date.localeCompare(a.date))[0];
      if (match) {
        exs = (match.workout_exercises ?? [])
          .slice().sort((a, b) => a.order_index - b.order_index)
          .map(ex => ex.exercise_name);
      }
    }
    setTemplateExercises(exs);
    setTemplatePlanId(plan.id);
    setNewExName('');
  };

  const addTemplateEx = () => {
    if (!newExName.trim()) return;
    setTemplateExercises(prev => [...prev, newExName.trim()]);
    setNewExName('');
  };

  const removeTemplateEx = (idx) => setTemplateExercises(prev => prev.filter((_, i) => i !== idx));

  const tmplNamePool = useMemo(() => getExerciseNamePool(allSessions ?? []), [allSessions]);
  const tmplSuggestions = useMemo(() => {
    const q = newExName.trim().toLowerCase();
    if (!q) return [];
    const matches = tmplNamePool.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length || matches.some(n => n.toLowerCase() === q)) return [];
    return matches;
  }, [newExName, tmplNamePool]);

  const saveTemplate = () => {
    onSaveTemplate(templatePlanId, templateExercises.map(name => ({ name })));
    setTemplatePlanId(null);
  };

  const bg = colors.bg;
  const headerBg = colors.surface;

  // ── Template exercise editor (sub-page) ──
  if (templatePlanId) {
    const planName = (plans.find(p => p.id === templatePlanId) ?? {}).name ?? '';
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setTemplatePlanId(null)}>
        <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: bg }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: headerBg, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <TouchableOpacity onPress={() => setTemplatePlanId(null)} style={{ marginRight: 12 }}>
              <Ionicons name="chevron-back" size={24} color={colors.accent} />
            </TouchableOpacity>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: '800', color: colors.text }} numberOfLines={1}>
              {planName}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled" scrollEnabled={exDraggingIdx < 0}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: 12 }}>EXERCISES IN THIS PLAN</Text>

              {templateExercises.length === 0 && (
                <Text style={{ color: colors.textDim, fontSize: 14, paddingVertical: 16 }}>No exercises yet. Add one below.</Text>
              )}

              {templateExercises.map((ex, idx) => {
                const isDragging = exDraggingIdx === idx;
                const isHover = exHoverIdx === idx && exDraggingIdx !== idx;
                return (
                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', height: EX_ITEM_H, backgroundColor: isDragging ? colors.accent + '22' : isHover ? colors.card + 'ee' : colors.card, borderRadius: 10, marginBottom: 6, borderWidth: isDragging || isHover ? 1 : 0, borderColor: colors.accent + '66', opacity: isDragging ? 0.7 : 1 }}>
                    <View
                      {...exDragPR.panHandlers}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      style={{ paddingHorizontal: 10, alignSelf: 'stretch', justifyContent: 'center' }}
                      onTouchStart={() => { exDragFromIdx.current = idx; }}
                    >
                      <Ionicons name="reorder-three-outline" size={20} color={colors.textDim} />
                    </View>
                    <Text style={{ flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' }} numberOfLines={1}>{ex}</Text>
                    <TouchableOpacity onPress={() => removeTemplateEx(idx)} style={{ paddingHorizontal: 12, alignSelf: 'stretch', justifyContent: 'center' }}>
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                );
              })}

              <View style={{ height: 16 }} />
            </ScrollView>

            {/* Add exercise + save */}
            <View style={{ backgroundColor: headerBg, borderTopWidth: 1, borderTopColor: colors.border }}>
              {tmplSuggestions.length > 0 && (
                <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, maxHeight: 220 }}>
                  <ScrollView keyboardShouldPersistTaps="handled">
                    {tmplSuggestions.map(n => {
                      const ws = getWorkoutStyle(n, colors);
                      return (
                        <TouchableOpacity
                          key={n}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border }}
                          onPress={() => { setNewExName(n); }}
                        >
                          <Text style={{ fontSize: 16 }}>{ws.icon}</Text>
                          <Text style={{ fontSize: 14, color: colors.text }}>{n}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 12 }}>
                <TextInput
                  style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border }}
                  placeholder="Add exercise…"
                  placeholderTextColor={colors.textDim}
                  value={newExName}
                  onChangeText={setNewExName}
                  onSubmitEditing={addTemplateEx}
                  returnKeyType="done"
                />
                <TouchableOpacity onPress={addTemplateEx}
                  style={{ backgroundColor: colors.accent + '22', borderRadius: 12, width: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent + '44' }}>
                  <Ionicons name="add" size={22} color={colors.accent} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={saveTemplate}
                style={{ backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginHorizontal: 16, marginBottom: 16 }}>
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.accentText }}>Save Template</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    );
  }

  // ── Main plans list (full-screen) ──
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: bg }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: headerBg, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="chevron-back" size={24} color={colors.accent} />
          </TouchableOpacity>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '800', color: colors.text }}>MY WORKOUT PLANS</Text>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled" scrollEnabled={draggingIdx < 0}>

            {/* Create new plan */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              <TextInput
                style={{ flex: 1, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border }}
                placeholder="New plan name…"
                placeholderTextColor={colors.textDim}
                value={newPlanName}
                onChangeText={setNewPlanName}
                onSubmitEditing={handleCreate}
                returnKeyType="done"
              />
              <TouchableOpacity onPress={handleCreate}
                style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.accentText }}>Add</Text>
              </TouchableOpacity>
            </View>

            {orderedPlans.length === 0 && (
              <Text style={{ color: colors.textDim, fontSize: 13, paddingVertical: 24, textAlign: 'center' }}>
                No plans yet. Create your first plan above.
              </Text>
            )}

            {/* Draggable plan rows */}
            <View>
              {orderedPlans.map((plan, idx) => {
                const isDragging = draggingIdx === idx;
                const isHover = hoverIdx === idx && draggingIdx !== -1 && hoverIdx !== draggingIdx;

                if (confirmDeleteId === plan.id) {
                  return (
                    <View key={plan.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12 }}>Delete "{plan.name}"?</Text>
                      <TouchableOpacity onPress={() => { onDelete(plan.id, plan.name); setConfirmDeleteId(null); }}
                        style={{ backgroundColor: colors.danger + '22', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                        <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>Delete</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setConfirmDeleteId(null)}
                        style={{ backgroundColor: colors.dim, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                        <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '700' }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }

                if (editingId === plan.id) {
                  return (
                    <View key={plan.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 10, padding: 8, marginBottom: 6, borderWidth: 1, borderColor: colors.accent }}>
                      <TextInput
                        style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: colors.text }}
                        value={editingName}
                        onChangeText={setEditingName}
                        onSubmitEditing={submitEdit}
                        autoFocus
                        returnKeyType="done"
                      />
                      <TouchableOpacity onPress={submitEdit}
                        style={{ backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: colors.accentText }}>Save</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }

                const tmplCount = Array.isArray(plan.template_exercises) ? plan.template_exercises.length : 0;
                const lastMatch = tmplCount === 0 ? (allSessions ?? [])
                  .filter(s => (s.notes ?? '').toLowerCase() === plan.name.toLowerCase() && (s.workout_exercises ?? []).length > 0)
                  .slice().sort((a, b) => b.date.localeCompare(a.date))[0] : null;
                const exCount = tmplCount > 0 ? tmplCount : lastMatch ? (lastMatch.workout_exercises ?? []).length : 0;

                return (
                  <View key={plan.id} style={{
                    flexDirection: 'row', alignItems: 'center',
                    backgroundColor: isDragging ? colors.accent + '18' : isHover ? colors.border : colors.card,
                    borderRadius: 10, marginBottom: 6,
                    borderWidth: 1,
                    borderColor: isDragging ? colors.accent + '66' : isHover ? colors.accent + '44' : colors.border,
                    opacity: isDragging ? 0.75 : 1,
                    height: ITEM_H,
                  }}>
                    {/* Drag handle */}
                    <View
                      {...dragPR.panHandlers}
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                      style={{ paddingHorizontal: 10, paddingVertical: 14, alignSelf: 'stretch', justifyContent: 'center' }}
                      onTouchStart={() => { dragFromIdx.current = idx; }}
                    >
                      <Ionicons name="reorder-three-outline" size={20} color={colors.textDim} />
                    </View>

                    {/* Plan info — tap to start */}
                    <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingRight: 4 }} onPress={() => {
                      let exs = [];
                      if (tmplCount > 0) {
                        exs = plan.template_exercises.map(e => (typeof e === 'string' ? e : e.name));
                      } else if (lastMatch) {
                        exs = (lastMatch.workout_exercises ?? [])
                          .slice().sort((a, b) => a.order_index - b.order_index)
                          .map(ex => ex.exercise_name);
                      }
                      onSelect && onSelect(plan, exs);
                    }} activeOpacity={0.7}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }} numberOfLines={1}>{plan.name}</Text>
                        {exCount > 0
                          ? <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>{exCount} exercise{exCount !== 1 ? 's' : ''}</Text>
                          : <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>No exercises</Text>}
                      </View>
                    </TouchableOpacity>

                    {/* Actions */}
                    <TouchableOpacity onPress={() => openTemplate(plan)} style={{ padding: 7 }}>
                      <Ionicons name="barbell-outline" size={16} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onCopy && onCopy(plan)} style={{ padding: 7 }}>
                      <Ionicons name="copy-outline" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => startEdit(plan)} style={{ padding: 7 }}>
                      <Ionicons name="pencil-outline" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setConfirmDeleteId(plan.id)} style={{ padding: 7, paddingRight: 10 }}>
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Edit Session Modal ───────────────────────────────────────────────────────
// Always show these two as default chip suggestions
const DEFAULT_CHIPS = ['Rest Day', 'Cardio'];

function EditSessionModal({
  visible, isNew, initialData, recentTypes, allSessions, onSave, onCancel,
  hasAccess, templates, onSaveTemplate, onSaveAsPlan, onOpenToolsPaywall,
  onRepeatTemplate, isRepeatingTemplate, plans,
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const eS = useMemo(() => createES(colors), [colors]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [exercises, setExercises] = useState([]);
  const [activeExIdx, setActiveExIdx] = useState(null);
  const [acOpenIdx, setAcOpenIdx] = useState(null);
  const [subOpenIdx, setSubOpenIdx] = useState(null);
  const [restTimer, setRestTimer] = useState(null); // { exIdx, secondsLeft, total }
  const REST_CYCLE = [60, 90, 120, 180];
  const [restSeconds, setRestSeconds] = useState(90);
  const [restRemaining, setRestRemaining] = useState(null);
  const [programTemplate, setProgramTemplate] = useState(null);
  const scrollRef = useRef(null);
  const cardRefs = useRef({});
  const [dragKey, setDragKey] = useState(null);
  const exercisesRef = useRef(exercises);
  useEffect(() => { exercisesRef.current = exercises; }, [exercises]);
  const panRefs = useRef({});
  const startIdxMap = useRef({});
  const CARD_H = 80;
  // Returns array of indices for a group (consecutive block), or [idx] for ungrouped
  const getGroupBlock = (arr, idx) => {
    const gId = arr[idx]?.group_id;
    if (!gId) return [idx];
    const indices = [];
    arr.forEach((ex, i) => { if (ex.group_id === gId) indices.push(i); });
    return indices;
  };

  const getDragPan = (key) => {
    if (!panRefs.current[key]) {
      panRefs.current[key] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          const cur = exercisesRef.current;
          const exIdx = cur.findIndex(e => e._key === key);
          const block = getGroupBlock(cur, exIdx);
          // Store the block's top index at gesture start
          startIdxMap.current[key] = block[0];
          setDragKey(key);
          setActiveExIdx(null);
        },
        onPanResponderMove: (_, gs) => {
          const origBlockStart = startIdxMap.current[key];
          if (origBlockStart == null) return;
          const cur = exercisesRef.current;
          const exIdx = cur.findIndex(e => e._key === key);
          if (exIdx === -1) return;
          const block = getGroupBlock(cur, exIdx);
          const blockStart = block[0];
          const blockSize = block.length;

          // Desired new block start position based on original position + drag delta
          const rawTarget = origBlockStart + Math.round(gs.dy / CARD_H);
          const maxStart = cur.length - blockSize;
          let toStart = Math.max(0, Math.min(maxStart, rawTarget));

          // If dragging a solo exercise, prevent it landing inside another group
          if (blockSize === 1) {
            const targetEx = cur[toStart];
            if (targetEx?.group_id) {
              // Find the group block at target and snap to before or after it
              const targetBlock = getGroupBlock(cur, toStart);
              toStart = toStart > blockStart ? targetBlock[targetBlock.length - 1] + 1 : targetBlock[0];
              toStart = Math.max(0, Math.min(cur.length - 1, toStart));
            }
          }

          if (toStart === blockStart) return;
          const arr = [...cur];
          const items = arr.splice(blockStart, blockSize);
          // toStart is the desired final index; after splice the insert position is the same
          // because we insert into the now-shorter array at exactly that slot
          arr.splice(toStart, 0, ...items);
          setExercises(arr);
        },
        onPanResponderRelease: () => { delete startIdxMap.current[key]; setDragKey(null); },
        onPanResponderTerminate: () => { delete startIdxMap.current[key]; setDragKey(null); },
      });
    }
    return panRefs.current[key];
  };
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

  // Auto rest timer countdown
  useEffect(() => {
    if (restRemaining === null) return;
    if (restRemaining <= 0) {
      haptics.medium();
      setRestRemaining(null);
      return;
    }
    const id = setTimeout(() => setRestRemaining(r => r - 1), 1000);
    return () => clearTimeout(id);
  }, [restRemaining]);

  const cycleRestSeconds = () => {
    setRestSeconds(prev => {
      const idx = REST_CYCLE.indexOf(prev);
      const next = REST_CYCLE[(idx + 1) % REST_CYCLE.length];
      setRestRemaining(next);
      return next;
    });
  };

  const startRestTimer = (exIdx, seconds = 90) => setRestTimer({ exIdx, secondsLeft: seconds, total: seconds });
  const cancelRestTimer = () => setRestTimer(null);

  // Session auto-timer — starts the moment a brand-new session modal opens.
  // Tracks a real wall-clock start timestamp (not a tick counter) so the
  // elapsed time stays correct even if the app is backgrounded — a plain
  // setInterval counter pauses while JS execution is suspended in the
  // background and undercounts real session length.
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [sessionElapsedSec, setSessionElapsedSec] = useState(0);
  const [sessionTimerRunning, setSessionTimerRunning] = useState(false);
  const [durationManuallySet, setDurationManuallySet] = useState(false);
  const [manualDuration, setManualDuration] = useState('');

  useEffect(() => {
    if (visible && isNew) {
      setSessionStartedAt(Date.now());
      setSessionElapsedSec(0);
      setSessionTimerRunning(true);
      setDurationManuallySet(false);
      setManualDuration('');
    } else if (!visible) {
      setSessionTimerRunning(false);
      setSessionStartedAt(null);
    }
  }, [visible, isNew]);

  useEffect(() => {
    if (!sessionTimerRunning || !sessionStartedAt) return;
    const recompute = () => setSessionElapsedSec(Math.floor((Date.now() - sessionStartedAt) / 1000));
    recompute();
    const t = setInterval(recompute, 1000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') recompute();
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [sessionTimerRunning, sessionStartedAt]);

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
      Alert.alert(t('workout.noPreviousSession'), t('workout.noPastSessionFoundToCopy', { value: sessionTypeName || targetType }));
      return;
    }
    const exs = (match.workout_exercises ?? [])
      .slice().sort((a, b) => a.order_index - b.order_index)
      .map(ex => ({ _key: tid(), name: ex.exercise_name, sets: [blankSet()] }));
    setExercises(exs);
    setName(match.notes ?? '');
    const planMatch = (plans ?? []).find(p => p.name.toLowerCase() === (match.notes ?? '').toLowerCase());
    setSelectedPlanId(planMatch?.id ?? null);
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
    const planNames = new Set((plans ?? []).map(p => p.name.toLowerCase()));
    const extra = recentTypes.filter(t => !DEFAULT_CHIPS.some(d => d.toLowerCase() === t.toLowerCase()) && !planNames.has(t.toLowerCase()));
    return [...DEFAULT_CHIPS.filter(d => !planNames.has(d.toLowerCase())), ...extra];
  }, [recentTypes, plans]);

  useEffect(() => {
    if (visible && initialData) {
      setDate(initialData.date ?? '');
      setName(initialData.name ?? '');
      setCoachNotes(initialData.coachNotes ?? '');
      setExercises(initialData.exercises ?? []);
      setActiveExIdx(null);
      setSelectedPlanId(initialData.planId ?? null);
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
    setExercises(prev => {
      const removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      // If removed exercise was in a superset, check if its partner is now alone
      if (removed?.group_id) {
        const remaining = next.filter(e => e.group_id === removed.group_id);
        if (remaining.length === 1) {
          // Only one left — no longer a superset, clear its group_id
          return next.map(e => e.group_id === removed.group_id ? { ...e, group_id: null } : e);
        }
      }
      return next;
    });
    if (activeExIdx === idx) setActiveExIdx(null);
    else if (activeExIdx > idx) setActiveExIdx(activeExIdx - 1);
  };

  const moveExercise = (idx, dir) => {
    const next = idx + dir;
    setExercises(prev => {
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
    setActiveExIdx(next);
  };

  const updateExName = (idx, val) =>
    setExercises(prev => prev.map((ex, i) => i === idx ? { ...ex, name: val } : ex));

  const addSet = (exIdx) => {
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: [...(ex.sets ?? []), blankSet()],
    }));
    setRestRemaining(restSeconds);
  };

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
      const above = exIdx > 0 ? prev[exIdx - 1] : null;
      const groupId = above?.group_id ?? tid();
      return prev.map((ex, i) => {
        if (i === exIdx) return { ...ex, group_id: groupId };
        if (i === exIdx - 1 && !above?.group_id) return { ...ex, group_id: groupId };
        return ex;
      });
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
    if (!date.trim()) { Alert.alert(t('workout.dateRequired'), t('workout.pleasePickADate')); return; }
    const isRest = name.toLowerCase() === 'rest day';
    setSessionTimerRunning(false);
    const manualMin = parseFloat(manualDuration);
    const duration_min = durationManuallySet && !isNaN(manualMin)
      ? manualMin
      : (isNew && sessionElapsedSec > 0 ? Math.round(sessionElapsedSec / 60) : undefined);
    onSave({
      date: date.trim(), name: name.trim() || t('workout.workout'), exercises: isRest ? [] : exercises,
      coachNotes: coachNotes.trim() || null,
      planId: selectedPlanId,
      ...(duration_min != null ? { duration_min } : {}),
    });
  };

  const isRestDay = name.toLowerCase() === 'rest day';
  const isCardio  = !isRestDay && ['cardio','run','stair','hiit','bike','swim','walk','cycle'].some(k => name.toLowerCase().includes(k));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView edges={['top']} style={eS.container}>
          <ScrollView ref={scrollRef} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" scrollEnabled={!dragKey}>
          {/* Header */}
          <View style={eS.header}>
            <View style={{ flex: 1 }}>
              <Text style={eS.headerTop}>
                <Text style={eS.headerLOG}>{t('workout.logPrefix')} </Text>
                <Text style={eS.headerSub}>{isNew ? t('workout.newSession') : t('workout.editSession')}</Text>
              </Text>
              <Text style={eS.trackLabel}>{t('workout.trackYourWorkout')}</Text>
            </View>
            <TouchableOpacity onPress={onCancel} style={eS.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Single chips row: plans first (📋), then default/recent types */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={eS.typeScroll} contentContainerStyle={eS.typeRow}>
            {(plans ?? []).map(p => {
              const active = selectedPlanId === p.id;
              return (
                <TouchableOpacity key={'plan-' + p.id}
                  style={[eS.typeChip, active && eS.typeChipActive]}
                  onPress={() => {
                    if (active) { setSelectedPlanId(null); return; }
                    setSelectedPlanId(p.id);
                    setName(p.name);
                    if (isNew) {
                      // prefer saved template, fall back to last session
                      const tmpl = Array.isArray(p.template_exercises) && p.template_exercises.length > 0
                        ? p.template_exercises
                        : null;
                      if (tmpl) {
                        setExercises(tmpl.map(e => ({ _key: tid(), name: typeof e === 'string' ? e : e.name, sets: [blankSet()] })));
                      } else {
                        const match = (allSessions ?? [])
                          .filter(s => (s.notes ?? '').toLowerCase() === p.name.toLowerCase() && (s.workout_exercises ?? []).length > 0)
                          .slice().sort((a, b) => b.date.localeCompare(a.date))[0];
                        if (match) {
                          const exs = (match.workout_exercises ?? [])
                            .slice().sort((a, b) => a.order_index - b.order_index)
                            .map(ex => ({ _key: tid(), name: ex.exercise_name, sets: [blankSet()] }));
                          setExercises(exs);
                        }
                      }
                    }
                  }}>
                  <Text style={[eS.typeChipText, active && eS.typeChipTextActive]}>📋 {p.name}</Text>
                </TouchableOpacity>
              );
            })}
            {allChips.map(chip => {
              const active = !selectedPlanId && name.toLowerCase() === chip.toLowerCase();
              return (
                <TouchableOpacity key={'chip-' + chip}
                  style={[eS.typeChip, active && eS.typeChipActive]}
                  onPress={() => { setSelectedPlanId(null); setName(chip); }}>
                  <Text style={[eS.typeChipText, active && eS.typeChipTextActive]}>{chip}</Text>
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
                <Text style={eS.copyLastBtnText}>{t('workout.copyLastSession')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Date + Type */}
          <View style={eS.fieldRow}>
            <View style={eS.fieldCol}>
              <Text style={eS.fieldLabel}>{t('workout.date')}</Text>
              <DatePickerField
                value={date}
                onChange={setDate}
                colors={colors}
                placeholder={t('workout.pickDate')}
                style={eS.datePickerBtn}
              />
            </View>
            <View style={eS.fieldCol}>
              <Text style={eS.fieldLabel}>WORKOUT PLAN</Text>
              <TextInput style={eS.fieldInput} value={name} onChangeText={(v) => { setName(v); setSelectedPlanId(null); }}
                placeholder="Pick a plan above or type a new one" placeholderTextColor={colors.textDim} />
            </View>
          </View>

          {/* Coach Notes */}
          <View style={eS.coachNotesWrap}>
            <Text style={eS.fieldLabel}>📋 COACH NOTES</Text>
            <TextInput
              style={eS.coachNotesInput}
              value={coachNotes}
              onChangeText={setCoachNotes}
              placeholder="How did it feel? Cues, adjustments, next session plans…"
              placeholderTextColor={colors.textDim}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Content area — differs by type */}
          {isRestDay ? (
            /* ── Rest Day UI ── */
            <View style={eS.restDayWrap}>
              <Text style={eS.restDayEmoji}>😴</Text>
              <Text style={eS.restDayTitle}>{t('workout.restAndRecovery')}</Text>
              <Text style={eS.restDaySub}>{t('workout.noExercisesNeededOnRestDays')}</Text>
              <View style={eS.restDayBadges}>
                {[t('workout.sleepBadge'), t('workout.stretchBadge'), t('workout.nutritionBadge')].map(b => (
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
                  <Text style={eS.cardioHintText}>{t('workout.addActivitiesHint')}</Text>
                </View>
              )}

              {(() => {
                const exGroups = [];
                exercises.forEach((ex, idx) => {
                  if (ex.group_id && exGroups.length > 0 && exGroups[exGroups.length - 1].groupId === ex.group_id) {
                    exGroups[exGroups.length - 1].indices.push(idx);
                  } else {
                    exGroups.push({ groupId: ex.group_id || null, indices: [idx] });
                  }
                });
                return exGroups.map((group) => {
                const isGrouped = !!group.groupId;
                const groupCards = group.indices.map((exIdx, posInGroup) => {
                const ex = exercises[exIdx];
                const isActive = activeExIdx === exIdx;
                const isLastInGroup = posInGroup === group.indices.length - 1;
                return (
                  <View key={ex._key} ref={r => { cardRefs.current[exIdx] = r; }} style={[
                    isGrouped ? eS.exCardInGroup : eS.exCard,
                    isActive && eS.exCardActive,
                    isGrouped && !isLastInGroup && eS.exCardInGroupDivider,
                    dragKey === ex._key && eS.exCardDragging,
                  ]}>
                    <View style={eS.exCardHeader}>
                      <TouchableOpacity style={eS.exCardHeaderTap}
                        onPress={() => {
                          const next = isActive ? null : exIdx;
                          setActiveExIdx(next);
                          if (next != null) scrollCardToTop(next);
                        }}>
                        <View style={[eS.exNumBadge, isActive && eS.exNumBadgeActive]}>
                          <Text style={[eS.exNumText, isActive && eS.exNumTextActive]}>{exIdx + 1}</Text>
                        </View>
                        <Text style={[eS.exCardName, isActive && eS.exCardNameActive]} numberOfLines={1}>
                          {ex.name.trim() || (isCardio ? t('workout.newActivity') : t('workout.newExercise'))}
                        </Text>
                        <Text style={eS.exSetsCount}>
                          {isCardio
                            ? t('workout.entryCount', { count: (ex.sets ?? []).length })
                            : t('workout.setsCount', { count: (ex.sets ?? []).length })}
                        </Text>
                      </TouchableOpacity>
                      <View style={[eS.dragHandle, dragKey === ex._key && eS.dragHandleActive]}
                        {...getDragPan(ex._key).panHandlers}>
                        <Ionicons name="menu" size={18} color={dragKey === ex._key ? colors.accent : colors.textDim} />
                      </View>
                      <TouchableOpacity onPress={() => removeExercise(exIdx)} style={eS.exDeleteBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <View style={eS.exDeleteX}>
                          <Ionicons name="close" size={12} color={colors.danger} />
                        </View>
                      </TouchableOpacity>
                    </View>

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
                            <TextInput
                              style={eS.exNameInput}
                              value={ex.name}
                              onChangeText={v => { updateExName(exIdx, v); setAcOpenIdx(exIdx); }}
                              onFocus={() => { setAcOpenIdx(exIdx); scrollCardToTop(exIdx); }}
                              onBlur={() => setTimeout(() => setAcOpenIdx(cur => (cur === exIdx ? null : cur)), 150)}
                              placeholder={t('workout.exerciseName')}
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
                              style={[eS.supersetToggleBtn, ex.group_id && eS.supersetToggleBtnActive]}
                              onPress={() => hasAccess ? toggleExerciseGroup(exIdx) : onOpenToolsPaywall?.()}
                            >
                              <Text style={[eS.supersetToggleBtnText, ex.group_id && eS.supersetToggleBtnTextActive]}>
                                {hasAccess ? (ex.group_id ? '🔗 Superset ✓' : '🔗 Superset') : '🔒 Superset'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {!isCardio && !!ex.name.trim() && (() => {
                          const trend = getExerciseTopSetTrend(allSessions, ex.name);
                          if (trend.length < 2) return null;
                          return hasAccess ? (
                            <View style={eS.trendRow}>
                              <Text style={eS.trendLabel}>{t('workout.strengthTrend')}</Text>
                              <Sparkline data={trend} color={colors.accent} width={70} height={24} />
                              <Text style={eS.trendVal}>{trend[trend.length - 1]}kg</Text>
                            </View>
                          ) : (
                            <TouchableOpacity onPress={() => onOpenToolsPaywall?.()} style={eS.trendRow}>
                              <Text style={eS.trendLabel}>{t('workout.proStrengthTrend')}</Text>
                            </TouchableOpacity>
                          );
                        })()}

                        {ex.group_id && (
                          <View style={eS.groupHint}>
                            <Text style={eS.groupHintText}>
                              {t('workout.groupedRestTimerHint')}
                            </Text>
                          </View>
                        )}

                        {!isCardio && hasAccess && subOpenIdx === exIdx && (
                          <View style={eS.acDropdown}>
                            <Text style={eS.subHeader}>{t('workout.swapExercisePro')}</Text>
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
                          const prevSets = getPrevSetSummaries(allSessions, ex.name, date || undefined, 2);
                          const prev = prevSets[0];
                          if (!prev) return null;
                          const suggestion = suggestProgressiveOverload(prev, t);
                          const warmups = getWarmupSets(suggestion?.weight ?? prev.weight);
                          return (
                            <View style={eS.prevPerfBox}>
                              <Text style={eS.prevPerfText}>
                                {t('workout.lastPrefix')} <Text style={eS.prevPerfBold}>{prev.weight}kg × {prev.reps}</Text>
                                {prev.rpe ? ` @ RPE ${prev.rpe}` : ''}
                                {prevSets[1] && (
                                  <Text style={eS.prevPerfPrior}>
                                    {'  ·  '}<Text style={eS.prevPerfBold}>{prevSets[1].weight}kg × {prevSets[1].reps}</Text>
                                    {prevSets[1].rpe ? ` @ RPE ${prevSets[1].rpe}` : ''}
                                  </Text>
                                )}
                              </Text>
                              {hasAccess ? (
                                suggestion && (
                                  <Text style={eS.suggestText}>
                                    {t('workout.suggestedPrefix')} <Text style={eS.prevPerfBold}>{suggestion.weight}kg × {suggestion.reps}</Text> ({suggestion.note})
                                  </Text>
                                )
                              ) : (
                                <TouchableOpacity onPress={() => onOpenToolsPaywall?.()}>
                                  <Text style={eS.suggestTextLocked}>{t('workout.proSeeSuggestedNextTarget')}</Text>
                                </TouchableOpacity>
                              )}
                              {(ex.sets ?? []).length === 1 && !ex.sets[0].weight_kg && (
                                <View style={eS.warmupRow}>
                                  <Text style={eS.warmupLabel}>{t('workout.warmUpLabel')}</Text>
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
                              {t('workout.restTimer', { value: `${Math.floor(restTimer.secondsLeft / 60)}:${String(restTimer.secondsLeft % 60).padStart(2, '0')}` })}
                            </Text>
                            <TouchableOpacity onPress={cancelRestTimer}>
                              <Text style={eS.restBannerCancel}>{t('workout.skip')}</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {isCardio ? (
                          (ex.sets ?? []).map((s, sIdx) => {
                            const def = getCardioFieldDefs(ex.name, t);
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
                                    <Text style={eS.cardioFieldLabel}>{t('workout.durationMinLabel')}</Text>
                                    <TextInput
                                      style={eS.setInput}
                                      value={s.duration_min}
                                      onChangeText={v => updateSet(exIdx, sIdx, 'duration_min', v)}
                                      onFocus={() => scrollCardToTop(exIdx)}
                                      keyboardType="numeric"
                                      placeholder={t('workout.minPlaceholder')}
                                      placeholderTextColor={colors.textDim}
                                    />
                                  </View>
                                  <View style={eS.cardioFieldCol}>
                                    <Text style={eS.cardioFieldLabel}>{t('workout.caloriesAutoLabel')}</Text>
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
                            const autoReg = hasAccess && sIdx > 0 ? suggestAutoReg(ex.sets[sIdx - 1], t) : null;
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
                                    placeholder={autoReg ? String(autoReg.weight) : t('workout.kgPlaceholder')}
                                    placeholderTextColor={autoReg ? colors.accent : colors.textDim}
                                  />
                                  <Text style={eS.setX}>×</Text>
                                  <TextInput
                                    style={eS.setInput}
                                    value={s.reps}
                                    onChangeText={v => updateSet(exIdx, sIdx, 'reps', v)}
                                    onFocus={() => scrollCardToTop(exIdx)}
                                    keyboardType="numeric"
                                    placeholder={t('workout.repsPlaceholder')}
                                    placeholderTextColor={colors.textDim}
                                  />
                                  <TextInput
                                    onFocus={() => scrollCardToTop(exIdx)}
                                    style={[eS.setInput, { maxWidth: 50 }]}
                                    value={s.rpe}
                                    onChangeText={v => updateSet(exIdx, sIdx, 'rpe', v)}
                                    keyboardType="decimal-pad"
                                    placeholder={t('workout.rpePlaceholder')}
                                    placeholderTextColor={colors.textDim}
                                  />
                                  <TouchableOpacity onPress={() => removeSet(exIdx, sIdx)} style={eS.setDeleteBtn}>
                                    <Ionicons name="close" size={14} color={colors.textDim} />
                                  </TouchableOpacity>
                                </View>
                                {plates.length > 0 && (
                                  <Text style={eS.plateText}>🏋️ {t('workout.platesPerSide', { value: plates.join(' + ') })}</Text>
                                )}
                                {autoReg && (
                                  <Text style={eS.autoRegText}>⚙️ {t('workout.autoRegSuggests', { weight: autoReg.weight, note: autoReg.note })}</Text>
                                )}
                                {oneRM && (
                                  <Text style={eS.oneRmText}>💪 {t('workout.est1RM', { value: oneRM })}</Text>
                                )}
                                {!hasAccess && s.weight_kg && s.reps && (
                                  <TouchableOpacity onPress={() => onOpenToolsPaywall?.()}>
                                    <Text style={eS.oneRmTextLocked}>🔒 {t('workout.proSeeEstimated1RM')}</Text>
                                  </TouchableOpacity>
                                )}
                                {pr && (
                                  <View style={eS.prBanner}>
                                    <Text style={eS.prBannerText}>
                                      🎉 {t('workout.newPr', { value: pr.type === 'weight' ? t('workout.heaviestWeightYet') : t('workout.bestVolumeYet') })}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            );
                          })
                        )}

                        <View style={eS.addSetRow}>
                          <TouchableOpacity style={[eS.addSetBtn, { flex: 1 }]} onPress={() => addSet(exIdx)}>
                            <Text style={eS.addSetText}>{isCardio ? `+ ${t('workout.addEntry')}` : `+ ${t('workout.addSet')}`}</Text>
                          </TouchableOpacity>
                          {!isCardio && (() => {
                            // In a superset, the rest timer only fires once the last exercise in the group is reached
                            const isLastInGroup = !ex.group_id || !exercises.some((other, oi) => oi > exIdx && other.group_id === ex.group_id);
                            if (!isLastInGroup) return null;
                            return (
                              <TouchableOpacity style={eS.restBtn} onPress={() => startRestTimer(exIdx, 90)}>
                                <Ionicons name="timer-outline" size={14} color={colors.blue} />
                                <Text style={eS.restBtnText}>{t('workout.restSeconds', { seconds: 90 })}</Text>
                              </TouchableOpacity>
                            );
                          })()}
                        </View>
                      </View>
                    )}
                  </View>
                ); // end card
                }); // end groupCards
                if (!isGrouped) return <React.Fragment key={group.indices[0]}>{groupCards}</React.Fragment>;
                const cardsWithDivider = [];
                groupCards.forEach((card, i) => {
                  cardsWithDivider.push(card);
                  if (i < groupCards.length - 1) {
                    cardsWithDivider.push(
                      <View key={`div-${group.groupId}-${i}`} style={eS.supersetGroupDivider}>
                        <View style={eS.supersetGroupLine} />
                        <Ionicons name="link-outline" size={11} color={colors.purple} />
                        <Text style={eS.supersetGroupHeaderText}>SUPERSET</Text>
                        <Ionicons name="link-outline" size={11} color={colors.purple} />
                        <View style={eS.supersetGroupLine} />
                      </View>
                    );
                  }
                });
                return (
                  <View key={group.groupId} style={eS.supersetGroup}>
                    {cardsWithDivider}
                  </View>
                );
                }); // end exGroups.map
              })()}

              {isNew && exercises.length === 0 && !isCardio && (
                <View style={eS.templateRow}>
                  <Text style={eS.templateRowLabel}>📋 {t('workout.loadTemplate')} {!hasAccess && `— ${t('workout.pro')}`}</Text>
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
                        <Text style={eS.programHintText}>{t('workout.longPressTemplateHint')}</Text>
                      </>
                    ) : (
                      <Text style={eS.templateEmptyText}>{t('workout.saveSessionToBuildTemplate')}</Text>
                    )
                  ) : (
                    <TouchableOpacity style={eS.templateChip} onPress={onOpenToolsPaywall}>
                      <Text style={eS.templateChipText}>🔒 {t('workout.unlockSavedTemplates')}</Text>
                    </TouchableOpacity>
                  )}

                  {hasAccess && programTemplate && (
                    <View style={eS.programBox}>
                      <Text style={eS.programBoxTitle}>📅 {t('workout.repeatTemplateWeekly', { name: programTemplate.name })}</Text>
                      <Text style={eS.programExplainerText}>
                        {t('workout.programExplainer', { count: programWeeks, name: programTemplate.name })}
                      </Text>
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
                            {isRepeatingTemplate ? t('workout.creatingEllipsis') : t('workout.createSessionsCount', { count: programWeeks })}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={eS.programCancelBtn} onPress={() => setProgramTemplate(null)}>
                          <Text style={eS.programCancelBtnText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity style={[eS.addExBtn, { flex: 1 }]} onPress={addExercise}>
                  <Ionicons name="add" size={18} color={colors.accent} />
                  <Text style={eS.addExText}>{isCardio ? t('workout.addActivity') : t('workout.addExercise')}</Text>
                </TouchableOpacity>
                <VoiceLogButton
                  size="sm"
                  onAction={(parsed) => {
                    if (parsed.type === 'workout_set') {
                      addExercise(parsed.exercise);
                    }
                  }}
                />
              </View>

              <View style={{ height: 20 }} />
            </View>
          )}

          {isNew && !isRestDay && (
            <View style={eS.durationOverrideRow}>
              <Text style={eS.durationOverrideLabel}>{t('workout.durationMin')}</Text>
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

          {/* Auto rest timer bar */}
          {restRemaining > 0 && (
            <View style={eS.autoRestBar}>
              <View style={eS.autoRestProgressTrack}>
                <View style={[eS.autoRestProgressFill, { width: `${Math.round((restRemaining / restSeconds) * 100)}%` }]} />
              </View>
              <View style={eS.autoRestRow}>
                <TouchableOpacity onPress={cycleRestSeconds} style={{ flex: 1 }}>
                  <Text style={eS.autoRestText}>⏱ Rest: {restRemaining}s  <Text style={eS.autoRestCycleTip}>tap → {REST_CYCLE[(REST_CYCLE.indexOf(restSeconds) + 1) % REST_CYCLE.length]}s</Text></Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRestRemaining(null)} style={eS.autoRestSkip}>
                  <Text style={eS.autoRestSkipText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Bottom buttons */}
          {!isRestDay && exercises.length > 0 && (
            <View style={eS.saveShortcutRow}>
              <TouchableOpacity
                style={eS.savePlanBtn}
                onPress={() => onSaveAsPlan?.({ name: name.trim() || 'Workout', exercises })}
              >
                <Ionicons name="list-outline" size={14} color={colors.accent} />
                <Text style={eS.savePlanBtnText}>Save as Plan</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={eS.saveTemplateHalfBtn}
                onPress={() => hasAccess ? onSaveTemplate({ name: name.trim() || 'Workout', exercises }) : onOpenToolsPaywall?.()}
              >
                <Ionicons name="bookmark-outline" size={14} color={hasAccess ? colors.purple : colors.textDim} />
                <Text style={[eS.saveTemplateHalfBtnText, !hasAccess && { color: colors.textDim }]}>
                  {hasAccess ? 'Save as Template' : '🔒 Template (Pro)'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={eS.bottomRow}>
            <TouchableOpacity style={eS.cancelBtn} onPress={onCancel}>
              <Text style={eS.cancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={eS.saveBtn} onPress={handleSave}>
              <Text style={eS.saveBtnText}>{isNew ? t('workout.saveSession') : t('workout.updateSession')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function WorkoutScreen({ embedded = false } = {}) {
  const { t } = useTranslation();
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
  const [dayPickerSessions, setDayPickerSessions] = useState(null); // array or null
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
  const [showPlans, setShowPlans] = useState(false);

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

  const { data: plans = [] } = useQuery({
    queryKey: ['workoutPlans', user?.id],
    queryFn: () => fetchPlans(user.id),
    enabled: !!user?.id,
    retry: false,
    throwOnError: false,
  });
  const [orderedPlansMain, saveOrderMain] = usePlanOrder(plans);

  const planKey = ['workoutPlans', user.id];

  const createPlanMut = useMutation({
    mutationFn: (name) => createPlan(user.id, name),
    onMutate: async (name) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => [...(old ?? []), { id: '__tmp__' + Date.now(), name, template_exercises: null, created_at: new Date().toISOString() }]);
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => qc.invalidateQueries(planKey),
  });

  const renamePlanMut = useMutation({
    mutationFn: ({ planId, name }) => renamePlan(planId, name),
    onMutate: async ({ planId, name }) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => (old ?? []).map(p => p.id === planId ? { ...p, name } : p));
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => { qc.invalidateQueries(planKey); qc.invalidateQueries(['sessions', user.id]); },
  });

  const deletePlanMut = useMutation({
    mutationFn: ({ planId, planName }) => deletePlan(planId, planName),
    onMutate: async ({ planId }) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => (old ?? []).filter(p => p.id !== planId));
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => { qc.invalidateQueries(planKey); qc.invalidateQueries(['sessions', user.id]); },
  });

  const copyPlanMut = useMutation({
    mutationFn: (plan) => copyPlan(user.id, plan),
    onMutate: async (plan) => {
      await qc.cancelQueries(planKey);
      const prev = qc.getQueryData(planKey);
      qc.setQueryData(planKey, old => [...(old ?? []), { id: '__tmp__' + Date.now(), name: plan.name + '_copy', template_exercises: plan.template_exercises ?? null, created_at: new Date().toISOString() }]);
      return { prev };
    },
    onError: (_, __, ctx) => qc.setQueryData(planKey, ctx?.prev),
    onSettled: () => qc.invalidateQueries(planKey),
  });

  const savePlanTemplateMut = useMutation({
    mutationFn: ({ planId, exercises }) => updatePlanTemplate(planId, exercises),
    onSuccess: () => qc.invalidateQueries(['workoutPlans', user.id]),
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
      t('workout.logTodaysWorkout'), t('workout.haventLoggedWorkoutToday'));
  }, [isLoading, notifPrefs.workoutReminder, sessions, workoutReminderTime.hour, workoutReminderTime.minute]);

  const { data: weeklyGoal = DEFAULT_WEEKLY_GOAL } = useQuery({
    queryKey: ['workoutGoal', user?.id],
    queryFn: () => fetchWorkoutGoal(user.id),
    enabled: !!user?.id,
  });

  const saveMut = useMutation({
    mutationFn: (params) => saveSession(user.id, params),
    onMutate: async (params) => {
      await qc.cancelQueries(['sessions', user.id]);
      const previous = qc.getQueryData(['sessions', user.id]);
      const sid = params.sessionId ?? `optimistic-session-${Date.now()}`;
      const existing = (previous ?? []).find((s) => s.id === params.sessionId);
      const preview = buildOptimisticSession(sid, params, existing);
      qc.setQueryData(['sessions', user.id], (old) => {
        const list = old ?? [];
        const idx = params.sessionId ? list.findIndex((s) => s.id === params.sessionId) : -1;
        const next = idx >= 0 ? list.map((s, i) => (i === idx ? preview : s)) : [preview, ...list];
        return next.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      });
      setShowEdit(false);
      return { previous };
    },
    onSuccess: (_, params) => {
      qc.invalidateQueries(['sessions', user.id]);
      // Auto-log calories burned to food_logs
      const sessionName = params.name || 'Session';
      const isRest = (params.name ?? '').toLowerCase().replace(/\s/g, '') === 'restday'
        || (params.name ?? '').toLowerCase().trim() === 'rest';
      if (!isRest) {
        const isCardioSession = ['cardio','run','stair','hiit','bike','swim','walk','cycle','elliptical','row']
          .some(k => (params.name ?? '').toLowerCase().includes(k));
        let burned = 0;
        if (isCardioSession) {
          burned = (params.exercises ?? []).reduce((sum, ex) =>
            sum + (ex.sets ?? []).reduce((s, st) => s + calcCardioEntryKcal(ex.name, {
              duration_min: parseFloat(st.duration_min) || 0,
              speed_kmh: parseFloat(st.speed_kmh) || 0,
              incline_pct: parseFloat(st.incline_pct) || 0,
              avg_rpm: parseFloat(st.avg_rpm) || 0,
            }), 0), 0);
        } else if (params.duration_min && params.duration_min > 0) {
          // Rough gym estimate: ~6 kcal/min for moderate resistance training
          burned = Math.round(params.duration_min * 6);
        }
        if (burned > 0) {
          supabase.from('food_logs').insert({
            user_id: user.id,
            food_name: `🏋️ Workout (${sessionName})`,
            calories: -Math.abs(burned),
            protein: 0, carbs: 0, fats: 0,
            serving_size: 'session',
            meal_type: 'other',
            logged_at: new Date().toISOString(),
          }).then(() => {
            qc.invalidateQueries(['food', user.id]);
            qc.invalidateQueries(['home', user.id]);
          });
        }
      }
    },
    onError: (e, params, context) => {
      if (context?.previous) qc.setQueryData(['sessions', user.id], context.previous);
      Alert.alert(t('workout.errorSaving'), e.message);
    },
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
      Alert.alert(t('common.error'), e.message);
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
      Alert.alert(t('common.error'), e.message);
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
    onSuccess: () => { qc.invalidateQueries(['workoutTemplates', user.id]); Alert.alert(t('workout.saved'), t('workout.templateSaved')); },
    onError: (e) => Alert.alert(t('common.error'), e.message),
  });

  const repeatTemplateMut = useMutation({
    mutationFn: ({ template, weeks, startDate }) => repeatTemplateForWeeks(user.id, template, weeks, startDate),
    onSuccess: (_, { weeks }) => {
      qc.invalidateQueries(['sessions', user.id]);
      Alert.alert(t('workout.programScheduled'), t('workout.createdFutureSessionsFromTemplate', { count: weeks }));
    },
    onError: (e) => Alert.alert(t('common.error'), e.message),
  });

  const pbMap        = useMemo(() => computePBMap(sessions), [sessions]);
  const recentTypes  = useMemo(() => getRecentTypes(sessions), [sessions]);
  const deload       = useMemo(() => detectDeload(sessions), [sessions]);
  const overtraining = useMemo(() => detectOvertraining(sessions), [sessions]);
  const muscleVolume = useMemo(() => getMuscleVolumeThisWeek(sessions), [sessions]);
  const rpeTrend     = useMemo(() => detectRpeTrend(sessions), [sessions]);
  const muscleBalance = useMemo(() => getMuscleBalance(sessions), [sessions]);

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

  const weekVolumeStats = useMemo(() => {
    const trainedDays = weekDays.filter(d => d.vol > 0);
    const totalVol = trainedDays.reduce((sum, d) => sum + d.vol, 0);
    const avgPerSession = trainedDays.length ? Math.round(totalVol / trainedDays.length) : 0;
    const restDays = weekDays.filter(d => !d.isFuture && d.vol === 0).length;
    const peak = trainedDays.length
      ? trainedDays.reduce((best, d) => (d.vol > best.vol ? d : best), trainedDays[0])
      : null;
    const peakLabel = peak ? DOW_LABELS[weekDays.findIndex(d => d.date === peak.date)] : null;
    return { totalVol: Math.round(totalVol), avgPerSession, restDays, peakLabel, peakVol: peak ? Math.round(peak.vol) : null };
  }, [weekDays]);

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
      out.push({ icon: '📈', text: t('workout.consistencyIsUp'), bold: `${c.consistencyPct - c.prevConsistencyPct}%`, rest: ' ' + t('workout.vsPrevious8WeeksMomentum') });
    } else if (c.consistencyPct < c.prevConsistencyPct) {
      out.push({ icon: '📉', text: t('workout.consistencyDipped'), bold: `${c.prevConsistencyPct - c.consistencyPct}%`, rest: ' ' + t('workout.vsPrevious8Weeks') });
    }
    if (c.currentStreak >= c.longestStreak && c.currentStreak > 0) {
      out.push({ icon: '🔥', text: t('workout.youAreOnYour'), bold: t('workout.bestEverStreak'), rest: ' ' + t('workout.atDaysDontBreakIt', { count: c.currentStreak }) });
    } else if (c.longestStreak > c.currentStreak && c.currentStreak > 0) {
      out.push({ icon: '🎯', text: t('workout.moreDaysPrefix', { count: c.longestStreak - c.currentStreak }) + ' ', bold: t('workout.tiesYourRecord'), rest: ' ' + t('workout.ofDaysSuffix', { count: c.longestStreak }) });
    }
    if (c.daysSinceLast != null && c.daysSinceLast >= 3) {
      out.push({ icon: '⚠️', text: t('workout.itsBeen'), bold: t('workout.daysCount', { count: c.daysSinceLast }), rest: ' ' + t('workout.sinceLastWorkoutGetBackIn') });
    }
    if (c.busiestDow) {
      out.push({ icon: '📅', text: t('workout.youTrainMostOftenOn'), bold: c.busiestDow, rest: ' ' + t('workout.averagingSessionsPerWeek', { value: c.avgPerWeek.toFixed(1) }) });
    }
    // Forecast: can the weekly goal still be hit with the days remaining this week?
    const doneThisWeek = weekDays.filter(d => d.type && d.type !== 'rest' && !d.isFuture).length;
    const daysLeftThisWeek = weekDays.filter(d => d.isFuture).length + (weekDays.find(d => d.isToday && !d.type) ? 1 : 0);
    const remaining = weeklyGoal - doneThisWeek;
    if (remaining > 0 && remaining <= daysLeftThisWeek) {
      out.push({ icon: '✅', text: t('workout.onPaceDash'), bold: t('workout.moreSessionsCount', { count: remaining }), rest: ' ' + t('workout.thisWeekHitsGoal', { value: weeklyGoal }) });
    } else if (remaining > daysLeftThisWeek) {
      out.push({ icon: '🚨', text: t('workout.goalAtRiskOnly'), bold: t('workout.daysLeftCount', { count: daysLeftThisWeek }), rest: ' ' + t('workout.toLogMoreSessionsForGoal', { remaining, value: weeklyGoal }) });
    }
    return out;
  }, [consistency, weekDays, weeklyGoal, t]);

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
      // hide days where all sessions are rest days
      return item.sessions.some(s => getSessionType(s.notes) !== 'rest');
    });
  }, [dayList, hideRestDays]);

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
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
    const mappedExercises = (session.workout_exercises ?? [])
      .slice().sort((a, b) => a.order_index - b.order_index)
      .map(ex => ({
        _key: ex.id,
        name: ex.exercise_name,
        group_id: ex.group_id ?? null,
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
      }));
    // Repair legacy data: if a group_id appears only once, assign it to the exercise directly above
    const groupCounts = {};
    mappedExercises.forEach(ex => { if (ex.group_id) groupCounts[ex.group_id] = (groupCounts[ex.group_id] || 0) + 1; });
    const repairedExercises = mappedExercises.slice();
    repairedExercises.forEach((ex, i) => {
      if (ex.group_id && groupCounts[ex.group_id] === 1 && i > 0 && !repairedExercises[i - 1].group_id) {
        repairedExercises[i - 1] = { ...repairedExercises[i - 1], group_id: ex.group_id };
        groupCounts[ex.group_id] = 2;
      }
    });
    setEditInitial({
      sessionId: session.id,
      date: session.date,
      name: session.notes ?? '',
      coachNotes: session.coach_notes ?? '',
      exercises: repairedExercises,
    });
    setShowDetail(false);
    setShowEdit(true);
  };

  const openNew = (prefill = {}) => {
    setEditIsNew(true);
    const exercises = (prefill.exercises ?? []).map(name => ({ _key: tid(), name, sets: [{ _key: tid(), weight_kg: '', reps: '' }] }));
    setEditInitial({ sessionId: null, date: today.toISOString().split('T')[0], name: prefill.name ?? '', planId: prefill.planId ?? null, exercises });
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
    Alert.alert(t('workout.deleteWorkout'), t('workout.removeSessionAndAllData'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteMut.mutate(sessionId) },
    ]);
  };

  const Wrap = embedded ? View : SafeAreaView;
  const wrapProps = embedded ? {} : { edges: ['top'] };

  return (
    <Wrap {...wrapProps} style={s.safe}>
      {!embedded && <ScreenHeader title={t('workout.workoutTitleUpper')} colors={colors} right={<Text style={s.sessionCount}>{t('workout.sessionsCountUpper', { count: sessions.length })}</Text>} />}

      {/* Month nav */}
      <View style={s.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={s.monthBtn}>
          <Text style={s.monthChevron}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowMonthPicker(true)}>
          <Text style={s.monthLabel}>{MONTH_FULL[viewMonth - 1]} {viewYear}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={nextMonth} style={s.monthBtn}>
          <Text style={s.monthChevron}>›</Text>
        </TouchableOpacity>
      </View>

      <MonthYearPicker
        visible={showMonthPicker}
        month={viewMonth - 1}
        year={viewYear}
        onSelect={(m, y) => { setViewMonth(m + 1); setViewYear(y); }}
        onClose={() => setShowMonthPicker(false)}
      />

      {/* Plans button */}
      <TouchableOpacity style={s.plansBtn} onPress={() => setShowPlans(true)}>
        <Ionicons name="list" size={14} color={colors.accent} />
        <Text style={s.plansBtnText}>MY PLANS</Text>
      </TouchableOpacity>

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
                    <Text style={s.heroLabel}>{t('workout.workoutSessionsLower')}</Text>
                  </View>
                  <Text style={s.heroSub}>{t('workout.thisMonthTotalVolume', { value: heroStats.totalVol.toLocaleString() })}</Text>
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
                  <Text style={s.tileLbl}>{t('workout.dayStreakUpper')}</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.totalSets}</Text>
                  <Text style={s.tileLbl}>{t('workout.totalSetsUpper')}</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.avgRpe ?? '—'}</Text>
                  <Text style={s.tileLbl}>{t('workout.avgRpeUpper')}</Text>
                </View>
              </View>
              <View style={[s.tileRow, s.tileRow2]}>
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.avgVolPerSession.toLocaleString()}</Text>
                  <Text style={s.tileLbl}>{t('workout.avgVolPerSessionUpper')}</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.heaviestLift > 0 ? `${heroStats.heaviestLift}kg` : '—'}</Text>
                  <Text style={s.tileLbl}>{t('workout.heaviestLiftUpper')}</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{heroStats.muscleGroupsHit}</Text>
                  <Text style={s.tileLbl}>{t('workout.muscleGroupsUpper')}</Text>
                </View>
              </View>
              {heroStats.pbCount > 0 && (
                <View style={s.pbInlineRow}>
                  <Text style={{ fontSize: 14 }}>🏆</Text>
                  <Text style={s.pbInlineLabel}>{t('workout.personalBestsThisMonth', { count: heroStats.pbCount })}</Text>
                </View>
              )}
            </View>

            {/* Analysis & Insights — Pro */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>{t('workout.analysisInsightsUpper')}</Text>
                <View style={s.proBadge}><Text style={s.proBadgeText}>{t('workout.proUpper')}</Text></View>
              </View>

              <View style={s.tileRow}>
                <View style={s.tile}>
                  <Text style={s.tileVal}>{hasAccess ? consistency.longestStreak : '●●'}</Text>
                  <Text style={s.tileLbl}>{t('workout.bestStreakUpper')}</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{hasAccess ? `${consistency.consistencyPct}%` : '●●%'}</Text>
                  <Text style={s.tileLbl}>{t('workout.consistency8WkUpper')}</Text>
                </View>
                <View style={s.tileColDivider} />
                <View style={s.tile}>
                  <Text style={s.tileVal}>{hasAccess ? consistency.avgPerWeek.toFixed(1) : '●.●'}</Text>
                  <Text style={s.tileLbl}>{t('workout.avgPerWeekUpper')}</Text>
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
                <>
                  {insights.length > 0 && (
                    <View style={s.insightsList}>
                      {insights.slice(0, 1).map((ins, i) => (
                        <View key={`real-${i}`} style={s.insightRow}>
                          <Text style={s.insightIcon}>{ins.icon}</Text>
                          <Text style={s.insightText}>
                            {ins.text}<Text style={s.insightBold}>{ins.bold}</Text>{ins.rest}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <TouchableOpacity activeOpacity={0.85} onPress={() => setShowInsightsPaywall(true)}>
                    <View style={s.insightsList}>
                      {(insights.length > 1
                        ? insights.slice(1)
                        : [['📈', 0.92], ['🔥', 0.68], ['📅', 0.8]].slice(insights.length)
                      ).map((ins, i) => (
                        <View key={`locked-${i}`} style={s.insightRow}>
                          <Text style={s.insightIcon}>{Array.isArray(ins) ? ins[0] : ins.icon}</Text>
                          <View style={[s.skeletonBar, { width: `${Array.isArray(ins) ? ins[1] * 100 : 80}%` }]} />
                        </View>
                      ))}
                    </View>
                    <Text style={s.lockedHint}>
                      🔒 {t('workout.unlockStreakConsistencyInsights')}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* This Week vs Last Week — session count, the consistency-first framing */}
            {isViewingCurrentMonth && (
              <View style={s.weekCompareCardMerged}>
                <View style={s.weekCompareCell}>
                  <Text style={s.weekCompareTitle}>{t('workout.thisWeekUpper')}</Text>
                  <Text style={s.weekCompareVal}>{t('workout.xOfYSessions', { x: weekCompare.thisGymCount, y: weeklyGoal })}</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textMuted }]}>{t('workout.countCardio', { count: weekCompare.thisCardioCount })}</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textMuted }]}>{t('workout.kgVolumeValue', { value: weekCompare.thisVol.toLocaleString() })}</Text>
                </View>
                <View style={s.weekCompareDivider} />
                <View style={s.weekCompareCell}>
                  <Text style={s.weekCompareTitle}>{t('workout.lastWeekUpper')}</Text>
                  <Text style={[s.weekCompareVal, { color: colors.textMuted }]}>{t('workout.sessionsCount', { count: weekCompare.lastGymCount })}</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textDim }]}>{t('workout.countCardio', { count: weekCompare.lastCardioCount })}</Text>
                  <Text style={[s.weekCompareSub, { color: colors.textDim }]}>{t('workout.kgVolumeValue', { value: weekCompare.lastVol.toLocaleString() })}</Text>
                </View>
              </View>
            )}

            {/* Week Volume bar chart */}
            {isViewingCurrentMonth && (
              <View style={s.card}>
                <View style={s.cardTitleRow}>
                  <Text style={s.cardTitle}>{t('workout.weekVolumeUpper')}</Text>
                </View>
                <View style={s.legendRow}>
                  <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.accent }]} /><Text style={s.legendLabel}>{t('workout.gym')}</Text></View>
                  <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.blue }]} /><Text style={s.legendLabel}>{t('workout.cardio')}</Text></View>
                  <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.good }]} /><Text style={s.legendLabel}>{t('workout.rest')}</Text></View>
                </View>
                <WorkoutWeekBarChart days={weekDays} colors={colors} width={chartWidth} />
                <View style={s.trendStatsRow}>
                  <WeekStatCell value={weekVolumeStats.totalVol.toLocaleString()} label={t('workout.totalVolUpper')} color={colors.accent} colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={weekVolumeStats.avgPerSession.toLocaleString()} label={t('workout.avgPerSessionUpper')} color={colors.good} colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={weekVolumeStats.peakLabel ?? '—'} label={t('workout.peakDayUpper')} color="#22d3ee" colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={String(weekVolumeStats.restDays)} label={t('workout.restDaysUpper')} color={colors.textMuted} colors={colors} />
                </View>
              </View>
            )}

            {/* Monthly heatmap */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>{t('workout.monthlyHeatmapUpper')}</Text>
              </View>
              <View style={s.legendRow}>
                <View style={s.legendItem}><Ionicons name="barbell-outline" size={11} color={colors.accent} /><Text style={s.legendLabel}>{t('workout.gym')}</Text></View>
                <View style={s.legendItem}><Ionicons name="bicycle-outline" size={11} color={colors.blue} /><Text style={s.legendLabel}>{t('workout.cardio')}</Text></View>
                <View style={s.legendItem}><Ionicons name="moon-outline" size={11} color={colors.good} /><Text style={s.legendLabel}>{t('workout.rest')}</Text></View>
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
                <Text style={s.lockedHint}>🔒 {t('workout.unlockFullWorkoutHistory')}</Text>
              )}
            </View>

            {/* Volume trend */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>{t('workout.volumeTrendUpper')}</Text>
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
                <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.purple }]} /><Text style={s.legendLabel}>{t('workout.daily')}</Text></View>
                <View style={s.legendItem}><View style={[s.legendSwatch, { backgroundColor: colors.accent }]} /><Text style={s.legendLabel}>{t('workout.sevenDayAvg')}</Text></View>
              </View>
              <VolumeTrendChart data={trendData} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={s.trendStatsRow}>
                  <WeekStatCell value={trendStats.avgVol.toLocaleString()} label={t('workout.avgPerSessionUpper')} color={colors.accent} colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={`${trendStats.sessionCount}/${trendStats.totalDays}`} label={t('workout.sessionsUpper')} color={colors.good} colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={trendStats.bestVol.toLocaleString()} label={t('workout.bestUpper')} color="#22d3ee" colors={colors} />
                  <View style={s.statDividerInline} />
                  <WeekStatCell value={trendStats.totalVol.toLocaleString()} label={t('workout.totalUpper')} color={colors.text} colors={colors} />
                </View>
              )}
            </View>

            {/* RPE Trend Alert */}
            {rpeTrend.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>RPE TREND ALERT</Text>
                {rpeTrend.map((alert, i) => (
                  <View key={i} style={s.rpeAlertRow}>
                    <View style={s.rpeAlertIcon}>
                      <Text style={{ fontSize: 16 }}>📈</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rpeAlertName} numberOfLines={1}>{alert.exercise}</Text>
                      <Text style={s.rpeAlertSub}>
                        Avg RPE {alert.recentRpe} ({alert.delta > 0 ? '+' : ''}{alert.delta} vs prior 2 sessions) — consider a deload set or lighter week
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Muscle Group Balance (Push / Pull / Legs / Core) */}
            {muscleBalance && muscleBalance.length > 0 && (
              <View style={s.card}>
                <Text style={s.cardTitle}>PUSH · PULL · LEGS BALANCE</Text>
                <Text style={s.cardSubtitle}>This week's training distribution</Text>
                {muscleBalance.map(({ group, vol, pct }) => {
                  const balanceColor = group === 'Push' ? '#fb7185' : group === 'Pull' ? '#60a5fa' : group === 'Legs' ? '#fbbf24' : '#34d399';
                  return (
                    <View key={group} style={s.muscleBarRow}>
                      <Text style={[s.muscleBarLabel, { color: balanceColor }]}>{group}</Text>
                      <View style={s.muscleBarTrack}>
                        <View style={[s.muscleBarFill, { width: `${Math.max(4, pct)}%`, backgroundColor: balanceColor }]} />
                      </View>
                      <Text style={s.muscleBarVal}>{pct}%</Text>
                    </View>
                  );
                })}
                {(() => {
                  const push = muscleBalance.find(m => m.group === 'Push')?.pct ?? 0;
                  const pull = muscleBalance.find(m => m.group === 'Pull')?.pct ?? 0;
                  if (push > 0 && pull > 0) {
                    const ratio = (push / Math.max(pull, 1)).toFixed(1);
                    const isBalanced = ratio >= 0.8 && ratio <= 1.4;
                    return (
                      <View style={[s.deloadBanner, { marginTop: 10, backgroundColor: isBalanced ? '#22c55e18' : '#f59e0b18', borderColor: isBalanced ? '#22c55e40' : '#f59e0b40' }]}>
                        <Text style={[s.deloadBannerText, { color: isBalanced ? '#22c55e' : '#f59e0b' }]}>
                          {isBalanced ? `✅ Push:Pull ratio ${ratio}:1 — well balanced` : `⚠️ Push:Pull ratio ${ratio}:1 — aim for 1:1 to protect shoulders`}
                        </Text>
                      </View>
                    );
                  }
                  return null;
                })()}
              </View>
            )}

            {/* Muscle Group Volume + Auto-Deload — Pro */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>{t('workout.muscleGroupVolumeThisWeekUpper')}</Text>
                <View style={s.proBadge}><Text style={s.proBadgeText}>{t('workout.proUpper')}</Text></View>
              </View>

              {muscleExpanded && (hasAccess ? (
                <>
                  {deload && (
                    <View style={s.deloadBanner}>
                      <Text style={s.deloadBannerText}>
                        ⚠️ {t('workout.avgRpeDeloadWarning', { value: deload.avg })}
                      </Text>
                    </View>
                  )}
                  {overtraining && (
                    <View style={s.deloadBanner}>
                      <Text style={s.deloadBannerText}>
                        🔥 {t('workout.overtrainingWarning', { muscle: overtraining.muscle, days: overtraining.days })}
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
                    <Text style={s.lockedHint}>{t('workout.logGymSessionForMuscleBalance')}</Text>
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
                    🔒 {t('workout.unlockMuscleGroupBalanceAndMore')}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                onPress={() => setMuscleExpanded(v => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: muscleExpanded ? 12 : 0 }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.accent }}>
                  {muscleExpanded ? t('workout.collapse') : t('workout.expand')}
                </Text>
                <Ionicons name={muscleExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.accent} />
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>{t('workout.workoutHistoryUpper')}</Text>
            <TouchableOpacity onPress={toggleHideRestDays} style={s.collapseToggleWrap} activeOpacity={0.75}>
              <Text style={s.collapseToggleText}>
                {hasAccess ? (hideRestDays ? t('workout.showAllUpper') : t('workout.hideRestDaysUpper')) : `🔒 ${t('workout.hideRestDaysUpper')}`}
              </Text>
              <View style={[s.toggleSwitch, hideRestDays && s.toggleSwitchOn]}>
                <View style={[s.toggleKnob, hideRestDays && s.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

        {!isLoading && visibleDayList.length === 0 && (
          sessions.length === 0 ? (
            <EmptyState
              emoji="🏋️"
              title="No workouts logged yet"
              subtitle="Start tracking to see your progress here"
            />
          ) : (
            <EmptyState
              emoji="📅"
              title={dayList.length === 0
                ? t('workout.noSessionsInMonth', { month: MONTH_NAMES[viewMonth - 1], year: viewYear })
                : t('workout.allSessionsAreRestDays')}
              subtitle={t('workout.tapPlusToLogWorkout')}
            />
          )
        )}

        {visibleDayList.map(item => {
          const { date, sessions: daySessions } = item;

          // Pure rest day
          if (daySessions.length === 1 && (daySessions[0].notes ?? '').toLowerCase() === 'rest day') {
            const sess = daySessions[0];
            return (
              <TouchableOpacity
                key={date}
                style={s.restCard}
                onPress={() => {
                  setEditIsNew(true);
                  setEditInitial({ sessionId: null, date, name: t('workout.restDay'), exercises: [] });
                  setShowEdit(true);
                }}
                activeOpacity={0.75}
              >
                <View style={s.restIcon}><Text style={{ fontSize: 20 }}>😴</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.restTitle}>{t('workout.restDay')}</Text>
                  <Text style={s.restSub}>{t('workout.recoveryNoWorkout', { date: fmtDate(date) })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={colors.good} />
              </TouchableOpacity>
            );
          }

          // Single session — original card
          if (daySessions.length === 1) {
            const sess = daySessions[0];
            const ws   = getWorkoutStyle(sess.notes, colors);
            const vol  = sess.total_volume ?? calcSessionVol(sess);
            const delta = vol > 0 ? getVolumeDelta(sess, sessions) : null;
            const exs  = sess.workout_exercises ?? [];
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
                      {sess.notes || t('workout.workout')}
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
                  {!!sess.coach_notes && (
                    <Text style={s.sessionNoteSnippet} numberOfLines={1}>📋 {sess.coach_notes}</Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.textDim} />
              </TouchableOpacity>
            );
          }

          // Multiple sessions on same day — merged card
          const totalVol = daySessions.reduce((sum, s) => sum + (s.total_volume ?? calcSessionVol(s)), 0);
          const totalExs = daySessions.reduce((sum, s) => sum + (s.workout_exercises ?? []).length, 0);
          const totalKcal = daySessions.reduce((sum, s) => sum + (s.calories_burned ?? 0), 0);
          const names = daySessions.map(s => s.notes || t('workout.workout')).join(' + ');
          return (
            <TouchableOpacity
              key={date}
              style={[s.sessionCard, { backgroundColor: colors.card, borderColor: colors.accent + '40', flexDirection: 'row', alignItems: 'center', gap: 10 }]}
              onPress={() => setDayPickerSessions(daySessions)}
              activeOpacity={0.82}
            >
              <View style={[s.sessionIcon, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '40' }]}>
                <Text style={{ fontSize: 18 }}>🗓️</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.sessionName, { color: colors.accent }]} numberOfLines={1}>{names}</Text>
                <Text style={s.sessionSub}>
                  {fmtDate(date)} · {daySessions.length} sessions · {totalExs}ex
                  {totalVol > 0 ? ` · ${totalVol.toLocaleString()}kg` : ''}
                  {totalKcal > 0 ? ` · 🔥${totalKcal}kcal` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
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

      {/* Day session picker — shown when multiple sessions on same day */}
      {dayPickerSessions && (
        <Modal transparent animationType="slide" onRequestClose={() => setDayPickerSessions(null)}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setDayPickerSessions(null)} />
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: 12 }}>
              {dayPickerSessions[0]?.date ? fmtDate(dayPickerSessions[0].date) : ''} · {dayPickerSessions.length} SESSIONS
            </Text>
            {dayPickerSessions.map((sess, idx) => {
              const ws = getWorkoutStyle(sess.notes, colors);
              const vol = sess.total_volume ?? calcSessionVol(sess);
              const exs = sess.workout_exercises ?? [];
              return (
                <TouchableOpacity
                  key={sess.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: ws.cardBg, borderWidth: 1, borderColor: ws.cardBorder, marginBottom: 10 }}
                  onPress={() => { setDayPickerSessions(null); openDetail(sess); }}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 22 }}>{ws.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: ws.titleColor }} numberOfLines={1}>{sess.notes || 'Workout'}</Text>
                    <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{exs.length}ex{vol > 0 ? ` · ${vol.toLocaleString()}kg` : ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                </TouchableOpacity>
              );
            })}
          </View>
        </Modal>
      )}

      <PlansModal
        visible={showPlans}
        plans={orderedPlansMain}
        onSaveOrder={saveOrderMain}
        onClose={() => setShowPlans(false)}
        onCreate={(name) => createPlanMut.mutate(name)}
        onRename={(planId, name) => renamePlanMut.mutate({ planId, name })}
        onDelete={(planId, planName) => deletePlanMut.mutate({ planId, planName })}
        onCopy={(plan) => copyPlanMut.mutate(plan)}
        onSelect={(plan, exercises) => { setShowPlans(false); openNew({ name: plan.name, planId: plan.id, exercises }); }}
        onSaveTemplate={(planId, exercises) => savePlanTemplateMut.mutate({ planId, exercises })}
        allSessions={sessions}
      />

      <EditSessionModal
        visible={showEdit}
        isNew={editIsNew}
        initialData={editInitial}
        recentTypes={recentTypes}
        allSessions={sessions}
        plans={orderedPlansMain}
        onSave={async (data) => {
          let planId = data.planId ?? editInitial?.planId ?? null;
          const trimmedName = (data.name ?? '').trim();
          if (!planId && trimmedName) {
            const match = plans.find(p => p.name.toLowerCase() === trimmedName.toLowerCase());
            if (match) {
              planId = match.id;
            } else {
              try {
                const newPlan = await createPlan(user.id, trimmedName);
                qc.invalidateQueries(['workoutPlans', user.id]);
                planId = newPlan?.id ?? null;
              } catch {}
            }
          }
          saveMut.mutate({ ...data, sessionId: editInitial?.sessionId ?? null, planId });
        }}
        onCancel={() => setShowEdit(false)}
        hasAccess={hasAccess}
        templates={templates}
        onSaveTemplate={(params) => saveTemplateMut.mutate(params)}
        onSaveAsPlan={async ({ name: planName, exercises }) => {
          try {
            const newPlan = await createPlan(user.id, planName);
            if (newPlan?.id) {
              savePlanTemplateMut.mutate({ planId: newPlan.id, exercises: exercises.map(e => ({ name: e.name })) });
            }
            Alert.alert('Plan Saved', `"${planName}" added to My Plans with ${exercises.length} exercise${exercises.length !== 1 ? 's' : ''}.`);
          } catch (e) {
            Alert.alert('Error', 'Could not save plan.');
          }
        }}
        onRepeatTemplate={(params) => repeatTemplateMut.mutate(params)}
        isRepeatingTemplate={repeatTemplateMut.isPending}
        onOpenToolsPaywall={() => setShowToolsPaywall(true)}
      />

      <PaywallModal visible={showTrendPaywall} onClose={() => setShowTrendPaywall(false)} />
      <PaywallModal visible={showInsightsPaywall} onClose={() => setShowInsightsPaywall(false)} />
      <PaywallModal visible={showToolsPaywall} onClose={() => setShowToolsPaywall(false)} />

      <BottomSheet visible={showWorkoutGoalSheet} onClose={() => setShowWorkoutGoalSheet(false)} style={s.goalSheet}>
        <View style={s.goalSheetHeader}>
          <Text style={s.goalSheetTitle}>🎯 {t('workout.weeklyWorkoutGoalUpper')}</Text>
          <TouchableOpacity onPress={() => setShowWorkoutGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={s.goalBigVal}>{workoutGoalInput}</Text>
        <Text style={s.goalBigSub}>{t('workout.sessionsPerWeek', { count: workoutGoalInput })}</Text>

        <Text style={s.goalFieldLabel}>{t('workout.daysPerWeekUpper')}</Text>
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
        <Text style={s.goalHint}>{t('workout.weeklyGoalHint')}</Text>

        <TouchableOpacity
          style={s.goalSaveBtn}
          onPress={() => goalMut.mutate(workoutGoalInput)}
          disabled={goalMut.isPending}
        >
          <Text style={s.saveBtnText}>{goalMut.isPending ? t('workout.savingEllipsis') : t('workout.saveGoal')}</Text>
        </TouchableOpacity>
      </BottomSheet>
    </Wrap>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const createS = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  plansBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  plansBtnText: { fontSize: 11, fontWeight: weight.bold, color: colors.accent, letterSpacing: 0.5 },

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
  cardSubtitle: { fontSize: typography.xs, color: colors.textMuted, marginBottom: 8 },
  rpeAlertRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  rpeAlertIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#f59e0b18', alignItems: 'center', justifyContent: 'center' },
  rpeAlertName: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  rpeAlertSub: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2, lineHeight: 16 },

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
  sessionNoteSnippet: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.body, marginTop: 2 },

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

  supersetBadgeRow: {
    position: 'absolute', top: -9, left: 0, right: 0, alignItems: 'center', zIndex: 10,
  },
  supersetBadge: {
    backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1, borderColor: colors.purple,
  },
  supersetBadgeText: {
    fontSize: 9, fontWeight: weight.bold, color: colors.purple,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },

  exCard: {
    backgroundColor: colors.card, borderRadius: 12, padding: 10,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  exCardInGroup: { backgroundColor: colors.card, padding: 10 },
  exCardInGroupDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  supersetGroup: {
    borderWidth: 1.5, borderColor: colors.purple, borderRadius: 12,
    marginBottom: 8, overflow: 'hidden',
  },
  supersetGroupDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 5, paddingHorizontal: 10,
    backgroundColor: colors.purple + '18',
  },
  supersetGroupLine: { flex: 1, height: 1, backgroundColor: colors.purple + '44' },
  supersetGroupHeaderText: {
    fontSize: 10, fontWeight: weight.bold, color: colors.purple,
    letterSpacing: 1.4, textTransform: 'uppercase',
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

  exIconCompact: { width: 26, height: 26, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  compactToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  compactToggleText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1 },
  exCardCompact: { paddingVertical: 7, paddingHorizontal: 10 },
  exCardCompactRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exNameCompact: { fontSize: typography.xs, fontFamily: fontFamily.bodyExtraBold, color: colors.text, letterSpacing: 0.3 },
  pbCompact: { fontSize: 11 },
  compactSetRow: { flexDirection: 'row', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  compactSetChip: {
    backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.border,
  },
  compactSetChipBest: { borderColor: colors.accent + '88', backgroundColor: colors.accent + '14' },
  compactSetChipText: { fontSize: 10, color: colors.textDim, fontWeight: weight.bold },
  compactSetChipTextBest: { color: colors.accent },
  compactMuscleText: { fontSize: 9, color: colors.textMuted, maxWidth: 60, textAlign: 'right' },

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

  coachNotesCard: {
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: colors.accent + '0d',
    borderRadius: 12, borderWidth: 1, borderColor: colors.accent + '30',
    padding: 14,
  },
  coachNotesHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  coachNotesTitle: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },
  coachNotesText: { fontSize: 13, fontFamily: fontFamily.body, color: colors.text, lineHeight: 20 },
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
  exCardInGroup: {
    backgroundColor: colors.card, overflow: 'hidden',
  },
  exCardInGroupDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  supersetGroup: {
    borderWidth: 1.5, borderColor: colors.purple, borderRadius: 12,
    marginBottom: 8, overflow: 'hidden',
  },
  supersetGroupDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 5, paddingHorizontal: 10,
    backgroundColor: colors.purple + '18',
  },
  supersetGroupLine: { flex: 1, height: 1, backgroundColor: colors.purple + '44' },
  supersetGroupHeaderText: {
    fontSize: 10, fontWeight: weight.bold, color: colors.purple,
    letterSpacing: 1.4, textTransform: 'uppercase',
  },
  exCardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  exCardHeaderTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  dragHandle: { padding: 8, alignItems: 'center', justifyContent: 'center' },
  dragHandleActive: { opacity: 0.7 },
  exCardDragging: { borderColor: colors.accent, opacity: 0.85, backgroundColor: colors.surface },
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

  saveShortcutRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  savePlanBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 10, borderRadius: 10,
    backgroundColor: colors.accent + '18', borderWidth: 1, borderColor: colors.accent + '44',
  },
  savePlanBtnText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  saveTemplateHalfBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 10, borderRadius: 10,
    backgroundColor: colors.purple + '18', borderWidth: 1, borderColor: colors.purple + '44',
  },
  saveTemplateHalfBtnText: { fontSize: 12, fontWeight: '700', color: colors.purple },
  bottomRow: {
    flexDirection: 'row', gap: 10, padding: 12,
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
  prevPerfPrior: { color: colors.textDim },
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

  supersetBadgeRow: {
    position: 'absolute', top: -9, left: 0, right: 0, alignItems: 'center', zIndex: 10,
  },
  supersetBadge: {
    backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1, borderColor: colors.purple,
  },
  supersetBadgeText: {
    fontSize: 9, fontWeight: weight.bold, color: colors.purple,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  supersetStrip: { width: 4, backgroundColor: colors.purple, borderRadius: 2, marginBottom: 6 },
  supersetToggleBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: colors.purple + '55',
    backgroundColor: colors.purple + '11',
  },
  supersetToggleBtnActive: {
    backgroundColor: colors.purple + '33', borderColor: colors.purple,
  },
  supersetToggleBtnText: { fontSize: 11, color: colors.purple, fontWeight: weight.semibold },
  supersetToggleBtnTextActive: { color: colors.purple },

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
  programBoxTitle: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text, marginBottom: 6 },
  programExplainerText: { fontSize: 11, color: colors.textMuted, lineHeight: 16, marginBottom: 10 },
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

  autoRestBar: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.accent + '44',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  autoRestProgressTrack: {
    height: 3,
    backgroundColor: colors.dim,
    borderRadius: 2,
    marginBottom: 6,
    overflow: 'hidden',
  },
  autoRestProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  autoRestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 4,
  },
  autoRestText: {
    fontSize: typography.sm,
    fontFamily: fontFamily.bodyBold,
    color: colors.accent,
  },
  autoRestCycleTip: {
    fontSize: typography.xs,
    color: colors.textDim,
    fontFamily: fontFamily.body,
  },
  autoRestSkip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  autoRestSkipText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: '600',
  },

  coachNotesWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  coachNotesInput: {
    backgroundColor: colors.dim,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 12,
    fontSize: typography.sm, color: colors.text, fontFamily: fontFamily.body,
    minHeight: 80,
  },
});

