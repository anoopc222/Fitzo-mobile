import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

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

// ─── accent palette (matches ActivityTracker web app) ──────────────────────
const C_WEIGHT = '#fb7185'; // rose
const C_STEPS  = '#f59e0b'; // amber gold
const C_KCAL   = '#fb7185'; // rose
const C_SLEEP  = '#c4b5fd'; // soft violet
const C_GREEN  = '#34d399';
const WEEKLY_SESSION_GOAL = 4;

// Styles will be defined later using static colors

// ─── helpers ────────────────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'GOOD MORNING';
  if (h < 17) return 'GOOD AFTERNOON';
  if (h < 21) return 'GOOD EVENING';
  return 'GOOD NIGHT';
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
  return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [start.toISOString().split('T')[0], end.toISOString().split('T')[0]];
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

// ─── data fetch ─────────────────────────────────────────────────────────────
async function fetchHome(userId) {
  const today = new Date().toISOString().split('T')[0];
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
  ] = await Promise.all([
    supabase.from('profiles')
      .select('full_name, goal, weight_goal_kg, step_goal, sleep_goal_hours')
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
      .select('steps, goal').eq('user_id', userId)
      .gte('logged_at', thisWeekStart).lte('logged_at', thisWeekEnd),
    supabase.from('step_logs')
      .select('steps, goal').eq('user_id', userId)
      .gte('logged_at', lastWeekStart).lte('logged_at', lastWeekEnd),
    supabase.from('step_logs')
      .select('steps, goal').eq('user_id', userId)
      .gte('logged_at', monthStart).lte('logged_at', monthEnd),
    supabase.from('food_logs')
      .select('calories').eq('user_id', userId)
      .gte('logged_at', `${thisWeekStart}T00:00:00`).lte('logged_at', `${thisWeekEnd}T23:59:59`),
    supabase.from('food_logs')
      .select('calories').eq('user_id', userId)
      .gte('logged_at', `${lastWeekStart}T00:00:00`).lte('logged_at', `${lastWeekEnd}T23:59:59`),
    supabase.from('food_logs')
      .select('calories').eq('user_id', userId)
      .gte('logged_at', `${monthStart}T00:00:00`).lte('logged_at', `${monthEnd}T23:59:59`),
    supabase.from('weight_logs')
      .select('weight').eq('user_id', userId)
      .gte('logged_at', `${monthStart}T00:00:00`).lte('logged_at', `${monthEnd}T23:59:59`),
  ]);

  const weightArr = (weightHist.data ?? []).map(w => w.weight).reverse();
  const stepsArr  = (stepsHist.data ?? []).map(s => s.steps).reverse();
  const sleepArr  = (sleepHist.data ?? []).map(s => s.hours).reverse();

  const latestWeight = weightHist.data?.[0];
  const prevWeight   = weightHist.data?.[1];
  const latestSteps  = stepsHist.data?.[0];
  const latestSleep  = sleepHist.data?.[0];

  const stepGoal  = profile.data?.step_goal ?? 10000;
  const sleepGoal = profile.data?.sleep_goal_hours ?? 8;

  const weightDeltaVsYday = (latestWeight && prevWeight)
    ? +(latestWeight.weight - prevWeight.weight).toFixed(1) : null;
  const stepGoalMet  = latestSteps ? latestSteps.steps >= (latestSteps.goal ?? stepGoal) : false;
  const sleepGoalMet = latestSleep ? latestSleep.hours >= sleepGoal : false;

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
  const thisWeekStepsTotal = thisWeekStepsArr.reduce((s, r) => s + r.steps, 0);
  const lastWeekStepsTotal = lastWeekStepsArr.reduce((s, r) => s + r.steps, 0);
  const monthStepsTotal    = monthStepsArr.reduce((s, r) => s + r.steps, 0);
  const thisWeekKcal = (thisWeekFood.data ?? []).reduce((s, r) => s + (r.calories ?? 0), 0);
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

  // Last workout info
  const lastWorkoutDate  = lastWorkout.data?.[0]?.date ?? null;
  const lastWorkoutNotes = lastWorkout.data?.[0]?.notes ?? null;
  const daysSinceWorkout = lastWorkoutDate
    ? Math.floor((Date.now() - new Date(lastWorkoutDate).getTime()) / 86400000) : null;

  // Streak (consecutive days with step logs)
  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    if (stepsHist.data?.some(s => s.logged_at?.startsWith(d))) streak++;
    else if (i > 0) break;
  }

  // Motivational line under name
  let motivText = 'Keep pushing! ⚡';
  if (hasTodayWorkout) motivText = `${todayWorkoutName} — great work! 💪`;
  else if (streak >= 7)  motivText = `${streak}-day streak! 🔥`;
  else if (stepGoalMet)  motivText = 'Step goal crushed! 👟';
  else if (weekWeightDelta !== null && weekWeightDelta < -0.2) motivText = 'Weight dropping! 📉';

  const sessionsLeft = Math.max(0, WEEKLY_SESSION_GOAL - thisWeekSessions);

  return {
    profile: profile.data,
    weightArr, stepsArr, sleepArr,
    latestWeight, latestSteps, latestSleep,
    weightDeltaVsYday,
    stepGoal, sleepGoal,
    stepGoalMet, sleepGoalMet,
    todayKcal, todayProtein,
    hasTodayWorkout, todaySession,
    todayExCount, todaySetCount, todayWorkoutName,
    lastWorkoutDate, lastWorkoutNotes, daysSinceWorkout,
    motivText, streak,
    thisWeek: { sessions: thisWeekSessions, steps: thisWeekStepsTotal, kcal: thisWeekKcal, goalDays: thisWeekGoalDays, weightDelta: weekWeightDelta },
    lastWeek: { sessions: lastWeekSessions, steps: lastWeekStepsTotal, kcal: lastWeekKcal, goalDays: lastWeekGoalDays, weightDelta: lastWeekWeightDelta },
    thisMonth: {
      sessions: monthSessions, steps: monthStepsTotal, kcal: monthKcal, goalDays: monthGoalDays, weightDelta: monthWeightDelta,
      gymCount: monthSessions, cardioCount: monthCardioCount, restCount: monthRestCount,
      avgWeight: monthAvgWeight, avgSteps: monthAvgSteps,
    },
    sessionsLeft,
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
    staleTime: 0, gcTime: 0,
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

function StreakCalendarModal({ visible, userId, onClose }) {
  const { colors } = useTheme();
  const scS = useMemo(() => createScS(colors), [colors]);
  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const [selDay,   setSelDay]   = useState(null);
  const [showDay,  setShowDay]  = useState(false);

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
    staleTime: 0, gcTime: 0,
  });

  const prevMonthDate = new Date(calYear, calMonth - 2, 1);
  const prevYear  = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth() + 1;

  const { data: prevSessions = [] } = useQuery({
    queryKey: ['streak-sessions', userId, prevYear, prevMonth],
    queryFn: () => fetchMonthSessions(userId, prevYear, prevMonth),
    enabled: !!(userId && visible),
    staleTime: 0, gcTime: 0,
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
      const key = mon.toISOString().split('T')[0];
      wm[key] = (wm[key] ?? 0) + 1;
    });
    return Object.values(wm);
  }, [sessions]);

  const bestWk = weeklyActive.length ? Math.max(...weeklyActive) : '—';
  const lowWk  = weeklyActive.length ? Math.min(...weeklyActive) : '—';
  const metGoalWeeks = weeklyActive.filter(c => c >= WEEKLY_SESSION_GOAL).length;
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
    { val: `${consistency}%`, lbl: 'CONSISTENCY', icon: 'checkmark-circle', color: consistency >= 50 ? C_GREEN : C_KCAL, sub: `${metGoalWeeks}/${weeklyActive.length} wks · ${WEEKLY_SESSION_GOAL}/wk` },
    { val: noLog,       lbl: 'NO LOG',       icon: 'close-circle',     color: colors.textDim },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={scS.overlay}>
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
    </Modal>
  );
}

const WEEK_TABS = ['THIS WEEK', 'LAST WEEK', 'THIS MONTH', 'CUT SCORE'];

// ─── component ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const [activeTab,   setActiveTab]   = useState(0);
  const [showStreak,  setShowStreak]  = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['home', user?.id],
    queryFn: () => fetchHome(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const onRefresh = useCallback(() => refetch(), [refetch]);

  const displayName = (data?.profile?.full_name ?? user?.user_metadata?.full_name ?? 'User').toUpperCase();
  const initial     = displayName[0] ?? 'F';
  const goal        = data?.profile?.goal ?? 'General Health';

  function nav(target) {
    const tabs = ['Home', 'Workout', 'Log', 'Steps', 'Weight', 'Sleep'];
    if (tabs.includes(target)) navigation.navigate(target);
    else navigation.navigate('More'); // HomeStack screen
  }

  const thisWeekSessions = data?.thisWeek?.sessions ?? 0;
  const sessionsLeft     = data?.sessionsLeft ?? WEEKLY_SESSION_GOAL;

  const tabStats = [data?.thisWeek, data?.lastWeek, data?.thisMonth];
  const todayIsoDow = (() => { const d = new Date().getDay(); return d === 0 ? 7 : d; })();
  const periodDays = [Math.max(1, todayIsoDow - 1), 7, new Date().getDate()];

  const stepGoalForWeek = data?.stepGoal ?? 10000;
  const stepsPct    = Math.min(100, Math.round(((data?.thisWeek?.steps ?? 0) / (stepGoalForWeek * periodDays[0])) * 100));
  const caloriesPct = (data?.thisWeek?.kcal ?? 0) > 0 ? 100 : 0;
  const sessionsPct = Math.min(100, Math.round((thisWeekSessions / WEEKLY_SESSION_GOAL) * 100));
  const weightDelta = data?.thisWeek?.weightDelta;
  const wtTrendPct  = weightDelta == null ? 0 : Math.max(0, Math.min(100, Math.round(50 - weightDelta * 50)));

  const cutScore = Math.round(stepsPct * 0.3 + caloriesPct * 0.2 + sessionsPct * 0.35 + wtTrendPct * 0.15);
  const cutStatus = cutScore >= 80 ? 'Crushing it!' : cutScore >= 50 ? 'On track' : 'Needs attention';
  const cutSubtitle = (stepsPct < 50 || caloriesPct < 50)
    ? 'Steps or calories off target this week.'
    : 'Based on this week\'s consistency.';

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── App Header ─────────────────────────────────────────── */}
      <View style={styles.appHeader}>
        <Text style={styles.logo}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
        <Text style={styles.screenLabel}>HOME</Text>
        <View style={styles.headerRight}>
          <View style={styles.onlineDot} />
          <TouchableOpacity style={styles.menuBtn} onPress={() => navigation.navigate('More')}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

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
              </View>

              <View style={styles.goalPill}>
                <Text style={styles.goalPillText} numberOfLines={2}>{goal}</Text>
              </View>
            </View>

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
              </TouchableOpacity>

              <View style={styles.overviewDivider} />

              <TouchableOpacity style={styles.overviewRow} onPress={() => nav('Steps')} activeOpacity={0.7}>
                <View style={styles.overviewIconWrap}>
                  <Ionicons name="footsteps-outline" size={15} color={C_STEPS} />
                </View>
                <View style={styles.overviewBody}>
                  <Text style={[styles.overviewLabel, { color: C_STEPS }]}>STEPS</Text>
                  <Text style={styles.overviewSub}>steps yesterday</Text>
                </View>
                <View style={styles.overviewRight}>
                  <Text style={styles.overviewVal}>{data?.latestSteps?.steps?.toLocaleString() ?? '—'}</Text>
                  {data?.stepGoalMet && <Text style={[styles.overviewDelta, { color: C_GREEN }]}>✓ Goal met!</Text>}
                </View>
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
                  <Text style={styles.overviewSub}>{data?.latestSleep ? 'logged today' : 'not logged'}</Text>
                </View>
                <View style={styles.overviewRight}>
                  <Text style={styles.overviewVal}>{data?.latestSleep ? `${data.latestSleep.hours}h` : '—'}</Text>
                  {data?.sleepGoalMet && <Text style={[styles.overviewDelta, { color: C_GREEN }]}>✓ Goal met</Text>}
                </View>
              </TouchableOpacity>
            </View>

            {/* ── Workout Banner ─────────────────────────────────── */}
            {data?.hasTodayWorkout ? (
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
            ) : (
              <TouchableOpacity style={styles.banner} onPress={() => navigation.navigate('Workout')} activeOpacity={0.85}>
                <Ionicons name="barbell-outline" size={22} color={colors.warning} />
                <View style={styles.bannerBody}>
                  <Text style={[styles.bannerTitle, { color: colors.warning }]}>No workout today</Text>
                  <Text style={styles.bannerSub}>Tap to start a new session</Text>
                </View>
                <View style={[styles.viewBtn, { borderColor: colors.warning, backgroundColor: colors.warning + '22' }]}>
                  <Text style={[styles.viewBtnText, { color: colors.warning }]}>Start</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* ── Goal Progress Banner ───────────────────────────── */}
            {sessionsLeft > 0 ? (
              <View style={styles.banner}>
                <View style={[styles.goalIconWrap, { backgroundColor: '#ef444433' }]}>
                  <Ionicons name="trophy" size={18} color="#ef4444" />
                </View>
                <View style={styles.bannerBody}>
                  <Text style={styles.bannerTitle}>
                    Almost there! — {sessionsLeft} more session{sessionsLeft !== 1 ? 's' : ''} this week
                  </Text>
                  <Text style={styles.bannerSub}>
                    {thisWeekSessions}/{WEEKLY_SESSION_GOAL} gym sessions
                    {data?.lastWorkoutDate ? ` · Last: ${fmtDate(data.lastWorkoutDate)}` : ''}
                  </Text>
                </View>
                <View style={styles.goalCount}>
                  <Text style={[styles.goalCountNum, { color: colors.accent }]}>{thisWeekSessions}</Text>
                  <Text style={styles.goalCountLabel}>THIS{'\n'}WEEK</Text>
                </View>
              </View>
            ) : (
              <View style={styles.banner}>
                <View style={[styles.goalIconWrap, { backgroundColor: '#34d39933' }]}>
                  <Ionicons name="trophy" size={18} color={C_GREEN} />
                </View>
                <View style={styles.bannerBody}>
                  <Text style={[styles.bannerTitle, { color: C_GREEN }]}>Weekly goal achieved! 🎯</Text>
                  <Text style={styles.bannerSub}>{thisWeekSessions}/{WEEKLY_SESSION_GOAL} sessions completed</Text>
                </View>
                <View style={styles.goalCount}>
                  <Text style={[styles.goalCountNum, { color: C_GREEN }]}>{thisWeekSessions}</Text>
                  <Text style={styles.goalCountLabel}>THIS{'\n'}WEEK</Text>
                </View>
              </View>
            )}

            {/* ── Weekly Tabs ────────────────────────────────────── */}
            <View style={styles.tabsCard}>
              <View style={styles.tabsRow}>
                {WEEK_TABS.map((t, i) => (
                  <TouchableOpacity key={t} style={styles.tabBtn} onPress={() => setActiveTab(i)}>
                    <Text style={[styles.tabLabel, activeTab === i && styles.tabLabelActive]}>{t}</Text>
                    {activeTab === i && <View style={styles.tabUnderline} />}
                  </TouchableOpacity>
                ))}
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
                        <StatTile value={tabStats[2]?.avgWeight != null ? tabStats[2].avgWeight.toFixed(1) : '—'} label="AVG WT" color={C_WEIGHT} />
                      </View>
                      <View style={styles.statsRow}>
                        <StatTile value={fmtK(tabStats[2]?.avgSteps)} label="AVG STEPS" color={C_STEPS} />
                        <StatTile value={String(tabStats[2]?.restCount ?? 0)} label="REST DAYS" color="#f59e0b" />
                      </View>
                    </>
                  ) : (
                  <View style={styles.statsRow}>
                    <StatTile
                      value={String(tabStats[activeTab]?.sessions ?? 0)}
                      label="SESSIONS"
                      sub={activeTab === 0 && data ? deltaStr(data.thisWeek.sessions - data.lastWeek.sessions) + ' vs last wk' : null}
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
                      color={C_WEIGHT}
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
      />
    </SafeAreaView>
  );
}

function deltaStr(n) {
  if (!n) return '0';
  return (n > 0 ? '+' : '') + n;
}

function StatTile({ value, label, sub, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statTileNum, { color }]}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
      {sub ? <Text style={styles.statTileSub}>{sub}</Text> : null}
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
  menuBtn: { padding: 4, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim, borderWidth: 1, borderColor: colors.border },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  avatarRing: { width: 68, height: 68, borderRadius: 34, padding: 2.5, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accent },
  avatarInner: { width: 63, height: 63, borderRadius: 31.5, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontFamily: fontFamily.bodyExtraBold, color: colors.text },
  profileInfo: { flex: 1 },
  greeting: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.bodySemibold, letterSpacing: 0.8, marginBottom: 2, textTransform: 'uppercase' },
  profileName: { fontSize: 22, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text, lineHeight: 26, letterSpacing: -0.5 },
  motivRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  motivText: { fontSize: 11, color: colors.accent, fontFamily: fontFamily.bodySemibold, textDecorationLine: 'underline' },
  goalPill: { backgroundColor: colors.dim, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, maxWidth: 96, alignItems: 'center' },
  goalPillText: { fontSize: 10, color: colors.textMuted, textAlign: 'center', fontFamily: fontFamily.bodyMedium, lineHeight: 14 },
  overviewCard: { backgroundColor: colors.bgCard, borderRadius: 16, marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  overviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  overviewIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim },
  overviewBody: { flex: 1 },
  overviewLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, letterSpacing: 0.8, textTransform: 'uppercase' },
  overviewSub: { fontSize: 10, color: colors.textDim, marginTop: 2, fontFamily: fontFamily.body },
  overviewRight: { alignItems: 'flex-end' },
  overviewVal: { fontSize: 17, fontFamily: fontFamily.monoBold, color: colors.text },
  overviewDelta: { fontSize: 9, fontFamily: fontFamily.bodyBold, marginTop: 2 },
  overviewDivider: { height: 1, backgroundColor: colors.border, marginLeft: 54 },
  banner: { backgroundColor: colors.bgCard, marginHorizontal: 16, marginBottom: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border },
  bannerEmoji: { fontSize: 22 },
  bannerBody: { flex: 1 },
  bannerTitle: { fontSize: 13, fontFamily: fontFamily.bodyBold, color: colors.text, lineHeight: 17 },
  bannerSub: { fontSize: 10, color: colors.textMuted, marginTop: 2, fontFamily: fontFamily.body },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: `${C_GREEN}20`, borderWidth: 1, borderColor: C_GREEN },
  viewBtnText: { fontSize: 12, color: C_GREEN, fontFamily: fontFamily.bodyBold },
  goalIconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  goalCount: { alignItems: 'center' },
  goalCountNum: { fontSize: 24, fontFamily: fontFamily.monoBold, lineHeight: 26 },
  goalCountLabel: { fontSize: 7, color: colors.textDim, fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, textAlign: 'center' },
  tabsCard: { marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  tabLabel: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.5 },
  tabLabelActive: { color: colors.accent },
  tabUnderline: { position: 'absolute', bottom: 0, left: '15%', right: '15%', height: 2, backgroundColor: colors.accent, borderRadius: 1 },
  weekHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  weekHdrLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekHdrLabel: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1 },
  weekHdrDate: { fontSize: 10, color: colors.textDim, fontFamily: fontFamily.mono },
  statsRow: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 16 },
  statTile: { flex: 1, alignItems: 'center', paddingVertical: 4, paddingHorizontal: 2 },
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
