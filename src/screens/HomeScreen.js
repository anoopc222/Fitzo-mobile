import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, Dimensions, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import BottomSheet from '../components/ui/BottomSheet';
import ScreenHeader from '../components/ScreenHeader';

const SCREEN_W  = Dimensions.get('window').width;
const CAL_PAD   = 16;  // horizontal padding inside the calendar section
const CAL_GAP   = 3;   // gap between cells
const MODAL_W   = Math.min(SCREEN_W - 40, 420) - 2; // overlay padding(20*2) + popup maxWidth - popup border(1*2)
const CAL_CELL  = Math.floor((MODAL_W - CAL_PAD * 2 - CAL_GAP * 6) / 7);
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import Svg, { Polyline, Line } from 'react-native-svg';
import Sparkline from '../components/Sparkline';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import PaywallModal from '../components/ui/PaywallModal';
import { useGatedExport } from '../hooks/useGatedExport';
import { useSubscription } from '../context/SubscriptionContext';
import { useMoreMenu } from '../context/MoreMenuContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── accent palette (matches ActivityTracker web app) ──────────────────────
const C_WEIGHT = '#fb7185'; // rose
const C_STEPS  = '#f59e0b'; // amber gold
const C_KCAL   = '#fb7185'; // rose
const C_SLEEP  = '#c4b5fd'; // soft violet
const C_GREEN  = '#34d399';

// Styles will be defined later using static colors

// ─── helpers ────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  if (h < 21) return 'GOOD EVENING';
  return 'GOOD NIGHT';
}

// Local calendar date as YYYY-MM-DD — never use Date#toISOString() for this,
// it converts through UTC and shifts the date for non-UTC timezones.
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekRange(offsetWeeks = 0) {
  const now = new Date();
  const dow = now.getDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const start = new Date(now);
  start.setDate(now.getDate() + monOffset - offsetWeeks * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [localDateStr(start), localDateStr(end)];
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [localDateStr(start), localDateStr(end)];
}

function fmtWeekLabel() {
  const now = new Date();
  const dow = now.getDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const start = new Date(now);
  start.setDate(now.getDate() + monOffset);
  return `${start.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} – Today`;
}

function fmtLastWeekLabel() {
  const [start, end] = getWeekRange(1);
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}

function fmtK(n) {
  if (n == null || n === 0) return '—';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function classifySession(notes) {
  if (!notes) return 'gym';
  const n = notes.toLowerCase();
  if (n === 'rest day') return 'rest';
  if (['cardio','run','stair','hiit','bike','swim','walk','cycle','elliptical'].some(k => n.includes(k))) return 'cardio';
  return 'gym';
}

const CAL_MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAL_DAY_MON      = ['Mo','Tu','We','Th','Fr','Sa','Su'];

// ─── quick-log helpers (nudge cards) ───────────────────────────────────────
async function quickLogWeight(userId, weightKg) {
  const date = localDateStr(new Date());
  const existing = await supabase
    .from('weight_logs').select('id').eq('user_id', userId).eq('logged_at', date).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const { error } = await supabase.from('weight_logs').update({ weight: weightKg }).eq('id', existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('weight_logs').insert({ user_id: userId, weight: weightKg, logged_at: date });
    if (error) throw error;
  }
}

async function quickLogSleep(userId, hours) {
  const date = localDateStr(new Date());
  const existing = await supabase
    .from('sleep_logs').select('id').eq('user_id', userId).eq('logged_at', date).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    const { error } = await supabase.from('sleep_logs').update({ hours }).eq('id', existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('sleep_logs').insert({ user_id: userId, hours, logged_at: date });
    if (error) throw error;
  }
}

// ─── data fetch ─────────────────────────────────────────────────────────────
async function fetchHome(userId) {
  const today = localDateStr(new Date());
  const [thisWeekStart, thisWeekEnd] = getWeekRange(0);
  const [lastWeekStart, lastWeekEnd] = getWeekRange(1);
  const [monthStart, monthEnd] = getMonthRange();

  const [
    profile,
    weightHist,
    stepsHist,
    foodToday,
    sleepHist,
    todayWorkout,
    lastWorkout,
    thisWeekWorkouts,
    lastWeekWorkouts,
    monthWorkouts,
    thisWeekSteps,
    lastWeekSteps,
    monthSteps,
    thisWeekFood,
    lastWeekFood,
    monthFood,
    monthWeight,
    prExercises,
    streakStepsHist,
  ] = await Promise.all([
    supabase.from('profiles')
      .select('full_name, goal, weight_goal_kg, step_goal, sleep_goal_hours, workout_weekly_goal')
      .eq('id', userId).single(),
    supabase.from('weight_logs')
      .select('weight, logged_at').eq('user_id', userId)
      .order('logged_at', { ascending: false }).limit(10),
    supabase.from('step_logs')
      .select('steps, goal, logged_at').eq('user_id', userId)
      .order('logged_at', { ascending: false }).limit(10),
    supabase.from('food_logs')
      .select('calories, protein').eq('user_id', userId)
      .gte('logged_at', `${today}T00:00:00`).lte('logged_at', `${today}T23:59:59`),
    supabase.from('sleep_logs')
      .select('hours, quality, logged_at').eq('user_id', userId)
      .order('logged_at', { ascending: false }).limit(8),
    supabase.from('workout_sessions')
      .select('id, notes, workout_exercises(id, exercise_name, sets(id))')
      .eq('user_id', userId).eq('date', today),
    supabase.from('workout_sessions')
      .select('date, notes').eq('user_id', userId)
      .order('date', { ascending: false }).limit(1),
    supabase.from('workout_sessions')
      .select('id, notes').eq('user_id', userId)
      .gte('date', thisWeekStart).lte('date', thisWeekEnd),
    supabase.from('workout_sessions')
      .select('id, notes').eq('user_id', userId)
      .gte('date', lastWeekStart).lte('date', lastWeekEnd),
    supabase.from('workout_sessions')
      .select('id, notes').eq('user_id', userId)
      .gte('date', monthStart).lte('date', monthEnd),
    supabase.from('step_logs')
      .select('steps, goal, logged_at').eq('user_id', userId)
      .gte('logged_at', `${thisWeekStart}T00:00:00`).lte('logged_at', `${thisWeekEnd}T23:59:59`)
      .order('logged_at', { ascending: true }),
    supabase.from('step_logs')
      .select('steps, goal, logged_at').eq('user_id', userId)
      .gte('logged_at', `${lastWeekStart}T00:00:00`).lte('logged_at', `${lastWeekEnd}T23:59:59`)
      .order('logged_at', { ascending: true }),
    supabase.from('step_logs')
      .select('steps, goal').eq('user_id', userId)
      .gte('logged_at', `${monthStart}T00:00:00`).lte('logged_at', `${monthEnd}T23:59:59`),
    supabase.from('food_logs')
      .select('calories, logged_at').eq('user_id', userId)
      .gte('logged_at', `${thisWeekStart}T00:00:00`).lte('logged_at', `${thisWeekEnd}T23:59:59`),
    supabase.from('food_logs')
      .select('calories').eq('user_id', userId)
      .gte('logged_at', `${lastWeekStart}T00:00:00`).lte('logged_at', `${lastWeekEnd}T23:59:59`),
    supabase.from('food_logs')
      .select('calories, logged_at').eq('user_id', userId)
      .gte('logged_at', `${monthStart}T00:00:00`).lte('logged_at', `${monthEnd}T23:59:59`),
    supabase.from('weight_logs')
      .select('weight').eq('user_id', userId)
      .gte('logged_at', `${monthStart}T00:00:00`).lte('logged_at', `${monthEnd}T23:59:59`),
    supabase.from('workout_exercises')
      .select('exercise_name, sets(weight_kg), workout_sessions!inner(date, user_id)')
      .eq('workout_sessions.user_id', userId)
      .order('exercise_name', { ascending: true }),
    supabase.from('step_logs')
      .select('logged_at').eq('user_id', userId)
      .order('logged_at', { ascending: false }).limit(120),
  ]);

  const weightArr = (weightHist.data ?? []).map(w => w.weight).reverse();
  const stepsArr  = (stepsHist.data ?? []).map(s => s.steps).reverse();
  const sleepArr  = (sleepHist.data ?? []).map(s => s.hours).reverse();

  const latestWeight = weightHist.data?.[0];
  const prevWeight   = weightHist.data?.[1];
  const latestSteps  = stepsHist.data?.[0];
  const latestSleep  = sleepHist.data?.[0];

  const stepGoal   = profile.data?.step_goal ?? 10000;
  const sleepGoal  = profile.data?.sleep_goal_hours ?? 8;
  const weeklyGoal = profile.data?.workout_weekly_goal ?? 4;

  const weightDeltaVsYday = (latestWeight && prevWeight)
    ? +(latestWeight.weight - prevWeight.weight).toFixed(1) : null;
  const stepGoalMet  = latestSteps ? latestSteps.steps >= (latestSteps.goal ?? stepGoal) : false;
  const sleepGoalMet = latestSleep ? latestSleep.hours >= sleepGoal : false;

  const todayStr = localDateStr(new Date());
  const ydayStr  = localDateStr(new Date(Date.now() - 86400000));
  const stepsIsYesterday = latestSteps?.logged_at?.slice(0, 10) === ydayStr;
  const sleepIsToday     = latestSleep?.logged_at?.slice(0, 10) === todayStr;
  const daysSinceSteps = latestSteps?.logged_at
    ? Math.floor((Date.now() - new Date(latestSteps.logged_at).getTime()) / 86400000) : null;

  const todayKcal    = (foodToday.data ?? []).reduce((s, f) => s + (f.calories ?? 0), 0);
  const todayProtein = (foodToday.data ?? []).reduce((s, f) => s + (f.protein ?? 0), 0);

  // Today's workout
  const todaySessions = todayWorkout.data ?? [];
  const todaySession  = todaySessions[0] ?? null;
  const hasTodayWorkout = !!todaySession;
  const todayExCount  = todaySession?.workout_exercises?.length ?? 0;
  const todaySetCount = (todaySession?.workout_exercises ?? [])
    .reduce((s, ex) => s + (ex.sets?.length ?? 0), 0);
  const todayWorkoutName = todaySession?.notes?.trim()
    || (todaySession?.workout_exercises?.[0]?.exercise_name ? 'Workout' : 'Workout');

  // Weekly / Monthly
  const thisWeekSessions = (thisWeekWorkouts.data ?? []).filter(s => classifySession(s.notes) === 'gym').length;
  const lastWeekSessions = (lastWeekWorkouts.data ?? []).filter(s => classifySession(s.notes) === 'gym').length;
  const monthSessions    = (monthWorkouts.data ?? []).filter(s => classifySession(s.notes) === 'gym').length;
  const monthCardioCount = (monthWorkouts.data ?? []).filter(s => classifySession(s.notes) === 'cardio').length;
  const monthRestCount   = (monthWorkouts.data ?? []).filter(s => classifySession(s.notes) === 'rest').length;
  const thisWeekStepsArr = thisWeekSteps.data ?? [];
  const lastWeekStepsArr = lastWeekSteps.data ?? [];
  const monthStepsArr    = monthSteps.data ?? [];
  const thisWeekStepsSum = thisWeekStepsArr.reduce((s, r) => s + r.steps, 0);
  const lastWeekStepsSum = lastWeekStepsArr.reduce((s, r) => s + r.steps, 0);
  const monthStepsTotal  = monthStepsArr.reduce((s, r) => s + r.steps, 0);
  // The "STEPS" stat tile shows the average daily steps for the period, not the raw sum.
  const thisWeekStepsAvg = thisWeekStepsArr.length ? Math.round(thisWeekStepsSum / thisWeekStepsArr.length) : 0;
  const lastWeekStepsAvg = lastWeekStepsArr.length ? Math.round(lastWeekStepsSum / lastWeekStepsArr.length) : 0;
  const thisWeekKcal = (thisWeekFood.data ?? []).reduce((s, r) => s + (r.calories ?? 0), 0);
  const thisWeekKcalDays = new Set((thisWeekFood.data ?? []).map(r => r.logged_at.slice(0, 10))).size;
  const lastWeekKcal = (lastWeekFood.data ?? []).reduce((s, r) => s + (r.calories ?? 0), 0);
  const monthKcal    = (monthFood.data ?? []).reduce((s, r) => s + (r.calories ?? 0), 0);
  const thisWeekGoalDays = thisWeekStepsArr.filter(l => l.steps >= (l.goal ?? stepGoal)).length;
  const lastWeekGoalDays = lastWeekStepsArr.filter(l => l.steps >= (l.goal ?? stepGoal)).length;
  const monthGoalDays    = monthStepsArr.filter(l => l.steps >= (l.goal ?? stepGoal)).length;
  const monthAvgSteps    = monthStepsArr.length ? Math.round(monthStepsTotal / monthStepsArr.length) : 0;
  const monthWeightArr   = monthWeight.data ?? [];
  const monthAvgWeight   = monthWeightArr.length
    ? +(monthWeightArr.reduce((s, w) => s + w.weight, 0) / monthWeightArr.length).toFixed(1)
    : null;

  // Weight change helper: earliest vs latest log within a date range
  const weightDeltaFor = (startDate, endDate) => {
    const logs = (weightHist.data ?? []).filter(w => w.logged_at >= startDate && w.logged_at <= `${endDate}T23:59:59`);
    return logs.length >= 2
      ? +(logs[0].weight - logs[logs.length - 1].weight).toFixed(1)
      : null;
  };
  const weekWeightDelta  = weightDeltaFor(thisWeekStart, thisWeekEnd);
  const lastWeekWeightDelta = weightDeltaFor(lastWeekStart, lastWeekEnd);
  const monthWeightDelta = weightDeltaFor(monthStart, monthEnd);

  // Pro-only goal forecast: linear-trend projection of days remaining to
  // reach the user's weight goal, using the oldest/newest of the last 10 logs.
  const weightGoalKg = profile.data?.weight_goal_kg ?? null;
  let goalForecast = null;
  if (weightGoalKg != null && (weightHist.data?.length ?? 0) >= 2) {
    const newest = weightHist.data[0];
    const oldest = weightHist.data[weightHist.data.length - 1];
    const daysSpan = (new Date(newest.logged_at) - new Date(oldest.logged_at)) / 86400000;
    const kgPerDay = daysSpan > 0 ? (newest.weight - oldest.weight) / daysSpan : 0;
    const kgRemaining = weightGoalKg - newest.weight;
    if (kgPerDay !== 0 && Math.sign(kgPerDay) === Math.sign(kgRemaining)) {
      const daysToGoal = Math.round(kgRemaining / kgPerDay);
      if (daysToGoal > 0 && daysToGoal < 3650) {
        const forecastDate = new Date(Date.now() + daysToGoal * 86400000);
        goalForecast = {
          daysToGoal,
          forecastDate,
          weeklyPaceKg: +(kgPerDay * 7).toFixed(2),
          kgRemaining: +Math.abs(kgRemaining).toFixed(1),
        };
      }
    }
  }

  // Pro-only strength PR watch: closest exercise to a new all-time best,
  // comparing each exercise's all-time top set against its best set in the
  // last 30 days.
  let prWatch = null;
  {
    const exMap = {};
    (prExercises.data ?? []).forEach(ex => {
      const sessDate = ex.workout_sessions?.date;
      const topSet = (ex.sets ?? []).reduce(
        (b, st) => (st.weight_kg ?? 0) > b ? (st.weight_kg ?? 0) : b, 0
      );
      if (!topSet) return;
      if (!exMap[ex.exercise_name]) exMap[ex.exercise_name] = { best: 0, recentBest: 0 };
      const e = exMap[ex.exercise_name];
      if (topSet > e.best) e.best = topSet;
      const daysAgo = sessDate ? (Date.now() - new Date(sessDate).getTime()) / 86400000 : 9999;
      if (daysAgo <= 30 && topSet > e.recentBest) e.recentBest = topSet;
    });
    Object.entries(exMap).forEach(([name, e]) => {
      if (e.recentBest > 0 && e.recentBest < e.best) {
        const gapKg = +(e.best - e.recentBest).toFixed(1);
        if (!prWatch || gapKg < prWatch.gapKg) {
          prWatch = { exercise: name, gapKg, prKg: e.best, recentKg: e.recentBest };
        }
      }
    });
  }

  // Pro-only recovery score: blends last logged sleep duration vs goal with
  // sleep quality rating.
  let recoveryScore = null;
  {
    const last = sleepHist.data?.[0];
    if (last && Number.isFinite(last.hours)) {
      const qualityScore = Number.isFinite(last.quality) ? last.quality : 3;
      recoveryScore = Math.min(100, Math.max(0,
        Math.round((last.hours / sleepGoal) * 70 + qualityScore * 6)
      ));
    }
  }

  // Pro-only longest streak record: best-ever consecutive run of logged-step
  // days within the last 120 days, for comparison against the current streak.
  let longestStreak = 0;
  {
    const streakDates = new Set((streakStepsHist.data ?? []).map(s => localDateStr(new Date(s.logged_at))));
    let run = 0;
    for (let i = 0; i < 120; i++) {
      const d = localDateStr(new Date(Date.now() - i * 86400000));
      if (streakDates.has(d)) { run++; longestStreak = Math.max(longestStreak, run); }
      else run = 0;
    }
  }

  // Pro-only true-maintenance insight: compares average logged calorie intake
  // against actual monthly weight change to estimate real maintenance
  // calories (≈7700 kcal per kg of bodyweight change), vs. the user's set
  // calorie target.
  let calorieInsight = null;
  {
    const loggedDays = new Set((monthFood.data ?? []).map(f => f.logged_at?.slice(0, 10))).size;
    const rangeDays = Math.max(1, Math.round((new Date(monthEnd) - new Date(monthStart)) / 86400000) + 1);
    if (loggedDays >= 10 && monthWeightDelta != null) {
      const avgDailyIntake = monthKcal / loggedDays;
      const dailyImbalance = (monthWeightDelta * 7700) / rangeDays;
      const trueMaintenance = Math.round(avgDailyIntake - dailyImbalance);
      const targetKcal = profile.data?.calorie_target ?? null;
      if (trueMaintenance > 800 && trueMaintenance < 6000) {
        calorieInsight = {
          trueMaintenance,
          avgDailyIntake: Math.round(avgDailyIntake),
          targetKcal,
          diffVsTarget: targetKcal ? trueMaintenance - targetKcal : null,
        };
      }
    }
  }

  // Pro-only sleep debt: cumulative shortfall vs. goal across recent logged
  // nights, plus a simple estimate of nights needed to recover at +1h/night.
  let sleepDebt = null;
  {
    const recent = (sleepHist.data ?? []).slice(0, 7);
    if (recent.length >= 3) {
      const totalDebtHrs = recent.reduce((sum, s) => sum + Math.max(0, sleepGoal - s.hours), 0);
      if (totalDebtHrs > 0) {
        sleepDebt = {
          totalDebtHrs: +totalDebtHrs.toFixed(1),
          nights: recent.length,
          nightsToRecover: Math.ceil(totalDebtHrs / 1),
        };
      }
    }
  }

  // Last workout info
  const lastWorkoutDate  = lastWorkout.data?.[0]?.date ?? null;
  const lastWorkoutNotes = lastWorkout.data?.[0]?.notes ?? null;
  const daysSinceWorkout = lastWorkoutDate
    ? Math.floor((Date.now() - new Date(lastWorkoutDate).getTime()) / 86400000) : null;

  // Days since last weigh-in / sleep log, for the actionable nudge cards
  const daysSinceWeight = latestWeight?.logged_at
    ? Math.floor((Date.now() - new Date(latestWeight.logged_at).getTime()) / 86400000) : null;
  const daysSinceSleep = latestSleep?.logged_at
    ? Math.floor((Date.now() - new Date(latestSleep.logged_at).getTime()) / 86400000) : null;

  // Streak (consecutive days with step logs)
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = localDateStr(new Date(Date.now() - i * 86400000));
    if (stepsHist.data?.some(s => s.logged_at?.startsWith(d))) streak++;
    else if (i > 0) break;
  }

  // Motivational line under name
  let motivText = 'Keep pushing! ⚡';
  if (hasTodayWorkout) motivText = `${todayWorkoutName} — great work! 💪`;
  else if (streak >= 7)  motivText = `${streak}-day streak! 🔥`;
  else if (stepGoalMet)  motivText = 'Step goal crushed! 👟';
  else if (weekWeightDelta !== null && weekWeightDelta < -0.2) motivText = 'Weight dropping! 📉';

  const sessionsLeft = Math.max(0, weeklyGoal - thisWeekSessions);

  // Steps trend: this week vs last week, bucketed Mon..Sun for the chart
  const buildWeekSeries = (weekStartStr, rows) => {
    const series = Array(7).fill(null);
    (rows ?? []).forEach(r => {
      const dayIdx = Math.floor((new Date(r.logged_at) - new Date(`${weekStartStr}T00:00:00`)) / 86400000);
      if (dayIdx >= 0 && dayIdx < 7) series[dayIdx] = r.steps;
    });
    return series;
  };
  const stepsWeekSeries = {
    current:  buildWeekSeries(thisWeekStart, thisWeekStepsArr),
    previous: buildWeekSeries(lastWeekStart, lastWeekStepsArr),
  };

  return {
    profile: profile.data,
    weightArr, stepsArr, sleepArr,
    latestWeight, latestSteps, latestSleep,
    weightDeltaVsYday,
    stepGoal, sleepGoal, weeklyGoal,
    stepGoalMet, sleepGoalMet,
    stepsIsYesterday, sleepIsToday, daysSinceSteps,
    todayKcal, todayProtein,
    hasTodayWorkout, todaySession,
    todayExCount, todaySetCount, todayWorkoutName,
    lastWorkoutDate, lastWorkoutNotes, daysSinceWorkout,
    daysSinceWeight, daysSinceSleep,
    motivText, streak, stepsWeekSeries,
    thisWeek: { sessions: thisWeekSessions, steps: thisWeekStepsAvg, kcal: thisWeekKcal, kcalDays: thisWeekKcalDays, goalDays: thisWeekGoalDays, weightDelta: weekWeightDelta },
    lastWeek: { sessions: lastWeekSessions, steps: lastWeekStepsAvg, kcal: lastWeekKcal, goalDays: lastWeekGoalDays, weightDelta: lastWeekWeightDelta },
    thisMonth: {
      sessions: monthSessions, steps: monthStepsTotal, kcal: monthKcal, goalDays: monthGoalDays, weightDelta: monthWeightDelta,
      gymCount: monthSessions, cardioCount: monthCardioCount, restCount: monthRestCount,
      avgWeight: monthAvgWeight, avgSteps: monthAvgSteps,
    },
    sessionsLeft,
    goalForecast,
    prWatch,
    recoveryScore,
    longestStreak,
    calorieInsight,
    sleepDebt,
  };
}

// ─── quick nav ──────────────────────────────────────────────────────────────
// ─── Day Detail Modal ────────────────────────────────────────────────────────
function DayStat({ icon, value, label, color }) {
  const { colors } = useTheme();
  const ddS = useMemo(() => createDdS(colors), [colors]);
  return (
    <View style={ddS.dayStat}>
      <Text style={ddS.dayStatIcon}>{icon}</Text>
      <Text style={[ddS.dayStatValue, { color }]}>{value}</Text>
      <Text style={ddS.dayStatLabel}>{label}</Text>
    </View>
  );
}

async function fetchDayData(userId, dateStr) {
  const [wt, st, sl, food] = await Promise.all([
    supabase.from('weight_logs').select('weight').eq('user_id', userId)
      .gte('logged_at', `${dateStr}T00:00:00`).lte('logged_at', `${dateStr}T23:59:59`)
      .order('logged_at', { ascending: false }).limit(1),
    supabase.from('step_logs').select('steps').eq('user_id', userId)
      .gte('logged_at', `${dateStr}T00:00:00`).lte('logged_at', `${dateStr}T23:59:59`)
      .order('logged_at', { ascending: false }).limit(1),
    supabase.from('sleep_logs').select('hours').eq('user_id', userId)
      .gte('logged_at', `${dateStr}T00:00:00`).lte('logged_at', `${dateStr}T23:59:59`)
      .order('logged_at', { ascending: false }).limit(1),
    supabase.from('food_logs').select('calories').eq('user_id', userId)
      .gte('logged_at', `${dateStr}T00:00:00`).lte('logged_at', `${dateStr}T23:59:59`),
  ]);
  return {
    weight: wt.data?.[0]?.weight ?? null,
    steps:  st.data?.[0]?.steps  ?? null,
    sleep:  sl.data?.[0]?.hours  ?? null,
    kcal:   (food.data ?? []).reduce((s, f) => s + (f.calories ?? 0), 0) || null,
  };
}

function DayDetailModal({ visible, dateStr, session, userId, onClose }) {
  const { colors } = useTheme();
  const ddS = useMemo(() => createDdS(colors), [colors]);
  const sType = session ? classifySession(session.notes) : null;

  const { data: dd, isLoading } = useQuery({
    queryKey: ['day-detail', userId, dateStr],
    queryFn: () => fetchDayData(userId, dateStr),
    enabled: !!(userId && dateStr && visible),
  });

  const fmtLongDate = (iso) => {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US',
      { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const typeInfo = !session
    ? { icon: '📭', label: 'No Log', color: colors.textMuted, bg: colors.bgCard }
    : sType === 'rest'
    ? { icon: '😴', label: 'Rest Day',        color: '#f59e0b', bg: '#1a0e00' }
    : sType === 'cardio'
    ? { icon: '🏃', label: session.notes ?? 'Cardio',  color: '#60a5fa', bg: '#060d1e' }
    : { icon: '💪', label: session.notes ?? 'Workout', color: C_GREEN,   bg: '#001a0e' };

  const exercises = (session?.workout_exercises ?? [])
    .slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={ddS.overlay}>
        <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={ddS.sheet}>
          {/* Header */}
          <View style={[ddS.header, { backgroundColor: typeInfo.bg }]}>
            <View style={{ flex: 1 }}>
              <Text style={[ddS.typeName, { color: typeInfo.color }]}>
                {typeInfo.icon}  {typeInfo.label}
              </Text>
              <Text style={ddS.dateText}>{fmtLongDate(dateStr)}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={ddS.closeBtn}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Daily stat tiles */}
          <View style={ddS.dayStatsRow}>
            <DayStat icon="⚖️" value={dd?.weight != null ? String(dd.weight) : '—'} label="WEIGHT" color={C_WEIGHT} />
            <DayStat icon="👟" value={dd?.steps  != null ? fmtK(dd.steps)    : '—'} label="STEPS"  color={C_STEPS}  />
            <DayStat icon="🌙" value={dd?.sleep  != null ? `${dd.sleep}h`    : '—'} label="SLEEP"  color={C_SLEEP}  />
            <DayStat icon="🔥" value={dd?.kcal   != null ? String(dd.kcal)   : '—'} label="KCAL"   color={C_KCAL}   />
          </View>

          {/* Workout section */}
          <View style={ddS.sectionLabel}>
            <Text style={ddS.sectionLabelText}>✦ WORKOUT</Text>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ margin: 20 }} />
          ) : (
            <ScrollView style={ddS.exScroll} showsVerticalScrollIndicator={false}>
              {sType === 'rest' ? (
                <View style={ddS.recoveryBox}>
                  <Text style={{ fontSize: 40 }}>😴</Text>
                  <Text style={ddS.recoveryText}>Recovery Day</Text>
                </View>
              ) : exercises.length === 0 ? (
                <View style={ddS.recoveryBox}>
                  <Text style={ddS.noLogText}>No exercises logged</Text>
                </View>
              ) : (
                exercises.map(ex => {
                  const sets = (ex.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number);
                  const isCardioEx = sType === 'cardio';
                  return (
                    <View key={ex.id} style={ddS.exCard}>
                      <Text style={[ddS.exName, isCardioEx && { color: '#60a5fa' }]}>
                        {isCardioEx ? '🏃 ' : ''}{ex.exercise_name}
                      </Text>
                      <View style={ddS.setChips}>
                        {sets.map(s => (
                          <View key={s.id} style={[ddS.setChip, isCardioEx && ddS.setChipCardio]}>
                            <Text style={[ddS.setChipText, isCardioEx && ddS.setChipTextCardio]}>
                              {isCardioEx
                                ? [s.weight_kg != null && `⏱ ${s.weight_kg} km`, s.reps != null && `🔥 ${s.reps} min`].filter(Boolean).join(' · ') || 'logged'
                                : `S${s.set_number}: ${s.weight_kg != null ? `${s.weight_kg}kg` : '?'} × ${s.reps ?? '?'}`
                              }
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Streak Calendar Modal ───────────────────────────────────────────────────
async function fetchMonthSessions(userId, year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const end   = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
  const { data } = await supabase.from('workout_sessions')
    .select('id, date, notes, total_volume, calories_burned, duration_min, workout_exercises(id, exercise_name, order_index, sets(id, set_number, weight_kg, reps))')
    .eq('user_id', userId)
    .gte('date', start).lte('date', end)
    .order('date', { ascending: true });
  return data ?? [];
}

function StreakCalendarModal({ visible, userId, onClose, hasAccess = true, weeklyGoal = 4 }) {
  const { colors } = useTheme();
  const scS = useMemo(() => createScS(colors), [colors]);
  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const cutoffStr = localDateStr(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));

  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const [selDay,   setSelDay]   = useState(null);
  const [showDay,  setShowDay]  = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    if (visible) {
      setCalYear(today.getFullYear());
      setCalMonth(today.getMonth() + 1);
    }
  }, [visible]);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['streak-sessions', userId, calYear, calMonth],
    queryFn: () => fetchMonthSessions(userId, calYear, calMonth),
    enabled: !!(userId && visible),
  });

  const prevMonthDate = new Date(calYear, calMonth - 2, 1);
  const prevYear  = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth() + 1;

  const { data: prevSessions = [] } = useQuery({
    queryKey: ['streak-sessions', userId, prevYear, prevMonth],
    queryFn: () => fetchMonthSessions(userId, prevYear, prevMonth),
    enabled: !!(userId && visible),
  });

  const dayMap = useMemo(() => {
    const m = {};
    sessions.forEach(s => { m[s.date] = { session: s, type: classifySession(s.notes) }; });
    return m;
  }, [sessions]);

  const gymCount    = sessions.filter(s => classifySession(s.notes) === 'gym').length;
  const cardioCount = sessions.filter(s => classifySession(s.notes) === 'cardio').length;
  const restCount   = sessions.filter(s => classifySession(s.notes) === 'rest').length;
  const thisMonth   = gymCount;
  const prevGymCount = prevSessions.filter(s => classifySession(s.notes) === 'gym').length;
  const vsLastMonth  = thisMonth - prevGymCount;
  const vsLastMonthLabel = `${vsLastMonth > 0 ? '↑' : vsLastMonth < 0 ? '↓' : '·'} ${Math.abs(vsLastMonth)} vs ${CAL_MONTHS_SHORT[prevMonth-1]}`;

  const weeklyActive = useMemo(() => {
    const wm = {};
    sessions.filter(s => classifySession(s.notes) === 'gym').forEach(s => {
      const d = new Date(s.date + 'T00:00:00');
      const dow = d.getDay();
      const offset = dow === 0 ? -6 : 1 - dow;
      const mon = new Date(d);
      mon.setDate(d.getDate() + offset);
      const key = localDateStr(mon);
      wm[key] = (wm[key] ?? 0) + 1;
    });
    return Object.values(wm);
  }, [sessions]);

  const bestWk = weeklyActive.length ? Math.max(...weeklyActive) : '—';
  const lowWk  = weeklyActive.length ? Math.min(...weeklyActive) : '—';
  const metGoalWeeks = weeklyActive.filter(c => c >= weeklyGoal).length;
  const consistency  = weeklyActive.length > 0 ? Math.round((metGoalWeeks / weeklyActive.length) * 100) : 0;
  const wkStreak     = metGoalWeeks > 0 ? metGoalWeeks : '—';

  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const untilDay    = calYear === today.getFullYear() && calMonth === today.getMonth() + 1
    ? today.getDate() : daysInMonth;
  let noLog = 0;
  for (let d = 1; d <= untilDay; d++) {
    const iso = `${calYear}-${String(calMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (!dayMap[iso]) noLog++;
  }

  const firstDow     = new Date(calYear, calMonth - 1, 1).getDay();
  const monOffset    = (firstDow + 6) % 7;
  const cells        = [...Array(monOffset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const canGoNext    = calYear < today.getFullYear() || (calYear === today.getFullYear() && calMonth < today.getMonth() + 1);

  const prevCal = () => { if (calMonth === 1) { setCalMonth(12); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); };
  const nextCal = () => { if (!canGoNext) return; if (calMonth === 12) { setCalMonth(1); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); };

  const isoForDay = (day) => `${calYear}-${String(calMonth).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  const TOP_STATS = [
    { val: gymCount,    lbl: 'GYM',    icon: 'barbell',          color: C_GREEN   },
    { val: cardioCount, lbl: 'CARDIO', icon: 'bicycle',          color: '#60a5fa' },
    { val: restCount,   lbl: 'REST',   icon: 'bed',              color: '#f59e0b' },
  ];

  const STATS = [
    { val: bestWk,      lbl: 'BEST WK',      icon: 'trending-up',      color: colors.accent },
    { val: lowWk,       lbl: 'LOW WK',       icon: 'trending-down',    color: C_KCAL    },
    { val: wkStreak,    lbl: 'WK STREAK',    icon: 'flame',            color: colors.textMuted },
    { val: thisMonth,   lbl: 'THIS MONTH',   icon: 'calendar',         color: colors.text, sub: vsLastMonthLabel },
    { val: `${consistency}%`, lbl: 'CONSISTENCY', icon: 'checkmark-circle', color: consistency >= 50 ? C_GREEN : C_KCAL, sub: `${metGoalWeeks}/${weeklyActive.length} wks · ${weeklyGoal}/wk` },
    { val: noLog,       lbl: 'NO LOG',       icon: 'close-circle',     color: colors.textDim },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={scS.overlay}>
        <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={scS.popup}>
        {/* Header */}
        <View style={scS.header}>
          <View style={{ flex: 1 }}>
            <Text style={scS.title}>🔥 Streak Calendar</Text>
            <Text style={scS.subtitle}>{gymCount} gym · {cardioCount} cardio · {restCount} rest this month</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={scS.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Gym/Cardio/Rest — single card, line-separated */}
          <View style={[scS.statCard, { marginTop: 14 }]}>
            {TOP_STATS.map((item, idx) => (
              <React.Fragment key={idx}>
                <View style={scS.statCell}>
                  <Ionicons name={item.icon} size={14} color={item.color} style={{ marginBottom: 3 }} />
                  <Text style={[scS.statCellVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={scS.statCellLbl}>{item.lbl}</Text>
                </View>
                {idx < TOP_STATS.length - 1 && <View style={scS.statDivider} />}
              </React.Fragment>
            ))}
          </View>

          {/* Secondary stats — single card per row, line-separated */}
          <View style={scS.statCard}>
            {STATS.slice(0, 3).map((item, idx) => (
              <React.Fragment key={idx}>
                <View style={scS.statCell}>
                  <Text style={[scS.statCellVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={scS.statCellLbl}>{item.lbl}</Text>
                </View>
                {idx < 2 && <View style={scS.statDivider} />}
              </React.Fragment>
            ))}
          </View>
          <View style={scS.statCard}>
            {STATS.slice(3, 6).map((item, idx) => (
              <React.Fragment key={idx}>
                <View style={scS.statCell}>
                  <Text style={[scS.statCellVal, { color: item.color }]}>{item.val}</Text>
                  <Text style={scS.statCellLbl}>{item.lbl}</Text>
                  {item.sub ? <Text style={scS.statCellSub}>{item.sub}</Text> : null}
                </View>
                {idx < 2 && <View style={scS.statDivider} />}
              </React.Fragment>
            ))}
          </View>

          {/* Calendar section */}
          <View style={scS.calSection}>
            <View style={scS.calNav}>
              <Text style={scS.calMonthTitle}>{CAL_MONTHS_SHORT[calMonth-1]} {calYear}</Text>
              <View style={scS.calNavBtns}>
                <TouchableOpacity onPress={prevCal} style={scS.calNavBtn}>
                  <Text style={scS.calNavText}>‹</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={nextCal} style={scS.calNavBtn} disabled={!canGoNext}>
                  <Text style={[scS.calNavText, !canGoNext && { color: colors.textDim }]}>›</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Day name headers — Monday first */}
            <View style={scS.dayNamesRow}>
              {CAL_DAY_MON.map(n => (
                <View key={n} style={scS.dayNameCell}>
                  <Text style={scS.dayNameText}>{n}</Text>
                </View>
              ))}
            </View>

            {/* Calendar grid */}
            {isLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 30 }} />
            ) : (
              <View style={scS.grid}>
                {cells.map((day, idx) => {
                  if (!day) return <View key={`e${idx}`} style={{ width: CAL_CELL, height: CAL_CELL }} />;
                  const iso     = isoForDay(day);
                  const entry   = dayMap[iso];
                  const isToday = iso === todayStr;
                  const isFuture = iso > todayStr;
                  const isLocked = !hasAccess && !isFuture && iso < cutoffStr;

                  if (isLocked) {
                    return (
                      <TouchableOpacity
                        key={day}
                        style={[scS.dayCell, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}
                        onPress={() => setShowPaywall(true)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="lock-closed" size={10} color={colors.textDim} />
                        <Text style={[scS.dayNum, { color: colors.textDim, marginTop: 2 }]}>{day}</Text>
                      </TouchableOpacity>
                    );
                  }

                  const typeColor = entry?.type === 'gym'    ? '#34d399'
                    : entry?.type === 'cardio' ? '#3b82f6'
                    : entry?.type === 'rest'   ? '#f59e0b'
                    : null;

                  const fillColor = entry?.type === 'gym'    ? 'rgba(52,211,153,0.2)'
                    : entry?.type === 'cardio' ? 'rgba(59,130,246,0.2)'
                    : entry?.type === 'rest'   ? 'rgba(245,158,11,0.2)'
                    : colors.bgElevated;

                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        scS.dayCell,
                        { backgroundColor: fillColor, borderColor: typeColor || colors.border },
                        isToday && scS.dayCellToday,
                        isFuture && { opacity: 0.25 },
                      ]}
                      onPress={() => {
                        if (isFuture) return;
                        setSelDay({ dateStr: iso, session: entry?.session ?? null });
                        setShowDay(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[scS.dayNum, isToday && scS.dayNumToday]}>{day}</Text>
                      {typeColor && <View style={[scS.dayDot, { backgroundColor: typeColor }]} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>

        {selDay && (
          <DayDetailModal
            visible={showDay}
            dateStr={selDay.dateStr}
            session={selDay.session}
            userId={userId}
            onClose={() => setShowDay(false)}
          />
        )}
        </View>
      </View>
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </Modal>
  );
}

const WEEK_TABS = ['THIS WEEK', 'LAST WEEK', 'THIS MONTH', 'CUT SCORE'];

// ─── Steps trend chart (this week vs last week, with goal line) ────────────
function StepsTrendChart({ current, previous, goal, colors, width }) {
  const H = 90;
  const P = { t: 10, r: 6, b: 6, l: 6 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  const allVals = [...current, ...previous, goal].filter(v => v != null);
  const maxV = Math.max(...allVals, 1) * 1.15;
  const n = 7;
  const xs = pw / (n - 1);
  const toX = i => P.l + i * xs;
  const toY = v => P.t + ph - (v / maxV) * ph;
  const toLine = arr => arr.map((v, i) => (v == null ? null : `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const curLine  = toLine(current);
  const prevLine = toLine(previous);
  const goalY = goal != null ? toY(goal) : null;

  return (
    <Svg width={width} height={H}>
      {goalY != null && (
        <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke={colors.accent} strokeOpacity={0.5} strokeWidth={1.5} strokeDasharray="4,4" />
      )}
      {prevLine ? (
        <Polyline points={prevLine} fill="none" stroke={colors.textDim} strokeWidth={2} strokeDasharray="4,3" strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
      {curLine ? (
        <Polyline points={curLine} fill="none" stroke={colors.text} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      ) : null}
    </Svg>
  );
}

// ─── Actionable nudge card (e.g. "No weigh-in for 4 days" + Log) ───────────
function NudgeCard({ icon, color, title, sub, styles, onPress, logLabel, logBadge }) {
  return (
    <TouchableOpacity style={styles.nudgeCard} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.nudgeIconWrap, { backgroundColor: color + '1f' }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View style={styles.nudgeBody}>
        <Text style={styles.nudgeTitle}>{title}</Text>
        <Text style={styles.nudgeSub}>{sub}</Text>
      </View>
      {logBadge != null ? (
        <View style={styles.nudgeBadgeWrap}>
          <Text style={[styles.nudgeBadgeNum, { color }]}>{logBadge}</Text>
          {logLabel && <Text style={styles.nudgeBadgeLabel}>{logLabel}</Text>}
        </View>
      ) : (
        <View style={styles.nudgeLogBtn}>
          <Ionicons name="add" size={13} color="#0c0c0f" />
          <Text style={styles.nudgeLogBtnText}>Log</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── component ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const { open: openMore } = useMoreMenu();
  const [activeTab,   setActiveTab]   = useState(0);
  const [showStreak,  setShowStreak]  = useState(false);
  const [showForecastPaywall, setShowForecastPaywall] = useState(false);
  const [showProTeaserPaywall, setShowProTeaserPaywall] = useState(false);
  const consistencyExport = useGatedExport();
  const { hasAccess, isPro, isInTrial, trialDaysLeft, ready: subReady } = useSubscription();
  const qc = useQueryClient();

  const [showWeightLog, setShowWeightLog] = useState(false);
  const [weightQuickInput, setWeightQuickInput] = useState('');
  const [showSleepLog, setShowSleepLog] = useState(false);
  const [sleepQuickInput, setSleepQuickInput] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['home', user?.id],
    queryFn: () => fetchHome(user.id),
    enabled: !!user?.id,
  });

  const weightQuickMut = useMutation({
    mutationFn: (kg) => quickLogWeight(user.id, kg),
    onSuccess: () => {
      qc.invalidateQueries(['home', user.id]);
      qc.invalidateQueries(['weight', user.id]);
      setShowWeightLog(false); setWeightQuickInput('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const sleepQuickMut = useMutation({
    mutationFn: (hours) => quickLogSleep(user.id, hours),
    onSuccess: () => {
      qc.invalidateQueries(['home', user.id]);
      qc.invalidateQueries(['sleep', user.id]);
      setShowSleepLog(false); setSleepQuickInput('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  const displayName = (data?.profile?.full_name ?? user?.user_metadata?.full_name ?? 'User').toUpperCase();
  const initial     = displayName[0] ?? 'F';
  function nav(target) {
    const tabs = ['Home', 'Workout', 'Log', 'Steps', 'Weight', 'Sleep'];
    if (tabs.includes(target)) navigation.navigate(target);
    else openMore();
  }

  const weeklyGoal       = data?.weeklyGoal ?? 4;
  const thisWeekSessions = data?.thisWeek?.sessions ?? 0;
  const sessionsLeft     = data?.sessionsLeft ?? weeklyGoal;

  const tabStats = [data?.thisWeek, data?.lastWeek, data?.thisMonth];
  const todayIsoDow = (() => { const d = new Date().getDay(); return d === 0 ? 7 : d; })();
  const periodDays = [todayIsoDow, 7, new Date().getDate()];

  const stepGoalForWeek = data?.stepGoal ?? 10000;
  const stepsPct    = Math.min(100, Math.round(((data?.thisWeek?.steps ?? 0) / (stepGoalForWeek * periodDays[0])) * 100));
  const caloriesPct = Math.min(100, Math.round(((data?.thisWeek?.kcalDays ?? 0) / periodDays[0]) * 100));
  const sessionsPct = Math.min(100, Math.round((thisWeekSessions / weeklyGoal) * 100));
  const weightDelta = data?.thisWeek?.weightDelta;
  const wtTrendPct  = weightDelta == null ? 0 : Math.max(0, Math.min(100, Math.round(50 - weightDelta * 50)));

  const cutScore = Math.round(stepsPct * 0.3 + caloriesPct * 0.2 + sessionsPct * 0.35 + wtTrendPct * 0.15);
  const cutStatus = cutScore >= 80 ? 'Crushing it!' : cutScore >= 50 ? 'On track' : 'Needs attention';
  const cutSubtitle = (stepsPct < 50 || caloriesPct < 50)
    ? 'Steps or calories off target this week.'
    : 'Based on this week\'s consistency.';

  // ── Insight cards (auto-rotating carousel) ───────────────────────────────
  const stepsTrendPct = (data?.lastWeek?.steps ?? 0) > 0
    ? Math.round(((data.thisWeek.steps - data.lastWeek.steps) / data.lastWeek.steps) * 100)
    : null;
  const insights = [];
  if (stepsTrendPct !== null) {
    insights.push({
      icon: 'footsteps-outline', color: C_STEPS,
      text: stepsTrendPct >= 0
        ? `Steps up ${stepsTrendPct}% vs last week — nice momentum.`
        : `Steps down ${Math.abs(stepsTrendPct)}% vs last week — a short walk would close the gap.`,
    });
  }
  if (weightDelta != null) {
    insights.push({
      icon: 'scale-outline', color: C_WEIGHT,
      text: weightDelta <= 0
        ? `Weight trending down ${Math.abs(weightDelta)}kg this week — on pace.`
        : `Weight up ${weightDelta}kg this week — keep an eye on it.`,
    });
  }
  if (data?.streak >= 2) {
    insights.push({
      icon: 'flame-outline', color: C_GREEN,
      text: `${data.streak}-day logging streak — keep it going!`,
    });
  }
  if (sessionsLeft > 0) {
    insights.push({
      icon: 'barbell-outline', color: colors.accent,
      text: `${sessionsLeft} more session${sessionsLeft !== 1 ? 's' : ''} to hit your weekly goal of ${weeklyGoal}.`,
    });
  }
  if (insights.length === 0) {
    insights.push({ icon: 'sparkles-outline', color: colors.accent, text: 'Log today\'s stats to see personalized insights here.' });
  }

  const insightScrollRef = useRef(null);
  const [insightIdx, setInsightIdx] = useState(0);
  const insightCardW = SCREEN_W - 32; // full-width card (matches 16px screen padding on each side)
  useEffect(() => {
    if (insights.length <= 1) return;
    const id = setInterval(() => {
      setInsightIdx(prev => {
        const next = (prev + 1) % insights.length;
        insightScrollRef.current?.scrollTo({ x: next * insightCardW, animated: true });
        return next;
      });
    }, 6000);
    return () => clearInterval(id);
  }, [insights.length, insightCardW]);

  // One-time "Go Pro" onboarding screen, shown the first time a free/trial
  // user lands on Home after signing up — mirrors the post-onboarding
  // paywall pattern used by Calm/Duolingo.
  useEffect(() => {
    if (!subReady || !user?.id || isPro) return;
    const key = `fitzo:seenOnboardingPaywall:${user.id}`;
    AsyncStorage.getItem(key).then(seen => {
      if (seen) return;
      try {
        navigation.navigate('Subscription');
        AsyncStorage.setItem(key, 'true');
      } catch (e) {
        // Navigator not ready yet — leave the flag unset so we retry next mount.
      }
    });
  }, [subReady, user?.id, isPro, navigation]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── App Header ─────────────────────────────────────────── */}
      <ScreenHeader title="HOME" colors={colors} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} size="large" />
        ) : (
          <>
            {/* ── Profile ────────────────────────────────────────── */}
            <View style={styles.profileRow}>
              <View style={styles.avatarRing}>
                <View style={styles.avatarInner}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
              </View>

              <View style={styles.profileInfo}>
                <Text style={styles.greeting}>{getGreeting()} ⚡</Text>
                <Text style={styles.profileName}>{displayName}</Text>
                <TouchableOpacity style={styles.motivRow} onPress={() => setShowStreak(true)} activeOpacity={0.7}>
                  <Ionicons name="walk" size={12} color={colors.accent} />
                  <Text style={styles.motivText}>{data?.motivText}</Text>
                </TouchableOpacity>
                <View style={styles.goalProgressRow}>
                  <Text style={styles.goalProgressLabel} numberOfLines={1}>This week</Text>
                  <View style={styles.goalProgressTrack}>
                    <View style={[styles.goalProgressFill, { width: `${cutScore}%` }]} />
                  </View>
                  <Text style={styles.goalProgressPct}>{cutScore}%</Text>
                </View>
              </View>
            </View>

            {/* ── Go Pro banner ─────────────────────────────────── */}
            {!isPro && (
              <TouchableOpacity
                style={styles.proBanner}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Subscription')}
              >
                <Ionicons name="rocket" size={18} color={colors.accentText} />
                <Text style={styles.proBannerText}>
                  {isInTrial
                    ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in trial — see Pro plans`
                    : 'Unlock long-range trends, insights & more with Pro'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accentText} />
              </TouchableOpacity>
            )}

            {/* ── Insight Cards (auto-rotating) ──────────────────── */}
            <ScrollView
              ref={insightScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              style={styles.insightScroll}
              snapToInterval={insightCardW}
              decelerationRate="fast"
              onMomentumScrollEnd={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / insightCardW);
                setInsightIdx(idx);
              }}
            >
              {insights.map((ins, i) => (
                <View key={i} style={[styles.insightCard, { width: insightCardW }]}>
                  <Ionicons name={ins.icon} size={14} color={ins.color} />
                  <Text style={styles.insightText}>{ins.text}</Text>
                </View>
              ))}
            </ScrollView>

            {insights.length > 1 && (
              <View style={styles.insightDotsRow}>
                {insights.map((_, i) => (
                  <View
                    key={i}
                    style={[styles.insightDot, i === insightIdx && { backgroundColor: colors.accent, width: 16 }]}
                  />
                ))}
              </View>
            )}

            {/* ── Stat Overview (merged, line-separated) ─────────── */}
            <View style={styles.overviewCard}>
              <TouchableOpacity style={styles.overviewRow} onPress={() => nav('Weight')} activeOpacity={0.7}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="scale-outline" size={15} color={C_WEIGHT} />
                </View>
                <View style={styles.overviewBody}>
                  <Text style={[styles.overviewLabel, { color: C_WEIGHT }]}>WEIGHT</Text>
                  <Text style={styles.overviewSub}>kg · body weight</Text>
                </View>
                <View style={styles.overviewRight}>
                  <Text style={styles.overviewVal}>{data?.latestWeight?.weight ?? '—'}</Text>
                  {data?.weightDeltaVsYday !== null && data?.weightDeltaVsYday !== undefined && (
                    <Text style={[styles.overviewDelta, { color: data.weightDeltaVsYday <= 0 ? C_GREEN : '#f87171' }]}>
                      {data.weightDeltaVsYday > 0 ? '+' : ''}{data.weightDeltaVsYday}kg vs yday
                    </Text>
                  )}
                </View>
                {(data?.weightArr?.length ?? 0) >= 2 && (
                  <Sparkline data={data.weightArr} color={C_WEIGHT} width={48} height={26} />
                )}
              </TouchableOpacity>

              <View style={styles.overviewDivider} />

              <TouchableOpacity style={styles.overviewRow} onPress={() => nav('Steps')} activeOpacity={0.7}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="footsteps-outline" size={15} color={C_STEPS} />
                </View>
                <View style={styles.overviewBody}>
                  <Text style={[styles.overviewLabel, { color: C_STEPS }]}>STEPS</Text>
                  <Text style={styles.overviewSub}>
                    {data?.stepsIsYesterday ? 'steps yesterday' : 'data not added yet'}
                  </Text>
                </View>
                <View style={styles.overviewRight}>
                  <Text style={styles.overviewVal}>{data?.stepsIsYesterday ? data.latestSteps.steps.toLocaleString() : '—'}</Text>
                  {data?.stepsIsYesterday && data?.stepGoalMet && <Text style={[styles.overviewDelta, { color: C_GREEN }]}>✓ Goal met!</Text>}
                </View>
                {data?.stepsIsYesterday && (data?.stepsArr?.length ?? 0) >= 2 && (
                  <Sparkline data={data.stepsArr} color={C_STEPS} width={48} height={26} />
                )}
              </TouchableOpacity>

              <View style={styles.overviewDivider} />

              <TouchableOpacity style={styles.overviewRow} onPress={() => nav('Log')} activeOpacity={0.7}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="flame-outline" size={15} color={C_KCAL} />
                </View>
                <View style={styles.overviewBody}>
                  <Text style={[styles.overviewLabel, { color: C_KCAL }]}>TODAY KCAL</Text>
                  <Text style={styles.overviewSub}>
                    {(data?.todayKcal ?? 0) === 0 ? 'not logged · tap to log food' : 'kcal today'}
                  </Text>
                </View>
                <View style={styles.overviewRight}>
                  <Text style={styles.overviewVal}>{(data?.todayKcal ?? 0) === 0 ? '—' : data.todayKcal}</Text>
                  {(data?.todayProtein ?? 0) > 0 && (
                    <Text style={[styles.overviewDelta, { color: colors.success }]}>{Math.round(data.todayProtein)}g protein</Text>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.overviewDivider} />

              <TouchableOpacity style={styles.overviewRow} onPress={() => nav('Sleep')} activeOpacity={0.7}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="moon-outline" size={15} color={C_SLEEP} />
                </View>
                <View style={styles.overviewBody}>
                  <Text style={[styles.overviewLabel, { color: C_SLEEP }]}>SLEEP</Text>
                  <Text style={styles.overviewSub}>{data?.sleepIsToday ? 'logged today' : 'data not added yet'}</Text>
                </View>
                <View style={styles.overviewRight}>
                  <Text style={styles.overviewVal}>{data?.sleepIsToday ? `${data.latestSleep.hours}h` : '—'}</Text>
                  {data?.sleepIsToday && data?.sleepGoalMet && <Text style={[styles.overviewDelta, { color: C_GREEN }]}>✓ Goal met</Text>}
                </View>
                {data?.sleepIsToday && (data?.sleepArr?.length ?? 0) >= 2 && (
                  <Sparkline data={data.sleepArr} color={C_SLEEP} width={48} height={26} />
                )}
              </TouchableOpacity>
            </View>

            {/* ── Pro Insights Hub (consolidated) ─────────────────── */}
            <View style={styles.insightsHubCard}>
              <LinearGradient
                colors={[colors.accent, C_GREEN]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.insightsHubHeader}
              >
                <Ionicons name="sparkles" size={14} color="#0a0a0a" />
                <Text style={styles.insightsHubHeaderText}>PRO INSIGHTS</Text>
                {!hasAccess && (
                  <View style={styles.insightsHubUnlockPill}>
                    <Text style={styles.insightsHubUnlockText}>Unlock all 6 🔒</Text>
                  </View>
                )}
              </LinearGradient>

              {/* Goal Forecast */}
              {(hasAccess ? !!data?.goalForecast : true) && (
                <>
                  <TouchableOpacity
                    style={styles.insightsHubRow}
                    activeOpacity={0.7}
                    disabled={hasAccess}
                    onPress={() => setShowForecastPaywall(true)}
                  >
                    <Ionicons name="rocket-outline" size={16} color={colors.accent} />
                    <View style={styles.insightsHubBody}>
                      <View style={styles.insightsHubTitleRow}>
                        <Text style={[styles.insightsHubTitle, { color: colors.accent }]}>Goal forecast</Text>
                        {!hasAccess && (
                          <View style={styles.miniProBadge}>
                            <Text style={styles.miniProBadgeText}>PRO</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.insightsHubSub} numberOfLines={2}>
                        {hasAccess && data?.goalForecast
                          ? `Projected ${data.goalForecast.forecastDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${Math.abs(data.goalForecast.weeklyPaceKg)}kg/wk pace`
                          : 'Unlock your personalized projection 🔒'}
                      </Text>
                    </View>
                    {hasAccess && data?.goalForecast && (
                      <Text style={styles.insightsHubVal}>~{data.goalForecast.daysToGoal}d to goal</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.overviewDivider} />
                </>
              )}

              {/* PR Watch */}
              {(hasAccess ? !!data?.prWatch : true) && (
                <>
                  <TouchableOpacity
                    style={styles.insightsHubRow}
                    activeOpacity={0.7}
                    disabled={hasAccess}
                    onPress={() => setShowProTeaserPaywall(true)}
                  >
                    <Ionicons name="barbell-outline" size={16} color={C_GREEN} />
                    <View style={styles.insightsHubBody}>
                      <View style={styles.insightsHubTitleRow}>
                        <Text style={[styles.insightsHubTitle, { color: C_GREEN }]}>PR watch</Text>
                        {!hasAccess && (
                          <View style={[styles.miniProBadge, { backgroundColor: C_GREEN }]}>
                            <Text style={styles.miniProBadgeText}>PRO</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.insightsHubSub} numberOfLines={2}>
                        {hasAccess && data?.prWatch
                          ? `${data.prWatch.exercise} · best ${data.prWatch.prKg}kg`
                          : "See which lift you're closest to beating 🔒"}
                      </Text>
                    </View>
                    {hasAccess && data?.prWatch && (
                      <Text style={styles.insightsHubVal}>{data.prWatch.gapKg}kg from PR</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.overviewDivider} />
                </>
              )}

              {/* Recovery Score */}
              {(hasAccess ? data?.recoveryScore != null : true) && (
                <>
                  <TouchableOpacity
                    style={styles.insightsHubRow}
                    activeOpacity={0.7}
                    disabled={hasAccess}
                    onPress={() => setShowProTeaserPaywall(true)}
                  >
                    <Ionicons name="pulse-outline" size={16} color={C_SLEEP} />
                    <View style={styles.insightsHubBody}>
                      <View style={styles.insightsHubTitleRow}>
                        <Text style={[styles.insightsHubTitle, { color: C_SLEEP }]}>Recovery score</Text>
                        {!hasAccess && (
                          <View style={[styles.miniProBadge, { backgroundColor: C_SLEEP }]}>
                            <Text style={styles.miniProBadgeText}>PRO</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.insightsHubSub} numberOfLines={2}>
                        {hasAccess && data?.recoveryScore != null
                          ? (data.recoveryScore >= 80 ? 'Primed to push hard today 🚀'
                            : data.recoveryScore >= 50 ? 'Moderate load — train smart'
                            : 'Low recovery — consider an easier day')
                          : 'Daily readiness from your sleep 🔒'}
                      </Text>
                    </View>
                    {hasAccess && data?.recoveryScore != null && (
                      <Text style={styles.insightsHubVal}>{data.recoveryScore}% recovered</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.overviewDivider} />
                </>
              )}

              {/* Streak Record */}
              {(hasAccess ? data?.longestStreak > 0 : true) && (
                <>
                  <TouchableOpacity
                    style={styles.insightsHubRow}
                    activeOpacity={0.7}
                    disabled={hasAccess}
                    onPress={() => setShowProTeaserPaywall(true)}
                  >
                    <Ionicons name="flame-outline" size={16} color={C_STEPS} />
                    <View style={styles.insightsHubBody}>
                      <View style={styles.insightsHubTitleRow}>
                        <Text style={[styles.insightsHubTitle, { color: C_STEPS }]}>Streak record</Text>
                        {!hasAccess && (
                          <View style={[styles.miniProBadge, { backgroundColor: C_STEPS }]}>
                            <Text style={styles.miniProBadgeText}>PRO</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.insightsHubSub} numberOfLines={2}>
                        {hasAccess && data?.longestStreak > 0
                          ? (data.streak >= data.longestStreak
                            ? "Personal best — keep it alive! 🔥"
                            : `${data.longestStreak - data.streak} more day${data.longestStreak - data.streak === 1 ? '' : 's'} to tie record`)
                          : 'Track your best-ever streak 🔒'}
                      </Text>
                    </View>
                    {hasAccess && data?.longestStreak > 0 && (
                      <Text style={styles.insightsHubVal}>{data.streak} / {data.longestStreak}d</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.overviewDivider} />
                </>
              )}

              {/* True Maintenance */}
              {(hasAccess ? !!data?.calorieInsight : true) && (
                <>
                  <TouchableOpacity
                    style={styles.insightsHubRow}
                    activeOpacity={0.7}
                    disabled={hasAccess}
                    onPress={() => setShowProTeaserPaywall(true)}
                  >
                    <Ionicons name="flask-outline" size={16} color={C_KCAL} />
                    <View style={styles.insightsHubBody}>
                      <View style={styles.insightsHubTitleRow}>
                        <Text style={[styles.insightsHubTitle, { color: C_KCAL }]}>True maintenance</Text>
                        {!hasAccess && (
                          <View style={[styles.miniProBadge, { backgroundColor: C_KCAL }]}>
                            <Text style={styles.miniProBadgeText}>PRO</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.insightsHubSub} numberOfLines={2}>
                        {hasAccess && data?.calorieInsight
                          ? `Based on actual intake + weight trend${data.calorieInsight.diffVsTarget != null
                              ? ` — ${Math.abs(data.calorieInsight.diffVsTarget)} kcal ${data.calorieInsight.diffVsTarget > 0 ? 'higher' : 'lower'} than target`
                              : ''}`
                          : 'Your real maintenance calories 🔒'}
                      </Text>
                    </View>
                    {hasAccess && data?.calorieInsight && (
                      <Text style={styles.insightsHubVal}>~{data.calorieInsight.trueMaintenance} kcal</Text>
                    )}
                  </TouchableOpacity>
                  <View style={styles.overviewDivider} />
                </>
              )}

              {/* Sleep Debt */}
              {(hasAccess ? !!data?.sleepDebt : true) && (
                <TouchableOpacity
                  style={styles.insightsHubRow}
                  activeOpacity={0.7}
                  disabled={hasAccess}
                  onPress={() => setShowProTeaserPaywall(true)}
                >
                  <Ionicons name="moon-outline" size={16} color={C_SLEEP} />
                  <View style={styles.insightsHubBody}>
                    <View style={styles.insightsHubTitleRow}>
                      <Text style={[styles.insightsHubTitle, { color: C_SLEEP }]}>Sleep debt</Text>
                      {!hasAccess && (
                        <View style={[styles.miniProBadge, { backgroundColor: C_SLEEP }]}>
                          <Text style={styles.miniProBadgeText}>PRO</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.insightsHubSub} numberOfLines={2}>
                      {hasAccess && data?.sleepDebt
                        ? `Over last ${data.sleepDebt.nights} nights · ~${data.sleepDebt.nightsToRecover} night${data.sleepDebt.nightsToRecover === 1 ? '' : 's'} to recover`
                        : 'Your cumulative sleep debt 🔒'}
                    </Text>
                  </View>
                  {hasAccess && data?.sleepDebt && (
                    <Text style={styles.insightsHubVal}>{data.sleepDebt.totalDebtHrs}h owed</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* ── Actionable nudge cards ────────────────────────── */}
            {(!data?.latestWeight || data.daysSinceWeight >= 2) && (
              <NudgeCard
                icon="scale-outline"
                color={C_WEIGHT}
                title={data?.latestWeight ? `No weigh-in for ${data.daysSinceWeight} days` : 'No weigh-ins yet'}
                sub={data?.latestWeight
                  ? `Last: ${data.latestWeight.weight}KG · ${data.daysSinceWeight} days ago`
                  : 'Tap to log your first weight'}
                styles={styles}
                onPress={() => setShowWeightLog(true)}
              />
            )}
            {!data?.hasTodayWorkout && (
              <NudgeCard
                icon="trophy-outline"
                color={colors.warning}
                title={data?.lastWorkoutDate ? 'Rest day — no session today' : 'No session today'}
                sub={data?.lastWorkoutDate
                  ? `Last: ${classifySession(data.lastWorkoutNotes) === 'rest' ? 'Rest Day' : 'Session'} on ${new Date(data.lastWorkoutDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`
                  : 'Tap to start your first session'}
                styles={styles}
                onPress={() => navigation.navigate('Workout')}
              />
            )}
            {(!data?.latestSteps || data.daysSinceSteps >= 1) && (
              <NudgeCard
                icon="footsteps-outline"
                color={C_STEPS}
                title={data?.latestSteps ? `No steps logged for ${data.daysSinceSteps} day${data.daysSinceSteps === 1 ? '' : 's'}` : 'No steps logged yet'}
                sub={data?.latestSteps
                  ? `Last: ${data.latestSteps.steps.toLocaleString()} · ${data.daysSinceSteps} day${data.daysSinceSteps === 1 ? '' : 's'} ago`
                  : 'Tap to log your first steps'}
                styles={styles}
                onPress={() => navigation.navigate('Steps')}
              />
            )}
            {(!data?.latestSleep || data.daysSinceSleep >= 1) && (
              <NudgeCard
                icon="moon-outline"
                color={C_SLEEP}
                title={data?.latestSleep ? `No sleep logged for ${data.daysSinceSleep} day${data.daysSinceSleep === 1 ? '' : 's'}` : 'No sleep logged yet'}
                sub={data?.latestSleep
                  ? `Last: ${data.latestSleep.hours}h · ${data.daysSinceSleep} day${data.daysSinceSleep === 1 ? '' : 's'} ago`
                  : 'Tap to log your first sleep'}
                styles={styles}
                onPress={() => setShowSleepLog(true)}
              />
            )}
            {sessionsLeft > 0 && thisWeekSessions > 0 && (
              <NudgeCard
                icon="trophy"
                color={C_GREEN}
                title={`Almost there! — ${sessionsLeft} more gym session${sessionsLeft === 1 ? '' : 's'} this week`}
                sub={`${thisWeekSessions}/${weeklyGoal} gym sessions · this week`}
                styles={styles}
                onPress={() => navigation.navigate('Workout')}
                logLabel="THIS WEEK"
                logBadge={String(thisWeekSessions)}
              />
            )}

            {/* ── 7-Day Steps Trend (vs last week, with goal line) ─ */}
            <Text style={styles.sectionLabel}>7-DAY TREND</Text>
            <View style={styles.chartCard}>
              <View style={styles.chartHdr}>
                <Text style={styles.chartTitle}>Steps vs last week</Text>
                <View style={styles.chartLegend}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.text }]} />
                    <Text style={styles.legendText}>This wk</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: colors.textDim }]} />
                    <Text style={styles.legendText}>Last wk</Text>
                  </View>
                </View>
              </View>
              {data?.stepsWeekSeries && (
                <StepsTrendChart
                  current={data.stepsWeekSeries.current}
                  previous={data.stepsWeekSeries.previous}
                  goal={data.stepGoal}
                  colors={colors}
                  width={SCREEN_W - 32 - 28}
                />
              )}
              {data?.stepsWeekSeries && (() => {
                const curVals = data.stepsWeekSeries.current.filter(v => v != null);
                const prevVals = data.stepsWeekSeries.previous.filter(v => v != null);
                const curTotal = curVals.reduce((a, b) => a + b, 0);
                const prevTotal = prevVals.reduce((a, b) => a + b, 0);
                const avg = curVals.length ? Math.round(curTotal / curVals.length) : 0;
                const pctDelta = prevTotal > 0 ? Math.round(((curTotal - prevTotal) / prevTotal) * 100) : null;
                const bestDay = curVals.length ? Math.max(...curVals) : 0;
                return (
                  <View style={styles.chartStatsRow}>
                    <View style={styles.chartStatTile}>
                      <Text style={styles.chartStatVal}>{curTotal.toLocaleString()}</Text>
                      <Text style={styles.chartStatLabel}>TOTAL THIS WK</Text>
                    </View>
                    <View style={styles.chartStatDivider} />
                    <View style={styles.chartStatTile}>
                      <Text style={styles.chartStatVal}>{avg.toLocaleString()}</Text>
                      <Text style={styles.chartStatLabel}>DAILY AVG</Text>
                    </View>
                    <View style={styles.chartStatDivider} />
                    <View style={styles.chartStatTile}>
                      <Text style={styles.chartStatVal}>{bestDay.toLocaleString()}</Text>
                      <Text style={styles.chartStatLabel}>BEST DAY</Text>
                    </View>
                    <View style={styles.chartStatDivider} />
                    <View style={styles.chartStatTile}>
                      <Text style={[styles.chartStatVal, { color: pctDelta == null ? colors.text : pctDelta >= 0 ? C_GREEN : '#f87171' }]}>
                        {pctDelta == null ? '—' : `${pctDelta > 0 ? '+' : ''}${pctDelta}%`}
                      </Text>
                      <Text style={styles.chartStatLabel}>VS LAST WK</Text>
                    </View>
                  </View>
                );
              })()}
            </View>

            {/* ── Consistency (replaces old goal-progress banner) ── */}
            <View style={{ position: 'relative' }}>
              <View style={styles.consistencyCard}>
                <View style={styles.consistencyTile}>
                  <Text style={[styles.consistencyNum, { color: colors.accent }]}>{data?.streak ?? 0}</Text>
                  <Text style={styles.consistencyLabel}>DAY{'\n'}STREAK</Text>
                </View>
                <View style={styles.consistencyDivider} />
                <View style={styles.consistencyTile}>
                  <Text style={[styles.consistencyNum, { color: C_STEPS }]}>{data?.thisWeek?.goalDays ?? 0}/7</Text>
                  <Text style={styles.consistencyLabel}>STEP GOAL{'\n'}DAYS</Text>
                </View>
                <View style={styles.consistencyDivider} />
                <View style={styles.consistencyTile}>
                  <Text style={[styles.consistencyNum, { color: C_GREEN }]}>{thisWeekSessions}/{weeklyGoal}</Text>
                  <Text style={styles.consistencyLabel}>WORKOUT{'\n'}SESSIONS</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={consistencyExport.onExportPress}
                disabled={consistencyExport.exporting}
                style={styles.cardExportBtn}
              >
                {consistencyExport.exporting ? (
                  <ActivityIndicator size="small" color={colors.textMuted ?? colors.textDim} />
                ) : (
                  <Ionicons name="share-outline" size={13} color={colors.textMuted ?? colors.textDim} />
                )}
              </TouchableOpacity>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={consistencyExport.ref} title="Consistency" colors={colors} width={340}>
                <View style={[styles.consistencyCard, { marginHorizontal: 0, marginBottom: 0 }]}>
                  <View style={styles.consistencyTile}>
                    <Text style={[styles.consistencyNum, { color: colors.accent }]}>{data?.streak ?? 0}</Text>
                    <Text style={styles.consistencyLabel}>DAY{'\n'}STREAK</Text>
                  </View>
                  <View style={styles.consistencyDivider} />
                  <View style={styles.consistencyTile}>
                    <Text style={[styles.consistencyNum, { color: C_STEPS }]}>{data?.thisWeek?.goalDays ?? 0}/7</Text>
                    <Text style={styles.consistencyLabel}>STEP GOAL{'\n'}DAYS</Text>
                  </View>
                  <View style={styles.consistencyDivider} />
                  <View style={styles.consistencyTile}>
                    <Text style={[styles.consistencyNum, { color: C_GREEN }]}>{thisWeekSessions}/{weeklyGoal}</Text>
                    <Text style={styles.consistencyLabel}>WORKOUT{'\n'}SESSIONS</Text>
                  </View>
                </View>
              </ExportCardTemplate>
            </View>

            {/* ── Workout Banner (today completed) ────────────────── */}
            {data?.hasTodayWorkout && (
              <View style={styles.banner}>
                <Text style={styles.bannerEmoji}>✅</Text>
                <View style={styles.bannerBody}>
                  <Text style={styles.bannerTitle}>{data.todayWorkoutName} done today!</Text>
                  <Text style={styles.bannerSub}>{data.todayExCount} exercises · {data.todaySetCount} sets logged</Text>
                </View>
                <TouchableOpacity style={styles.viewBtn} onPress={() => navigation.navigate('Workout')}>
                  <Text style={styles.viewBtnText}>View</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Weekly Tabs ────────────────────────────────────── */}
            <View style={styles.tabsCard}>
              <View style={styles.tabsRow}>
                {WEEK_TABS.map((t, i) => {
                  const isProTab = i === 2 || i === 3;
                  const tabLocked = isProTab && !hasAccess;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={styles.tabBtn}
                      onPress={() => (tabLocked ? setShowProTeaserPaywall(true) : setActiveTab(i))}
                    >
                      <View style={styles.tabLabelRow}>
                        <Text style={[styles.tabLabel, activeTab === i && styles.tabLabelActive]}>{t}</Text>
                        {tabLocked && <Ionicons name="lock-closed" size={9} color={colors.textDim} style={{ marginLeft: 3 }} />}
                      </View>
                      {activeTab === i && <View style={styles.tabUnderline} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {activeTab === 3 ? (
                <View>
                  <View style={styles.weekHdr}>
                    <View style={styles.weekHdrLeft}>
                      <Ionicons name="speedometer-outline" size={13} color={colors.accent} />
                      <Text style={styles.weekHdrLabel}>WEEKLY CUT SCORE</Text>
                    </View>
                  </View>
                  <View style={styles.cutRow}>
                    <View style={[styles.cutRing, { borderColor: colors.warning }]}>
                      <Text style={[styles.cutNum, { color: colors.warning }]}>{cutScore}</Text>
                      <Text style={styles.cutOf}>/100</Text>
                    </View>
                    <View style={styles.cutDetails}>
                      <Text style={styles.cutTitle}>{cutStatus}</Text>
                      <Text style={styles.cutSub}>{cutSubtitle}</Text>
                    </View>
                  </View>
                  <View style={styles.cutBreakdown}>
                    {[
                      { label: 'Steps', value: stepsPct },
                      { label: 'Calories', value: caloriesPct },
                      { label: 'Sessions', value: sessionsPct },
                      { label: 'Wt trend', value: wtTrendPct },
                    ].map(row => (
                      <View key={row.label} style={styles.cutBreakdownRow}>
                        <Text style={styles.cutBreakdownLabel}>{row.label}</Text>
                        <View style={styles.cutTrack}>
                          <View style={[styles.cutFill, { width: `${row.value}%`, backgroundColor: colors.accent }]} />
                        </View>
                        <Text style={styles.cutBreakdownValue}>{row.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.weekHdr}>
                    <View style={styles.weekHdrLeft}>
                      <Ionicons name="calendar-outline" size={13} color={colors.accent} />
                      <Text style={styles.weekHdrLabel}>
                        {activeTab === 0 ? 'THIS WEEK' : activeTab === 1 ? 'LAST WEEK' : 'MONTHLY'}
                      </Text>
                    </View>
                    {activeTab === 0 && <Text style={styles.weekHdrDate}>{fmtWeekLabel()}</Text>}
                    {activeTab === 1 && <Text style={styles.weekHdrDate}>{fmtLastWeekLabel()}</Text>}
                    {activeTab === 2 && <Text style={styles.weekHdrDate}>{CAL_MONTHS_SHORT[new Date().getMonth()]} {new Date().getFullYear()}</Text>}
                  </View>

                  {activeTab === 2 ? (
                    <>
                      <View style={styles.statsRow}>
                        <StatTile value={String(tabStats[2]?.gymCount ?? 0)} label="GYM" color={C_GREEN} />
                        <StatTile value={String(tabStats[2]?.cardioCount ?? 0)} label="CARDIO" color="#60a5fa" />
                        <StatTile value={tabStats[2]?.kcal ? fmtK(tabStats[2].kcal) : '—'} label="KCAL" color={C_KCAL} />
                        <StatTile value={tabStats[2]?.avgWeight != null ? tabStats[2].avgWeight.toFixed(1) : '—'} label="AVG WT" color={C_WEIGHT} last />
                      </View>
                      <View style={styles.statsRow}>
                        <StatTile value={fmtK(tabStats[2]?.avgSteps)} label="AVG STEPS" color={C_STEPS} />
                        <StatTile value={String(tabStats[2]?.restCount ?? 0)} label="REST DAYS" color="#f59e0b" last />
                      </View>
                    </>
                  ) : (
                  <View style={styles.statsRow}>
                    <StatTile
                      value={String(tabStats[activeTab]?.sessions ?? 0)}
                      label="SESSIONS"
                      sub={activeTab === 0 && data ? deltaStr(data.thisWeek.sessions - data.lastWeek.sessions) + ' vs last wk' : null}
                      subColor={activeTab === 0 && data
                        ? ((data.thisWeek.sessions - data.lastWeek.sessions) > 0
                          ? C_GREEN
                          : (data.thisWeek.sessions - data.lastWeek.sessions) < 0
                            ? '#f87171'
                            : null)
                        : null}
                      color={colors.accent}
                    />
                    <StatTile
                      value={fmtK(tabStats[activeTab]?.steps)}
                      label="STEPS"
                      sub={`${tabStats[activeTab]?.goalDays ?? 0}/${periodDays[activeTab]} goal days`}
                      color={C_STEPS}
                    />
                    <StatTile
                      value={tabStats[activeTab]?.kcal ? fmtK(tabStats[activeTab].kcal) : '—'}
                      label="KCAL"
                      sub={!tabStats[activeTab]?.kcal ? 'not logged' : null}
                      color={C_KCAL}
                    />
                    <StatTile
                      value={tabStats[activeTab]?.weightDelta !== null && tabStats[activeTab]?.weightDelta !== undefined
                        ? `${tabStats[activeTab].weightDelta > 0 ? '+' : ''}${tabStats[activeTab].weightDelta}kg`
                        : '—'}
                      label="WT Δ"
                      sub={activeTab === 0 ? 'wk change' : activeTab === 1 ? 'wk change' : 'mo change'}
                      color={tabStats[activeTab]?.weightDelta == null
                        ? C_WEIGHT
                        : tabStats[activeTab].weightDelta > 0 ? '#f87171' : C_GREEN}
                      last
                    />
                  </View>
                  )}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <StreakCalendarModal
        visible={showStreak}
        userId={user?.id}
        onClose={() => setShowStreak(false)}
        hasAccess={hasAccess}
        weeklyGoal={data?.weeklyGoal ?? 4}
      />

      <PaywallModal visible={consistencyExport.showPaywall} onClose={() => consistencyExport.setShowPaywall(false)} />
      <PaywallModal visible={showForecastPaywall} onClose={() => setShowForecastPaywall(false)} />
      <PaywallModal visible={showProTeaserPaywall} onClose={() => setShowProTeaserPaywall(false)} />

      {/* Quick log: Weight */}
      <BottomSheet visible={showWeightLog} onClose={() => setShowWeightLog(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>LOG WEIGHT</Text>
          <TouchableOpacity onPress={() => setShowWeightLog(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={styles.sheetFieldLabel}>WEIGHT (KG)</Text>
          {data?.latestWeight && <Text style={styles.lastHint}>↑ LAST: {data.latestWeight.weight}KG</Text>}
        </View>
        <TextInput
          style={styles.sheetInput}
          value={weightQuickInput}
          onChangeText={setWeightQuickInput}
          placeholder={data?.latestWeight ? String(data.latestWeight.weight) : '70.0'}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
          autoFocus
        />
        <TouchableOpacity
          style={[styles.saveBtn, { marginTop: 18 }]}
          onPress={() => weightQuickInput && weightQuickMut.mutate(parseFloat(weightQuickInput))}
          disabled={weightQuickMut.isPending}
        >
          {weightQuickMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Weight</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Quick log: Sleep */}
      <BottomSheet visible={showSleepLog} onClose={() => setShowSleepLog(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>LOG SLEEP</Text>
          <TouchableOpacity onPress={() => setShowSleepLog(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sheetFieldLabel}>HOURS SLEPT</Text>
        <TextInput
          style={styles.sheetInput}
          value={sleepQuickInput}
          onChangeText={setSleepQuickInput}
          placeholder={data?.sleepGoal ? String(data.sleepGoal) : '8'}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
          autoFocus
        />
        <TouchableOpacity
          style={[styles.saveBtn, { marginTop: 18 }]}
          onPress={() => {
            const hours = parseFloat(sleepQuickInput);
            if (Number.isFinite(hours)) sleepQuickMut.mutate(hours);
          }}
          disabled={sleepQuickMut.isPending}
        >
          {sleepQuickMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Sleep</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

function deltaStr(n) {
  if (!n) return '0';
  return (n > 0 ? '+' : '') + n;
}

function StatTile({ value, label, sub, subColor, color, last }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.statTile, !last && styles.statTileDivider]}>
      <Text style={[styles.statTileNum, { color }]}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
      {sub ? <Text style={[styles.statTileSub, subColor && { color: subColor }]}>{sub}</Text> : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 40 },
  appHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  logo: { fontSize: 22, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text, letterSpacing: -0.5 },
  logoDot: { color: colors.accent },
  screenLabel: { fontSize: 11, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.good },
  headerAvatarBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  headerAvatarText: { fontSize: 13, fontWeight: weight.black, color: colors.bg },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  avatarRing: { width: 68, height: 68, borderRadius: 34, padding: 2.5, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent },
  avatarInner: { width: 63, height: 63, borderRadius: 31.5, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontFamily: fontFamily.bodyExtraBold, color: colors.text },
  profileInfo: { flex: 1 },
  greeting: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.bodySemibold, letterSpacing: 0.8, marginBottom: 2, textTransform: 'uppercase' },
  profileName: { fontSize: 22, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text, lineHeight: 26, letterSpacing: -0.5 },
  motivRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  motivText: { fontSize: 11, color: colors.accent, fontFamily: fontFamily.bodySemibold, textDecorationLine: 'underline' },
  proBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 14, padding: 12, borderRadius: 14,
    backgroundColor: colors.accent,
  },
  proBannerText: { flex: 1, fontSize: 12, fontWeight: weight.bold, color: colors.accentText },
  goalProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  goalProgressLabel: { fontSize: 10, color: colors.textMuted, width: 76, fontFamily: fontFamily.body },
  goalProgressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.dim, overflow: 'hidden' },
  goalProgressFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
  goalProgressPct: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.mono },
  insightScroll: { marginBottom: 8, marginHorizontal: 16 },
  insightCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 14, borderRadius: 12, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  insightText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 15, fontFamily: fontFamily.body },
  insightDotsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginBottom: 10 },
  insightDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.dim },
  sectionLabel: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 16, marginBottom: 8 },
  chartCard: { backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: 14, marginHorizontal: 16, marginBottom: 10, padding: 14 },
  chartHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  chartTitle: { fontSize: 12, fontFamily: fontFamily.bodyBold, color: colors.textMuted },
  chartLegend: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 9, color: colors.textDim, fontFamily: fontFamily.body },
  chartStatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  chartStatTile: { flex: 1, alignItems: 'center' },
  chartStatVal: { fontSize: 14, fontFamily: fontFamily.bodyBold, color: colors.text, fontWeight: weight.bold },
  chartStatLabel: { fontSize: 8, color: colors.textDim, fontFamily: fontFamily.body, letterSpacing: 0.4, marginTop: 2, textAlign: 'center' },
  chartStatDivider: { width: 1, height: 22, backgroundColor: colors.border },
  consistencyCard: { flexDirection: 'row', backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: 14, marginHorizontal: 16, marginBottom: 10, overflow: 'hidden' },
  consistencyTile: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  consistencyNum: { fontSize: 18, fontFamily: fontFamily.monoBold },
  consistencyLabel: { fontSize: 7, color: colors.textDim, fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, textAlign: 'center', marginTop: 4 },
  consistencyDivider: { width: 1, backgroundColor: colors.border },
  cardExportBtn: { position: 'absolute', top: 8, right: 24, padding: 6, borderRadius: 14, backgroundColor: colors.bgElevated ?? colors.bgCard },
  overviewCard: {
    backgroundColor: colors.bgCard, borderRadius: 16, marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3,
  },
  forecastCard: { backgroundColor: colors.bgCard, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.accent + '55', padding: 14 },
  forecastHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  forecastTitle: { fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.5, flex: 1 },
  proBadge: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  proBadgeText: { fontSize: 9, fontWeight: weight.black, color: colors.bg },
  forecastHeadline: { fontSize: 17, fontWeight: weight.black, color: colors.text, marginBottom: 4 },
  forecastSub: { fontSize: 11, color: colors.textMuted, lineHeight: 16 },
  insightsHubCard: {
    backgroundColor: colors.bgCard, borderRadius: 16, marginHorizontal: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.accent + '40', overflow: 'hidden',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4,
  },
  insightsHubHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  insightsHubHeaderText: { fontSize: 11, fontWeight: weight.black, color: '#0a0a0a', letterSpacing: 0.6, flex: 1 },
  insightsHubUnlockPill: { backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  insightsHubUnlockText: { fontSize: 9, fontWeight: weight.black, color: '#0a0a0a' },
  insightsHubRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  insightsHubBody: { flex: 1 },
  insightsHubTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  insightsHubTitle: { fontSize: 9, fontFamily: fontFamily.bodyBold, letterSpacing: 0.6, textTransform: 'uppercase' },
  insightsHubSub: { fontSize: 10.5, color: colors.textDim, marginTop: 2, fontFamily: fontFamily.body, lineHeight: 14 },
  insightsHubVal: { fontSize: 14, fontFamily: fontFamily.bodyBold, color: colors.text, fontWeight: weight.semibold, maxWidth: 110, textAlign: 'right' },
  miniProBadge: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1.5 },
  miniProBadgeText: { fontSize: 7.5, fontWeight: weight.black, color: colors.bg },
  overviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  overviewIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim },
  overviewBody: { flex: 1 },
  overviewLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, letterSpacing: 0.8, textTransform: 'uppercase' },
  overviewSub: { fontSize: 10, color: colors.textDim, marginTop: 2, fontFamily: fontFamily.body },
  overviewRight: { alignItems: 'flex-end' },
  overviewVal: { fontSize: 18, fontFamily: fontFamily.monoBold, color: colors.text, fontWeight: weight.bold },
  overviewDelta: { fontSize: 9, fontFamily: fontFamily.bodyBold, marginTop: 2 },
  overviewDivider: { height: 1, backgroundColor: colors.border, marginLeft: 54 },
  banner: { backgroundColor: colors.bgCard, marginHorizontal: 16, marginBottom: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border },
  bannerEmoji: { fontSize: 22 },
  bannerBody: { flex: 1 },
  bannerTitle: { fontSize: 13, fontFamily: fontFamily.bodyBold, color: colors.text, lineHeight: 17 },
  bannerSub: { fontSize: 10, color: colors.textMuted, marginTop: 2, fontFamily: fontFamily.body },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: `${C_GREEN}20`, borderWidth: 1, borderColor: C_GREEN },
  viewBtnText: { fontSize: 12, color: C_GREEN, fontFamily: fontFamily.bodyBold },
  nudgeCard: { backgroundColor: colors.bgCard, marginHorizontal: 16, marginBottom: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10, borderWidth: 1, borderColor: colors.border },
  nudgeIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  nudgeBody: { flex: 1 },
  nudgeTitle: { fontSize: 13, fontFamily: fontFamily.bodyBold, color: colors.text, lineHeight: 17 },
  nudgeSub: { fontSize: 10, color: colors.textMuted, marginTop: 2, fontFamily: fontFamily.body },
  nudgeLogBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  nudgeLogBtnText: { fontSize: 12, fontWeight: weight.bold, color: '#0c0c0f', fontFamily: fontFamily.bodyBold },
  nudgeBadgeWrap: { alignItems: 'center' },
  nudgeBadgeNum: { fontSize: 16, fontWeight: weight.black, fontFamily: fontFamily.mono },
  nudgeBadgeLabel: { fontSize: 8, color: colors.textDim, fontFamily: fontFamily.mono, letterSpacing: 0.5 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 2, fontFamily: fontFamily.mono },
  sheetFieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  lastHint: { fontSize: 10, color: colors.accent, fontFamily: fontFamily.mono },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
  tabsCard: { marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  tabLabelRow: { flexDirection: 'row', alignItems: 'center' },
  tabLabel: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.5 },
  tabLabelActive: { color: colors.accent },
  tabUnderline: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, backgroundColor: colors.accent, borderRadius: 1 },
  weekHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  weekHdrLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekHdrLabel: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1 },
  weekHdrDate: { fontSize: 10, color: colors.textDim, fontFamily: fontFamily.mono },
  statsRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 16 },
  statTile: { flex: 1, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 2 },
  statTileDivider: { borderRightWidth: 1, borderRightColor: colors.border },
  statTileNum: { fontSize: 20, fontFamily: fontFamily.monoBold, lineHeight: 24 },
  statTileLabel: { fontSize: 8, color: colors.textDim, fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2 },
  statTileSub: { fontSize: 8, color: colors.textMuted, marginTop: 3, textAlign: 'center', fontFamily: fontFamily.body },
  cutRow: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  cutGauge: { width: 70, height: 70, borderRadius: 35, borderWidth: 2.5, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  cutRing: { width: 70, height: 70, borderRadius: 35, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  cutNum: { fontSize: 22, fontFamily: fontFamily.monoBold, color: colors.accent },
  cutOf: { fontSize: 9, color: colors.textMuted, fontFamily: fontFamily.mono },
  cutDetails: { flex: 1 },
  cutTitle: { fontSize: 16, fontFamily: fontFamily.bodyExtraBold, color: colors.text },
  cutSub: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: fontFamily.body },
  cutTrack: { flex: 1, height: 5, backgroundColor: colors.bgElevated, borderRadius: 3, overflow: 'hidden' },
  cutFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  cutBreakdown: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  cutBreakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cutBreakdownLabel: { width: 64, fontSize: 12, color: colors.textMuted, fontFamily: fontFamily.body },
  cutBreakdownValue: { width: 28, fontSize: 12, color: colors.text, textAlign: 'right', fontFamily: fontFamily.monoBold },
  restCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#001815', borderWidth: 1, borderColor: '#006650', borderRadius: 14, padding: 12, marginBottom: 8 },
  restIcon: { width: 44, height: 44, borderRadius: 11, backgroundColor: '#002820', borderWidth: 1, borderColor: '#006650', alignItems: 'center', justifyContent: 'center' },
  restTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: '#00cc99' },
  restSub: { fontSize: typography.xs, color: '#008866', marginTop: 2 },
  sessionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8 },
  sessionIcon: { width: 44, height: 44, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sessionNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  sessionName: { fontSize: typography.base, fontWeight: weight.bold },
  deltaBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  deltaText: { fontSize: 11, fontWeight: weight.bold },
  sessionSub: { fontSize: typography.xs, color: colors.textDim },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, marginBottom: 8 },
  monthBtn: { padding: 10 },
  monthChevron: { fontSize: 26, color: colors.text, fontWeight: '300' },
  monthLabel: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim },
  fab: { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center', shadowColor: colors.warning, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 10 },
});

const createScS = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  popup: { width: '100%', maxWidth: 420, maxHeight: '85%', backgroundColor: colors.bgElevated, borderRadius: 28, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 20, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  closeBtn: { padding: 8, borderRadius: 20, backgroundColor: colors.bgCard },
  statCard: { flexDirection: 'row', backgroundColor: colors.bgCard, borderRadius: 14, marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  statCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9 },
  statDivider: { width: 1, backgroundColor: colors.border },
  statCellVal: { fontSize: 16, fontWeight: '900' },
  statCellLbl: { fontSize: 9, color: colors.textDim, fontWeight: '700', letterSpacing: 0.5, marginTop: 2, textAlign: 'center' },
  statCellSub: { fontSize: 8, color: colors.textMuted, marginTop: 1, textAlign: 'center' },
  calSection: { paddingHorizontal: CAL_PAD, marginTop: 12 },
  calNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  calMonthTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  calNavBtns: { flexDirection: 'row', gap: 6 },
  calNavBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.bgCard, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  calNavText: { fontSize: 20, color: colors.text, lineHeight: 24, fontWeight: '300' },
  dayNamesRow: { flexDirection: 'row', gap: CAL_GAP, marginBottom: 6 },
  dayNameCell: { width: CAL_CELL, alignItems: 'center', paddingVertical: 4 },
  dayNameText: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CAL_GAP },
  dayCell: { width: CAL_CELL, height: CAL_CELL, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated },
  dayCellToday: { borderColor: colors.text, borderWidth: 2 },
  dayNum: { fontSize: 13, color: colors.text, fontWeight: '700' },
  dayNumToday: { color: colors.text },
  dayDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
});

const createDdS = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '82%', borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border },
  typeName: { fontSize: 22, fontWeight: '900', lineHeight: 28 },
  dateText: { fontSize: 11, color: colors.textMuted, marginTop: 5 },
  closeBtn: { padding: 8, borderRadius: 20, backgroundColor: colors.bgElevated, marginLeft: 8 },
  dayStatsRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
  dayStat: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  dayStatIcon: { fontSize: 16, marginBottom: 4 },
  dayStatValue: { fontSize: 16, fontWeight: '900', lineHeight: 20 },
  dayStatLabel: { fontSize: 8, color: colors.textDim, fontWeight: '700', letterSpacing: 0.8, marginTop: 2 },
  sectionLabel: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  sectionLabelText: { fontSize: 10, color: colors.textMuted, fontWeight: '700', letterSpacing: 1.5 },
  exScroll: { paddingHorizontal: 12 },
  exCard: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  exName: { fontSize: 14, fontWeight: '900', color: colors.text, marginBottom: 8 },
  setChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  setChip: { backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  setChipText: { fontSize: 11, color: colors.warning, fontWeight: '700' },
  setChipCardio: { backgroundColor: colors.bgCard, borderColor: '#1e3a8a' },
  setChipTextCardio: { fontSize: 11, color: '#60a5fa', fontWeight: '700' },
  recoveryBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  recoveryText: { fontSize: 18, fontWeight: '800', color: '#00cc99' },
  noLogText: { fontSize: 14, color: colors.textDim },
});
