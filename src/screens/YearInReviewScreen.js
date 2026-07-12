import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import PaywallModal from '../components/ui/PaywallModal';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function classifySession(notes) {
  if (!notes) return 'gym';
  const n = notes.toLowerCase();
  if (n === 'rest day') return 'rest';
  if (['cardio','run','stair','hiit','bike','swim','walk','cycle','elliptical'].some(k => n.includes(k))) return 'cardio';
  return 'gym';
}

function streakFromDays(sortedDays) {
  let best = 0, run = 0;
  sortedDays.forEach((d, i) => {
    if (i === 0) { run = 1; best = 1; return; }
    const prev = new Date(sortedDays[i - 1] + 'T00:00:00');
    const cur  = new Date(d + 'T00:00:00');
    const diff = Math.round((cur - prev) / 86400000);
    if (diff === 1) { run++; best = Math.max(best, run); }
    else run = 1;
  });
  return best;
}

async function fetchYearData(userId, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;
  const prevStart = `${year - 1}-01-01`;
  const prevEnd   = `${year - 1}-12-31`;

  const [sessions, steps, sleep, weightData, food, mood, prevSessions, prevSteps, prevSleep, prevWeight] = await Promise.all([
    supabase.from('workout_sessions')
      .select('id, date, notes, duration_min, total_volume, workout_exercises(id, exercise_name, sets(id, weight_kg, reps, rpe))')
      .eq('user_id', userId)
      .gte('date', yearStart).lte('date', yearEnd)
      .order('date', { ascending: true }),
    supabase.from('step_logs')
      .select('steps, goal, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${yearStart}T00:00:00`).lte('logged_at', `${yearEnd}T23:59:59`),
    supabase.from('sleep_logs')
      .select('hours, quality, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${yearStart}T00:00:00`).lte('logged_at', `${yearEnd}T23:59:59`),
    supabase.from('weight_logs')
      .select('weight, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${yearStart}T00:00:00`).lte('logged_at', `${yearEnd}T23:59:59`)
      .order('logged_at', { ascending: true }),
    supabase.from('food_logs')
      .select('calories, protein, carbs, fats, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${yearStart}T00:00:00`).lte('logged_at', `${yearEnd}T23:59:59`),
    supabase.from('mood_logs')
      .select('date, mood, energy')
      .eq('user_id', userId)
      .gte('date', yearStart).lte('date', yearEnd),
    // prev year
    supabase.from('workout_sessions')
      .select('id, date, notes')
      .eq('user_id', userId)
      .gte('date', prevStart).lte('date', prevEnd)
      .order('date', { ascending: true }),
    supabase.from('step_logs')
      .select('steps, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${prevStart}T00:00:00`).lte('logged_at', `${prevEnd}T23:59:59`),
    supabase.from('sleep_logs')
      .select('hours, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${prevStart}T00:00:00`).lte('logged_at', `${prevEnd}T23:59:59`),
    supabase.from('weight_logs')
      .select('weight, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${prevStart}T00:00:00`).lte('logged_at', `${prevEnd}T23:59:59`)
      .order('logged_at', { ascending: true }),
  ]);

  const allSessions = sessions.data ?? [];
  const stepsArr    = steps.data ?? [];
  const sleepArr2   = sleep.data ?? [];
  const weightArr   = weightData.data ?? [];
  const foodArr     = food.data ?? [];
  const moodArr     = mood.data ?? [];

  // classify
  const gymSessions    = allSessions.filter(s => classifySession(s.notes) === 'gym');
  const cardioSessions = allSessions.filter(s => classifySession(s.notes) === 'cardio');
  const restSessions   = allSessions.filter(s => classifySession(s.notes) === 'rest');

  const totalWorkouts = gymSessions.length;
  const cardioCount   = cardioSessions.length;
  const restCount     = restSessions.length;
  const gymCount      = gymSessions.length;

  // total volume (gym sessions only)
  const totalVolKg = gymSessions.reduce((sum, s) => {
    return sum + (s.workout_exercises ?? []).flatMap(ex => ex.sets ?? [])
      .reduce((sv, st) => sv + (st.weight_kg ?? 0) * (st.reps ?? 0), 0);
  }, 0);

  // duration
  const totalDurationHours = +(allSessions.reduce((sum, s) => sum + (s.duration_min ?? 0), 0) / 60).toFixed(1);

  // PRs (gym sessions)
  const prMap = {};
  gymSessions.forEach(s => {
    (s.workout_exercises ?? []).forEach(ex => {
      const name = ex.exercise_name ?? '';
      if (!name) return;
      const best = Math.max(...(ex.sets ?? []).map(st => st.weight_kg ?? 0));
      if (best > 0 && best > (prMap[name] ?? 0)) prMap[name] = best;
    });
  });
  const topPRs = Object.entries(prMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, kg]) => ({ name, kg }));

  // most trained exercise (all sessions, by set count)
  const exSetCount = {};
  allSessions.forEach(s => {
    (s.workout_exercises ?? []).forEach(ex => {
      const name = ex.exercise_name ?? '';
      if (!name) return;
      exSetCount[name] = (exSetCount[name] ?? 0) + (ex.sets ?? []).length;
    });
  });
  const mostTrainedExercise = Object.entries(exSetCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // top volume exercises (all sessions)
  const exVolMap = {};
  allSessions.forEach(s => {
    (s.workout_exercises ?? []).forEach(ex => {
      const name = ex.exercise_name ?? '';
      if (!name) return;
      const vol = (ex.sets ?? []).reduce((sv, st) => sv + (st.weight_kg ?? 0) * (st.reps ?? 0), 0);
      exVolMap[name] = (exVolMap[name] ?? 0) + vol;
    });
  });
  const topVolumeExercises = Object.entries(exVolMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, totalKg]) => ({ name, totalKg: Math.round(totalKg) }));

  // steps
  const totalSteps = stepsArr.reduce((s, r) => s + (r.steps ?? 0), 0);
  const stepGoalHitRate = stepsArr.length === 0 ? 0
    : Math.round(stepsArr.filter(r => (r.steps ?? 0) >= (r.goal > 0 ? r.goal : 8000)).length / stepsArr.length * 100);

  // sleep
  const sleepHours = sleepArr2.map(r => r.hours).filter(h => h > 0);
  const avgSleep   = sleepHours.length ? +(sleepHours.reduce((a, b) => a + b, 0) / sleepHours.length).toFixed(1) : null;
  const sleepDays  = sleepHours.length;

  // monthly avg sleep
  const monthlyAvgSleep = MONTHS_SHORT.map((label, mi) => {
    const mo = mi + 1;
    const mSleep = sleepArr2.filter(r => new Date(r.logged_at).getMonth() + 1 === mo).map(r => r.hours).filter(h => h > 0);
    return { label, avg: mSleep.length ? +(mSleep.reduce((a, b) => a + b, 0) / mSleep.length).toFixed(1) : null };
  });

  // weight
  const weightDelta = weightArr.length >= 2
    ? +(weightArr[weightArr.length - 1].weight - weightArr[0].weight).toFixed(1) : null;
  const bodyTransform = weightArr.length >= 2
    ? { startWeight: weightArr[0].weight, endWeight: weightArr[weightArr.length - 1].weight, delta: weightDelta }
    : null;

  // streak (gym days)
  const gymDays = gymSessions.map(s => s.date).sort();
  const bestStreak = gymDays.length > 0 ? streakFromDays(gymDays) : 0;

  // monthly
  const monthly = MONTHS_SHORT.map((label, mi) => {
    const mo = mi + 1;
    const mSessions = gymSessions.filter(s => new Date(s.date + 'T00:00:00').getMonth() + 1 === mo);
    const mSteps    = stepsArr.filter(r => new Date(r.logged_at).getMonth() + 1 === mo);
    const mSleep    = sleepArr2.filter(r => new Date(r.logged_at).getMonth() + 1 === mo);
    return {
      label,
      workouts: mSessions.length,
      steps: mSteps.reduce((s, r) => s + (r.steps ?? 0), 0),
      sleep: mSleep.length ? +(mSleep.reduce((s, r) => s + r.hours, 0) / mSleep.length).toFixed(1) : null,
    };
  });

  // consistency score
  const today = new Date();
  const yearEndDate = new Date(`${year}-12-31T23:59:59`);
  const capDate = today < yearEndDate ? today : yearEndDate;
  const daysSoFar = Math.ceil((capDate - new Date(`${year}-01-01T00:00:00`)) / 86400000);
  const activeDates = new Set([
    ...allSessions.map(s => s.date),
    ...stepsArr.map(r => r.logged_at.slice(0, 10)),
    ...sleepArr2.map(r => r.logged_at.slice(0, 10)),
  ]);
  const consistencyScore = daysSoFar > 0 ? Math.round(activeDates.size / daysSoFar * 100) : 0;

  // nutrition
  const nutritionDates = new Set(foodArr.map(r => r.logged_at.slice(0, 10)));
  const nutritionDays  = nutritionDates.size;
  const avgCalories    = foodArr.length ? Math.round(foodArr.reduce((s, r) => s + (r.calories ?? 0), 0) / nutritionDays) : 0;
  const avgProtein     = foodArr.length ? Math.round(foodArr.reduce((s, r) => s + (r.protein ?? 0), 0) / nutritionDays) : 0;

  // mood
  const moodDays   = moodArr.length;
  const avgMood    = moodDays ? +(moodArr.reduce((s, r) => s + (r.mood ?? 0), 0) / moodDays).toFixed(1) : null;
  const avgEnergy  = moodDays ? +(moodArr.reduce((s, r) => s + (r.energy ?? 0), 0) / moodDays).toFixed(1) : null;
  // best mood month
  const moodByMonth = MONTHS_SHORT.map((label, mi) => {
    const mo = mi + 1;
    const mm = moodArr.filter(r => new Date(r.date).getMonth() + 1 === mo);
    return { label, avg: mm.length ? mm.reduce((s, r) => s + (r.mood ?? 0), 0) / mm.length : null };
  });
  const bestMoodMonth = moodByMonth.filter(m => m.avg !== null).sort((a, b) => b.avg - a.avg)[0]?.label ?? null;

  // prev year
  const prevGym        = (prevSessions.data ?? []).filter(s => classifySession(s.notes) === 'gym');
  const prevStepsArr   = prevSteps.data ?? [];
  const prevSleepArr   = prevSleep.data ?? [];
  const prevWeightArr  = prevWeight.data ?? [];
  const prevTotalSteps = prevStepsArr.reduce((s, r) => s + (r.steps ?? 0), 0);
  const prevSleepH     = prevSleepArr.map(r => r.hours).filter(h => h > 0);
  const prevAvgSleep   = prevSleepH.length ? +(prevSleepH.reduce((a, b) => a + b, 0) / prevSleepH.length).toFixed(1) : null;
  const prevGymDays    = prevGym.map(s => s.date).sort();
  const prevBestStreak = prevGymDays.length > 0 ? streakFromDays(prevGymDays) : 0;
  const prevWeightDelta = prevWeightArr.length >= 2
    ? +(prevWeightArr[prevWeightArr.length - 1].weight - prevWeightArr[0].weight).toFixed(1) : null;

  const prevYear = {
    totalWorkouts: prevGym.length,
    totalSteps: prevTotalSteps,
    avgSleep: prevAvgSleep,
    bestStreak: prevBestStreak,
    weightDelta: prevWeightDelta,
  };

  // achievements
  const ACHIEVEMENT_DEFS = [
    { emoji: '🏋️', label: 'First Step',        desc: 'Logged your first workout',        check: () => totalWorkouts >= 1 },
    { emoji: '💪', label: 'Getting Started',   desc: 'Completed 10 workouts',             check: () => totalWorkouts >= 10 },
    { emoji: '🔥', label: 'On Fire',           desc: 'Completed 50 workouts',             check: () => totalWorkouts >= 50 },
    { emoji: '💯', label: 'Century Club',      desc: 'Completed 100 workouts',            check: () => totalWorkouts >= 100 },
    { emoji: '📅', label: 'Week Streak',       desc: '7-day workout streak',              check: () => bestStreak >= 7 },
    { emoji: '🌟', label: 'Month Streak',      desc: '30-day workout streak',             check: () => bestStreak >= 30 },
    { emoji: '👟', label: 'Step Millionaire',  desc: 'Walked 1,000,000+ steps',           check: () => totalSteps >= 1000000 },
    { emoji: '🏆', label: 'PR Chaser',         desc: 'Set at least one PR',               check: () => topPRs.length > 0 },
    { emoji: '📉', label: 'Lighter & Stronger',desc: 'Lost more than 1kg this year',      check: () => weightDelta != null && weightDelta < -1 },
    { emoji: '✅', label: 'Consistency King',  desc: '80%+ activity consistency',         check: () => consistencyScore >= 80 },
    { emoji: '😴', label: 'Sleep Tracker',     desc: 'Tracked sleep 30+ days',            check: () => sleepDays >= 30 },
    { emoji: '🥗', label: 'Food Logger',       desc: 'Logged food on 30+ days',           check: () => nutritionDays >= 30 },
    { emoji: '😊', label: 'Mind Tracker',      desc: 'Logged mood on 30+ days',           check: () => moodDays >= 30 },
    { emoji: '⚡', label: 'Volume Monster',    desc: 'Lifted 100,000+ kg total volume',   check: () => totalVolKg >= 100000 },
  ];
  const achievements = ACHIEVEMENT_DEFS.filter(a => a.check()).map(({ emoji, label, desc }) => ({ emoji, label, desc }));

  return {
    year,
    totalWorkouts,
    totalVolKg: Math.round(totalVolKg),
    totalSteps,
    avgSleep,
    weightDelta,
    topPRs,
    monthly,
    bestStreak,
    sleepDays,
    totalDurationHours,
    stepGoalHitRate,
    mostTrainedExercise,
    cardioCount,
    gymCount,
    restCount,
    bodyTransform,
    consistencyScore,
    nutritionDays,
    avgCalories,
    avgProtein,
    moodDays,
    avgMood,
    avgEnergy,
    bestMoodMonth,
    topVolumeExercises,
    monthlyAvgSleep,
    prevYear,
    achievements,
  };
}


function fmtVol(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}k`;
  return String(kg);
}

function moodEmoji(val) {
  if (val == null) return '';
  if (val >= 4.5) return '😄';
  if (val >= 3.5) return '🙂';
  if (val >= 2.5) return '😐';
  return '😔';
}

function energyEmoji(val) {
  if (val == null) return '';
  if (val >= 4.5) return '⚡';
  if (val >= 3.5) return '🔋';
  if (val >= 2.5) return '🌀';
  return '😴';
}

export default function YearInReviewScreen({ navigation }) {
  const { colors } = useTheme();
  const { user }   = useAuth();
  const { hasAccess } = useSubscription();
  const s = useMemo(() => styles(colors), [colors]);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [showPaywall, setShowPaywall]   = useState(false);
  const [volUnit, setVolUnit]           = useState('kg'); // 'kg' | 'lbs'

  const { data, isLoading } = useQuery({
    queryKey: ['year-in-review', user?.id, selectedYear],
    queryFn: () => fetchYearData(user?.id, selectedYear),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const canGoForward = selectedYear < currentYear;

  if (isLoading || !data) return (
    <SafeAreaView edges={['top']} style={s.safe}>
      <ScreenHeader title="Year in Review" onBack={() => navigation.goBack()} />
      <ActivityIndicator color={colors.accent} style={{ flex: 1 }} />
    </SafeAreaView>
  );

  const monthly        = data.monthly        ?? [];
  const monthlyAvgSleep = data.monthlyAvgSleep ?? [];
  const topPRs          = data.topPRs          ?? [];
  const topVolumeExercises = data.topVolumeExercises ?? [];
  const achievements    = data.achievements    ?? [];

  const maxWorkouts = Math.max(...monthly.map(m => m.workouts), 1);
  const maxSleepAvg = Math.max(...monthlyAvgSleep.map(m => m.avg ?? 0), 8);

  const totalActivity = data.gymCount + data.cardioCount + data.restCount;
  const prevYear = data.prevYear ?? {};

  // YoY comparison rows
  const yoyRows = [
    {
      label: 'Workouts',
      curr: data.totalWorkouts,
      prev: prevYear.totalWorkouts,
      fmt: v => String(v),
      higherIsBetter: true,
    },
    {
      label: 'Steps',
      curr: data.totalSteps,
      prev: prevYear.totalSteps,
      fmt: v => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v),
      higherIsBetter: true,
    },
    {
      label: 'Avg Sleep',
      curr: data.avgSleep,
      prev: prevYear.avgSleep,
      fmt: v => v != null ? `${v}h` : '—',
      higherIsBetter: true,
    },
    {
      label: 'Best Streak',
      curr: data.bestStreak,
      prev: prevYear.bestStreak,
      fmt: v => `${v}d`,
      higherIsBetter: true,
    },
    {
      label: 'Weight Δ',
      curr: data.weightDelta,
      prev: prevYear.weightDelta,
      fmt: v => v != null ? `${v > 0 ? '+' : ''}${v}kg` : '—',
      higherIsBetter: false,
    },
  ];

  // highlight best month per column in monthly table
  const bestWorkoutMonth = monthly.reduce((bi, m, i) => m.workouts > (monthly[bi]?.workouts ?? 0) ? i : bi, 0);
  const bestStepsMonth   = monthly.reduce((bi, m, i) => (m.steps ?? 0) > (monthly[bi]?.steps ?? 0) ? i : bi, 0);
  const bestSleepMonth   = monthly.reduce((bi, m, i) => {
    const curr = m.sleep ?? -1;
    const best = monthly[bi]?.sleep ?? -1;
    return curr > best ? i : bi;
  }, 0);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Year in Review" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll}>

        {/* ── 1. Year picker ── */}
        <View style={s.yearPicker}>
          <TouchableOpacity
            style={s.yearArrow}
            onPress={() => setSelectedYear(y => y - 1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={s.yearCenter}>
            <Text style={s.yearText}>{selectedYear}</Text>
            {selectedYear === currentYear && (
              <View style={s.currentBadge}>
                <Text style={s.currentBadgeText}>THIS YEAR</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[s.yearArrow, !canGoForward && s.yearArrowDisabled]}
            onPress={() => canGoForward && setSelectedYear(y => y + 1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={!canGoForward}
          >
            <Ionicons name="chevron-forward" size={20} color={canGoForward ? colors.text : colors.textDim} />
          </TouchableOpacity>
        </View>

        {/* ── 2. Stats grid ── */}
        <View style={s.statsGrid}>
          {[
            { emoji: '🏋️', val: String(data.totalWorkouts), label: 'WORKOUTS',     color: colors.accent,  border: colors.accent + '40' },
            { emoji: '⚖️',  val: data.totalVolKg >= 1000 ? `${(data.totalVolKg/1000).toFixed(1)}t` : `${data.totalVolKg}kg`, label: 'TOTAL LIFTED', color: '#fb7185', border: '#fb718540' },
            { emoji: '👟', val: data.totalSteps >= 1000000 ? `${(data.totalSteps/1000000).toFixed(1)}M` : data.totalSteps >= 1000 ? `${(data.totalSteps/1000).toFixed(0)}k` : String(data.totalSteps), label: 'TOTAL STEPS', color: '#fbbf24', border: '#fbbf2440' },
            { emoji: '😴', val: data.avgSleep ? `${data.avgSleep}h` : '—',         label: 'AVG SLEEP',    color: '#c4b5fd', border: '#c4b5fd40' },
            { emoji: '🔥', val: String(data.bestStreak),                             label: 'BEST STREAK',  color: '#34d399', border: '#34d39940' },
            { emoji: data.weightDelta != null ? (data.weightDelta <= 0 ? '📉' : '📈') : '⚖️', val: data.weightDelta != null ? `${data.weightDelta > 0 ? '+' : ''}${data.weightDelta}kg` : '—', label: 'WEIGHT CHANGE', color: colors.text, border: colors.border },
          ].map((item, i) => (
            <View key={i} style={[s.statCard, { borderColor: item.border }]}>
              <Text style={s.statEmoji}>{item.emoji}</Text>
              <View style={s.statBody}>
                <Text style={[s.statVal, { color: item.color }]}>{item.val}</Text>
                <Text style={s.statLabel}>{item.label}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── 3. Quick wins row (FREE) ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>QUICK WINS</Text>
          <View style={s.quickWinsRow}>
            <View style={s.quickWinTile}>
              <Text style={s.quickWinEmoji}>⏱️</Text>
              <Text style={[s.quickWinVal, { color: colors.accent }]}>{data.totalDurationHours}</Text>
              <Text style={s.quickWinLabel}>WORKOUT HOURS</Text>
            </View>
            <View style={[s.quickWinTile, s.quickWinTileBorder]}>
              <Text style={s.quickWinEmoji}>🎯</Text>
              <Text style={[s.quickWinVal, { color: '#fbbf24' }]}>{data.stepGoalHitRate}%</Text>
              <Text style={s.quickWinLabel}>STEP GOAL RATE</Text>
            </View>
            <View style={s.quickWinTile}>
              <Text style={s.quickWinEmoji}>🏅</Text>
              <Text style={[s.quickWinVal, { color: '#c4b5fd', fontSize: 13 }]} numberOfLines={1}>
                {data.mostTrainedExercise ? data.mostTrainedExercise.slice(0, 12) : '—'}
              </Text>
              <Text style={s.quickWinLabel}>MOST TRAINED</Text>
            </View>
          </View>
        </View>

        {/* ── 4. Monthly workouts bar chart ── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>WORKOUTS PER MONTH</Text>
          <View style={s.barChart}>
            {monthly.map((m, i) => {
              const pct = maxWorkouts > 0 ? m.workouts / maxWorkouts : 0;
              return (
                <View key={i} style={s.barCol}>
                  <Text style={s.barVal}>{m.workouts > 0 ? m.workouts : ''}</Text>
                  <View style={s.barTrack}>
                    <View style={[s.barFill, {
                      height: `${Math.max(pct * 100, m.workouts > 0 ? 8 : 0)}%`,
                      backgroundColor: m.workouts > 0 ? colors.accent : colors.border,
                    }]} />
                  </View>
                  <Text style={s.barLabel}>{m.label.slice(0, 1)}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ── Best Lifts (FREE) ── */}
        {topPRs.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>BEST LIFTS · {selectedYear}</Text>
            {data.topPRs.map((pr, i) => (
              <View key={i} style={[s.prRow, i < data.topPRs.length - 1 && s.prRowBorder]}>
                <Text style={s.prRank}>#{i + 1}</Text>
                <Text style={s.prName} numberOfLines={1}>{pr.name}</Text>
                <Text style={[s.prKg, { color: colors.accent }]}>{pr.kg} kg</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Body transformation (FREE) ── */}
        {data.bodyTransform && (
          <View style={s.card}>
            <Text style={s.cardTitle}>BODY TRANSFORMATION</Text>
            <Text style={[s.cardSubtitle]}>From Jan to Dec</Text>
            <View style={s.transformRow}>
              <View style={s.transformSide}>
                <Text style={s.transformLabel}>START</Text>
                <Text style={[s.transformVal, { color: colors.textDim }]}>{data.bodyTransform.startWeight} kg</Text>
              </View>
              <Text style={{ fontSize: 28 }}>
                {data.bodyTransform.delta < 0 ? '📉' : data.bodyTransform.delta > 0 ? '📈' : '➡️'}
              </Text>
              <View style={s.transformSide}>
                <Text style={s.transformLabel}>END</Text>
                <Text style={[s.transformVal, { color: colors.text }]}>{data.bodyTransform.endWeight} kg</Text>
              </View>
            </View>
            <Text style={[s.transformDelta, {
              color: data.bodyTransform.delta < 0 ? '#34d399' : data.bodyTransform.delta > 0 ? '#fb7185' : colors.textDim,
            }]}>
              {data.bodyTransform.delta > 0 ? '+' : ''}{data.bodyTransform.delta} kg change
            </Text>
          </View>
        )}

        {/* ── Year-over-year comparison (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>YEAR-OVER-YEAR COMPARISON</Text>
          </View>
          <View style={[s.yoyRow, { backgroundColor: colors.dim ?? colors.border }]}>
            <Text style={[s.yoyCell, s.yoyLabelCol, { color: colors.textDim, fontFamily: fontFamily.bodyBold }]}>Metric</Text>
            <Text style={[s.yoyCell, s.yoyValCol, { color: colors.accent, fontFamily: fontFamily.bodyBold, textAlign: 'center' }]}>{selectedYear}</Text>
            <Text style={[s.yoyCell, s.yoyValCol, { color: colors.textDim, fontFamily: fontFamily.bodyBold, textAlign: 'center' }]}>{selectedYear - 1}</Text>
            <Text style={[s.yoyCell, { width: 28 }]}> </Text>
          </View>
          {hasAccess ? (
            yoyRows.map((row, i) => {
              const currVal = row.curr ?? 0;
              const prevVal = row.prev ?? 0;
              let arrow = null;
              if (row.curr != null && row.prev != null) {
                const improved = row.higherIsBetter ? currVal > prevVal : currVal < prevVal;
                const same = currVal === prevVal;
                arrow = same ? null : improved ? { icon: 'arrow-up', color: '#34d399' } : { icon: 'arrow-down', color: '#fb7185' };
              }
              return (
                <View key={i} style={[s.yoyRow, i % 2 === 0 && { backgroundColor: colors.bg + '60' }]}>
                  <Text style={[s.yoyCell, s.yoyLabelCol, { color: colors.textDim, fontFamily: fontFamily.body }]}>{row.label}</Text>
                  <Text style={[s.yoyCell, s.yoyValCol, { color: colors.text, fontFamily: fontFamily.monoBold, textAlign: 'center' }]}>{row.fmt(row.curr)}</Text>
                  <Text style={[s.yoyCell, s.yoyValCol, { color: colors.textDim, fontFamily: fontFamily.mono, textAlign: 'center' }]}>{row.fmt(row.prev)}</Text>
                  <View style={[s.yoyCell, { width: 28, alignItems: 'center' }]}>
                    {arrow && <Ionicons name={arrow.icon} size={14} color={arrow.color} />}
                  </View>
                </View>
              );
            })
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
              {[0,1,2].map(i => (
                <View key={i} style={[s.yoyRow, i % 2 === 0 && { backgroundColor: colors.bg + '60' }]}>
                  <View style={[s.yoyCell, s.yoyLabelCol, { height: 12, borderRadius: 6, backgroundColor: colors.border, marginVertical: 4 }]} />
                  <Text style={[s.yoyCell, s.yoyValCol, { color: colors.textDim, fontFamily: fontFamily.mono, textAlign: 'center' }]}>●●</Text>
                  <Text style={[s.yoyCell, s.yoyValCol, { color: colors.textDim, fontFamily: fontFamily.mono, textAlign: 'center' }]}>●●</Text>
                  <View style={[s.yoyCell, { width: 28 }]} />
                </View>
              ))}
              <Text style={[s.emptyText, { paddingTop: 10, paddingBottom: 0 }]}>🔒 Unlock year-over-year comparison with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Monthly breakdown table (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>MONTHLY BREAKDOWN</Text>
          </View>
          <View style={[s.tableRow, { backgroundColor: colors.dim ?? colors.border }]}>
            <Text style={[s.tableCell, s.tableMonthCol, { color: colors.textDim, fontFamily: fontFamily.bodyBold }]}>Month</Text>
            <Text style={[s.tableCell, s.tableNumCol, { color: colors.accent, fontFamily: fontFamily.bodyBold }]}>Workouts</Text>
            <Text style={[s.tableCell, s.tableNumCol, { color: '#fbbf24', fontFamily: fontFamily.bodyBold }]}>Steps(k)</Text>
            <Text style={[s.tableCell, s.tableNumCol, { color: '#c4b5fd', fontFamily: fontFamily.bodyBold }]}>Sleep(h)</Text>
          </View>
          {hasAccess ? (
            monthly.map((m, i) => (
              <View key={i} style={[s.tableRow, i % 2 === 0 && { backgroundColor: colors.bg + '40' }]}>
                <Text style={[s.tableCell, s.tableMonthCol, { color: colors.textDim, fontFamily: fontFamily.body }]}>{m.label}</Text>
                <Text style={[s.tableCell, s.tableNumCol, {
                  color: i === bestWorkoutMonth && m.workouts > 0 ? colors.accent : colors.text,
                  fontFamily: i === bestWorkoutMonth && m.workouts > 0 ? fontFamily.monoBold : fontFamily.mono,
                }]}>{m.workouts}</Text>
                <Text style={[s.tableCell, s.tableNumCol, {
                  color: i === bestStepsMonth && m.steps > 0 ? '#fbbf24' : colors.text,
                  fontFamily: i === bestStepsMonth && m.steps > 0 ? fontFamily.monoBold : fontFamily.mono,
                }]}>{m.steps > 0 ? (m.steps / 1000).toFixed(1) : '—'}</Text>
                <Text style={[s.tableCell, s.tableNumCol, {
                  color: i === bestSleepMonth && m.sleep != null ? '#c4b5fd' : colors.text,
                  fontFamily: i === bestSleepMonth && m.sleep != null ? fontFamily.monoBold : fontFamily.mono,
                }]}>{m.sleep != null ? m.sleep : '—'}</Text>
              </View>
            ))
          ) : (
            <>
              {monthly.slice(0, 2).map((m, i) => (
                <View key={i} style={[s.tableRow, i % 2 === 0 && { backgroundColor: colors.bg + '40' }]}>
                  <Text style={[s.tableCell, s.tableMonthCol, { color: colors.textDim, fontFamily: fontFamily.body }]}>{m.label}</Text>
                  <Text style={[s.tableCell, s.tableNumCol, { color: colors.text, fontFamily: fontFamily.mono }]}>{m.workouts}</Text>
                  <Text style={[s.tableCell, s.tableNumCol, { color: colors.text, fontFamily: fontFamily.mono }]}>{m.steps > 0 ? (m.steps / 1000).toFixed(1) : '—'}</Text>
                  <Text style={[s.tableCell, s.tableNumCol, { color: colors.text, fontFamily: fontFamily.mono }]}>{m.sleep != null ? m.sleep : '—'}</Text>
                </View>
              ))}
              <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
                {[2,3,4].map(i => (
                  <View key={i} style={[s.tableRow, i % 2 === 0 && { backgroundColor: colors.bg + '40' }]}>
                    <Text style={[s.tableCell, s.tableMonthCol, { color: colors.textDim, fontFamily: fontFamily.body }]}>{MONTHS_SHORT[i]}</Text>
                    <Text style={[s.tableCell, s.tableNumCol, { color: colors.textDim, fontFamily: fontFamily.mono }]}>●●</Text>
                    <Text style={[s.tableCell, s.tableNumCol, { color: colors.textDim, fontFamily: fontFamily.mono }]}>●.●</Text>
                    <Text style={[s.tableCell, s.tableNumCol, { color: colors.textDim, fontFamily: fontFamily.mono }]}>●.●</Text>
                  </View>
                ))}
                <Text style={[s.emptyText, { paddingTop: 10, paddingBottom: 0 }]}>🔒 Unlock full monthly breakdown with Pro.</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── 7. Activity split (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>ACTIVITY SPLIT</Text>
          </View>
          {hasAccess ? (
            totalActivity > 0 ? (
              <>
                <View style={s.activityBar}>
                  {data.gymCount > 0 && (
                    <View style={[s.activitySegment, {
                      flex: data.gymCount,
                      backgroundColor: colors.accent,
                      borderTopLeftRadius: 6,
                      borderBottomLeftRadius: 6,
                    }]} />
                  )}
                  {data.cardioCount > 0 && (
                    <View style={[s.activitySegment, {
                      flex: data.cardioCount,
                      backgroundColor: '#fb7185',
                    }]} />
                  )}
                  {data.restCount > 0 && (
                    <View style={[s.activitySegment, {
                      flex: data.restCount,
                      backgroundColor: colors.textDim + '60',
                      borderTopRightRadius: 6,
                      borderBottomRightRadius: 6,
                    }]} />
                  )}
                </View>
                <View style={s.activityLegend}>
                  {[
                    { color: colors.accent,         label: 'Gym',    count: data.gymCount },
                    { color: '#fb7185',              label: 'Cardio', count: data.cardioCount },
                    { color: colors.textDim + '60',  label: 'Rest',   count: data.restCount },
                  ].filter(l => l.count > 0).map((l, i) => (
                    <View key={i} style={s.legendItem}>
                      <View style={[s.legendDot, { backgroundColor: l.color }]} />
                      <Text style={s.legendText}>{l.label} · {l.count}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={s.emptyText}>No sessions logged</Text>
            )
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
              <View style={s.activityBar}>
                <View style={[s.activitySegment, { flex: 3, backgroundColor: colors.border, borderTopLeftRadius: 6, borderBottomLeftRadius: 6 }]} />
                <View style={[s.activitySegment, { flex: 2, backgroundColor: colors.border + '80' }]} />
                <View style={[s.activitySegment, { flex: 5, backgroundColor: colors.border + '40', borderTopRightRadius: 6, borderBottomRightRadius: 6 }]} />
              </View>
              <View style={s.activityLegend}>
                {['Gym · ●●', 'Cardio · ●●', 'Rest · ●●'].map((label, i) => (
                  <View key={i} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: colors.border }]} />
                    <Text style={[s.legendText, { color: colors.textDim }]}>{label}</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock activity split with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 9. Nutrition summary (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>NUTRITION SUMMARY</Text>
          </View>
          {hasAccess ? (
            data.nutritionDays > 0 ? (
              <View style={s.quickWinsRow}>
                <View style={s.quickWinTile}>
                  <Text style={s.quickWinEmoji}>🔥</Text>
                  <Text style={[s.quickWinVal, { color: '#fb7185' }]}>{data.avgCalories}</Text>
                  <Text style={s.quickWinLabel}>KCAL/DAY</Text>
                </View>
                <View style={[s.quickWinTile, s.quickWinTileBorder]}>
                  <Text style={s.quickWinEmoji}>🥩</Text>
                  <Text style={[s.quickWinVal, { color: colors.accent }]}>{data.avgProtein}g</Text>
                  <Text style={s.quickWinLabel}>PROTEIN/DAY</Text>
                </View>
                <View style={s.quickWinTile}>
                  <Text style={s.quickWinEmoji}>📅</Text>
                  <Text style={[s.quickWinVal, { color: '#fbbf24' }]}>{data.nutritionDays}</Text>
                  <Text style={s.quickWinLabel}>DAYS TRACKED</Text>
                </View>
              </View>
            ) : (
              <Text style={s.emptyText}>No food logged in {selectedYear} — start logging meals to see your nutrition summary.</Text>
            )
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
              <View style={s.quickWinsRow}>
                <View style={s.quickWinTile}>
                  <Text style={s.quickWinEmoji}>🔥</Text>
                  <Text style={[s.quickWinVal, { color: colors.textDim }]}>●●●</Text>
                  <Text style={s.quickWinLabel}>KCAL/DAY</Text>
                </View>
                <View style={[s.quickWinTile, s.quickWinTileBorder]}>
                  <Text style={s.quickWinEmoji}>🥩</Text>
                  <Text style={[s.quickWinVal, { color: colors.textDim }]}>●●g</Text>
                  <Text style={s.quickWinLabel}>PROTEIN/DAY</Text>
                </View>
                <View style={s.quickWinTile}>
                  <Text style={s.quickWinEmoji}>📅</Text>
                  <Text style={[s.quickWinVal, { color: colors.textDim }]}>●●</Text>
                  <Text style={s.quickWinLabel}>DAYS TRACKED</Text>
                </View>
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock nutrition summary with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 10. Top 5 exercises by volume (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>TOP EXERCISES BY VOLUME</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {/* kg / lbs toggle */}
              <View style={{ flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                {['kg', 'lbs'].map(u => (
                  <TouchableOpacity key={u} onPress={() => setVolUnit(u)}
                    style={{ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: volUnit === u ? colors.accent : 'transparent' }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: volUnit === u ? '#000' : colors.textMuted }}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          {hasAccess ? (
            topVolumeExercises.length > 0 ? (
              topVolumeExercises.map((ex, i) => {
                const display = volUnit === 'lbs' ? Math.round(ex.totalKg * 2.20462) : ex.totalKg;
                return (
                  <View key={i} style={[s.prRow, i < topVolumeExercises.length - 1 && s.prRowBorder]}>
                    <Text style={s.prRank}>#{i + 1}</Text>
                    <Text style={[s.prName, i === 0 && { color: colors.accent }]} numberOfLines={1}>{ex.name}</Text>
                    <Text style={[s.prKg, { color: i === 0 ? colors.accent : colors.text }]}>{fmtVol(display)} {volUnit}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={s.emptyText}>No exercises logged</Text>
            )
          ) : (
            <>
              {topVolumeExercises.slice(0, 2).map((ex, i) => {
                const display = volUnit === 'lbs' ? Math.round(ex.totalKg * 2.20462) : ex.totalKg;
                return (
                  <View key={i} style={[s.prRow, s.prRowBorder]}>
                    <Text style={s.prRank}>#{i + 1}</Text>
                    <Text style={[s.prName, i === 0 && { color: colors.accent }]} numberOfLines={1}>{ex.name}</Text>
                    <Text style={[s.prKg, { color: i === 0 ? colors.accent : colors.text }]}>{fmtVol(display)} {volUnit}</Text>
                  </View>
                );
              })}
              <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
                {[3,4,5].map(i => (
                  <View key={i} style={[s.prRow, i < 5 && s.prRowBorder]}>
                    <Text style={s.prRank}>#{i}</Text>
                    <View style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.border, marginHorizontal: 8, marginVertical: 2 }} />
                    <Text style={[s.prKg, { color: colors.textDim }]}>●●● kg</Text>
                  </View>
                ))}
                <Text style={[s.emptyText, { paddingTop: 10, paddingBottom: 0 }]}>🔒 Unlock top exercises by volume with Pro.</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ── 11. Sleep quality trend (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>SLEEP TREND</Text>
          </View>
          {hasAccess ? (
            data.sleepDays > 0 ? (
              <>
                <View style={[s.barChart, { height: 90 }]}>
                  {monthlyAvgSleep.map((m, i) => {
                    const pct = m.avg != null ? (m.avg / Math.max(maxSleepAvg, 9)) : 0;
                    const lineH = (7 / Math.max(maxSleepAvg, 9)) * 100;
                    return (
                      <View key={i} style={s.barCol}>
                        <View style={s.barTrack}>
                          <View style={[s.barFill, {
                            height: `${Math.max(pct * 100, m.avg != null ? 4 : 0)}%`,
                            backgroundColor: m.avg != null ? '#c4b5fd' : colors.border,
                          }]} />
                          <View style={{
                            position: 'absolute',
                            bottom: `${lineH}%`,
                            left: 0, right: 0,
                            height: 1,
                            backgroundColor: colors.accent + '60',
                          }} />
                        </View>
                        <Text style={s.barLabel}>{m.label.slice(0, 1)}</Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={[s.cardSubtitle, { color: colors.accent + '80' }]}>— 7h target line</Text>
              </>
            ) : (
              <Text style={s.emptyText}>No sleep data logged</Text>
            )
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
              <View style={[s.barChart, { height: 90 }]}>
                {['J','F','M','A','M','J','J','A','S','O','N','D'].map((label, i) => (
                  <View key={i} style={s.barCol}>
                    <View style={s.barTrack}>
                      <View style={[s.barFill, {
                        height: `${[55, 70, 60, 75, 50, 65, 80, 55, 70, 60, 75, 65][i]}%`,
                        backgroundColor: colors.border,
                      }]} />
                    </View>
                    <Text style={s.barLabel}>{label}</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock sleep trend with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 12. Mood year summary (PRO) ── */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>MOOD YEAR SUMMARY</Text>
          </View>
          {hasAccess ? (
            data.moodDays > 0 ? (
              <>
                <View style={s.moodRow}>
                  <View style={s.moodTile}>
                    <Text style={s.moodEmoji}>{moodEmoji(data.avgMood)}</Text>
                    <Text style={[s.quickWinVal, { color: colors.text }]}>{data.avgMood ?? '—'}</Text>
                    <Text style={s.quickWinLabel}>AVG MOOD</Text>
                  </View>
                  <View style={s.moodTile}>
                    <Text style={s.moodEmoji}>{energyEmoji(data.avgEnergy)}</Text>
                    <Text style={[s.quickWinVal, { color: '#fbbf24' }]}>{data.avgEnergy ?? '—'}</Text>
                    <Text style={s.quickWinLabel}>AVG ENERGY</Text>
                  </View>
                  <View style={s.moodTile}>
                    <Text style={s.moodEmoji}>📅</Text>
                    <Text style={[s.quickWinVal, { color: '#c4b5fd' }]}>{data.moodDays}</Text>
                    <Text style={s.quickWinLabel}>DAYS LOGGED</Text>
                  </View>
                </View>
                {data.bestMoodMonth && (
                  <Text style={[s.cardSubtitle, { color: colors.textDim }]}>
                    Best month: <Text style={{ color: colors.text }}>{data.bestMoodMonth}</Text>
                  </Text>
                )}
              </>
            ) : (
              <Text style={s.emptyText}>No mood logs in {selectedYear} — log your mood daily to see your year summary.</Text>
            )
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
              <View style={s.moodRow}>
                <View style={s.moodTile}>
                  <Text style={s.moodEmoji}>😐</Text>
                  <Text style={[s.quickWinVal, { color: colors.textDim }]}>●.●</Text>
                  <Text style={s.quickWinLabel}>AVG MOOD</Text>
                </View>
                <View style={s.moodTile}>
                  <Text style={s.moodEmoji}>⚡</Text>
                  <Text style={[s.quickWinVal, { color: colors.textDim }]}>●.●</Text>
                  <Text style={s.quickWinLabel}>AVG ENERGY</Text>
                </View>
                <View style={s.moodTile}>
                  <Text style={s.moodEmoji}>📅</Text>
                  <Text style={[s.quickWinVal, { color: colors.textDim }]}>●●</Text>
                  <Text style={s.quickWinLabel}>DAYS LOGGED</Text>
                </View>
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock mood year summary with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 13. Achievements (PRO) ── */}
        <View style={s.card}>
          <View style={s.achieveHeader}>
            <Text style={s.cardTitle}>ACHIEVEMENTS</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {hasAccess && <Text style={[s.achieveCount, { color: colors.textDim }]}>{achievements.length} / 14 unlocked</Text>}
            </View>
          </View>
          {hasAccess ? (
            achievements.length === 0 ? (
              <View style={s.emptyBox}>
                <Text style={s.emptyIcon}>🎯</Text>
                <Text style={[s.emptyText, { textAlign: 'center' }]}>Keep going — your achievements are waiting!</Text>
              </View>
            ) : (
              <View style={s.achieveGrid}>
                {achievements.map((a, i) => (
                  <View key={i} style={[s.achieveChip, { backgroundColor: colors.dim ?? colors.border + '80' }]}>
                    <Text style={s.achieveChipEmoji}>{a.emoji}</Text>
                    <Text style={[s.achieveChipLabel, { color: colors.accent }]} numberOfLines={1}>{a.label}</Text>
                  </View>
                ))}
              </View>
            )
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
              <View style={s.achieveGrid}>
                {['🏋️','🔥','📅','⭐','💪','🌍'].map((emoji, i) => (
                  <View key={i} style={[s.achieveChip, { backgroundColor: colors.dim ?? colors.border + '80' }]}>
                    <Text style={s.achieveChipEmoji}>{emoji}</Text>
                    <View style={{ height: 9, borderRadius: 5, backgroundColor: colors.border, width: 60 }} />
                  </View>
                ))}
              </View>
              <Text style={[s.emptyText, { paddingTop: 10, paddingBottom: 0, textAlign: 'center' }]}>🔒 Unlock achievements with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── 15. Fun fact (FREE) ── */}
        {data.totalSteps > 0 && (
          <View style={s.funFact}>
            <Text style={s.funFactEmoji}>🌍</Text>
            <Text style={s.funFactText}>
              {`${data.totalSteps.toLocaleString()} steps ≈ ${(data.totalSteps * 0.762 / 1000).toFixed(0)} km walked in ${selectedYear}`}
            </Text>
          </View>
        )}

        {/* ── 16. Empty state ── */}
        {data.totalWorkouts === 0 && (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>🗓️</Text>
            <Text style={s.emptyText}>No workout data found for {selectedYear}</Text>
          </View>
        )}

      </ScrollView>

      {showPaywall && (
        <PaywallModal
          visible={showPaywall}
          onClose={() => setShowPaywall(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = (colors) => StyleSheet.create({
  safe:               { flex: 1, backgroundColor: colors.bg },
  scroll:             { padding: 10, paddingBottom: 40, gap: 8 },

  // year picker
  yearPicker:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10 },
  yearArrow:          { padding: 4 },
  yearArrowDisabled:  { opacity: 0.3 },
  yearCenter:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yearText:           { fontSize: 22, fontFamily: fontFamily.monoBold, color: colors.text },
  currentBadge:       { backgroundColor: colors.accent + '20', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  currentBadgeText:   { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1 },

  // stats grid
  statsGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard:           { width: '48%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1.5, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statEmoji:          { fontSize: 22 },
  statBody:           { flex: 1, gap: 2 },
  statVal:            { fontSize: 20, fontFamily: fontFamily.monoBold },
  statLabel:          { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.8 },

  // card
  card:               { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, gap: 8 },
  cardTitle:          { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },
  cardSubtitle:       { fontSize: 10, fontFamily: fontFamily.body, color: colors.textDim },

  // quick wins
  quickWinsRow:       { flexDirection: 'row' },
  quickWinTile:       { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  quickWinTileBorder: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border },
  quickWinEmoji:      { fontSize: 20 },
  quickWinVal:        { fontSize: 17, fontFamily: fontFamily.monoBold },
  quickWinLabel:      { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.7, textAlign: 'center' },

  // bar chart
  barChart:           { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4 },
  barCol:             { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 2 },
  barVal:             { fontSize: 8, fontFamily: fontFamily.mono, color: colors.textDim, height: 12 },
  barTrack:           { flex: 1, width: '80%', backgroundColor: colors.border, borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill:            { width: '100%', borderRadius: 3 },
  barLabel:           { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textMuted },

  // year over year
  yoyRow:             { flexDirection: 'row', alignItems: 'center', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 6 },
  yoyCell:            { fontSize: 12 },
  yoyLabelCol:        { flex: 1 },
  yoyValCol:          { width: 72 },

  // monthly table
  tableRow:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 4, borderRadius: 6 },
  tableCell:          { fontSize: 11 },
  tableMonthCol:      { flex: 1 },
  tableNumCol:        { flex: 2, textAlign: 'center' },

  // activity split
  activityBar:        { flexDirection: 'row', height: 18, borderRadius: 6, overflow: 'hidden' },
  activitySegment:    { height: '100%' },
  activityLegend:     { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  legendItem:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:          { width: 8, height: 8, borderRadius: 4 },
  legendText:         { fontSize: 12, fontFamily: fontFamily.body, color: colors.textDim },

  // body transform
  transformRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  transformSide:      { alignItems: 'center', gap: 4 },
  transformLabel:     { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 1 },
  transformVal:       { fontSize: 22, fontFamily: fontFamily.monoBold },
  transformDelta:     { fontSize: 13, fontFamily: fontFamily.monoBold, textAlign: 'center' },

  // mood
  moodRow:            { flexDirection: 'row' },
  moodTile:           { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  moodEmoji:          { fontSize: 22 },

  // achievements
  achieveHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  achieveCount:       { fontSize: 11, fontFamily: fontFamily.body },
  achieveGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  achieveChip:        { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, gap: 5 },
  achieveChipEmoji:   { fontSize: 14 },
  achieveChipLabel:   { fontSize: 11, fontFamily: fontFamily.bodyBold },

  // PR rows
  prRow:              { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  prRowBorder:        { borderBottomWidth: 1, borderBottomColor: colors.border },
  prRank:             { fontSize: 12, fontFamily: fontFamily.mono, color: colors.textDim, width: 24 },
  prName:             { flex: 1, fontSize: 13, fontFamily: fontFamily.bodySemibold, color: colors.text },
  prKg:               { fontSize: 14, fontFamily: fontFamily.monoBold },

  // fun fact
  funFact:            { backgroundColor: colors.accent + '12', borderRadius: 14, borderWidth: 1, borderColor: colors.accent + '30', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  funFactEmoji:       { fontSize: 28 },
  funFactText:        { flex: 1, fontSize: 13, color: colors.text, fontFamily: fontFamily.body, lineHeight: 19 },

  // empty
  emptyBox:           { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyIcon:          { fontSize: 40 },
  emptyText:          { fontSize: 13, color: colors.textMuted, lineHeight: 20 },
});
