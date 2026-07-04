import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function fetchYearData(userId) {
  const now = new Date();
  const yearStart = `${now.getFullYear()}-01-01`;
  const yearEnd   = localDateStr(new Date(now.getFullYear(), 11, 31));

  const [sessions, steps, sleep, weight] = await Promise.all([
    supabase.from('workout_sessions')
      .select('id, date, notes, total_volume, workout_exercises(id, exercise_name, sets(id, weight_kg, reps, rpe))')
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
  ]);

  const gym = (sessions.data ?? []).filter(s => {
    if (!s.notes) return true;
    const n = s.notes.toLowerCase();
    if (n === 'rest day') return false;
    if (['cardio','run','stair','hiit','bike','swim','walk','cycle','elliptical'].some(k => n.includes(k))) return false;
    return true;
  });
  const totalWorkouts = gym.length;
  const totalVolKg = gym.reduce((sum, s) => {
    const vol = (s.workout_exercises ?? []).flatMap(ex => ex.sets ?? [])
      .reduce((sv, st) => sv + (st.weight_kg ?? 0) * (st.reps ?? 0), 0);
    return sum + vol;
  }, 0);

  // Best PR per exercise (max single-set weight)
  const prMap = {};
  gym.forEach(s => {
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

  // Monthly breakdown
  const monthly = MONTHS_SHORT.map((label, mi) => {
    const mo = mi + 1;
    const mSessions = gym.filter(s => new Date(s.date + 'T00:00:00').getMonth() + 1 === mo);
    const mSteps = (steps.data ?? []).filter(r => new Date(r.logged_at).getMonth() + 1 === mo);
    const mSleep = (sleep.data ?? []).filter(r => new Date(r.logged_at).getMonth() + 1 === mo);
    return {
      label,
      workouts: mSessions.length,
      steps: mSteps.reduce((s, r) => s + (r.steps ?? 0), 0),
      sleep: mSleep.length ? (mSleep.reduce((s, r) => s + r.hours, 0) / mSleep.length) : null,
    };
  });

  const totalSteps = (steps.data ?? []).reduce((s, r) => s + (r.steps ?? 0), 0);
  const sleepArr = (sleep.data ?? []).map(r => r.hours).filter(h => h > 0);
  const avgSleep = sleepArr.length ? (sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length) : null;

  const weightArr = (weight.data ?? []).map(r => ({ kg: r.weight, date: r.logged_at }));
  const weightDelta = weightArr.length >= 2
    ? +(weightArr[weightArr.length - 1].kg - weightArr[0].kg).toFixed(1) : null;

  // Streak
  const gymDates = new Set(gym.map(s => s.date));
  let bestStreak = 0, run = 0;
  const allDays = gym.map(s => s.date).sort();
  allDays.forEach((d, i) => {
    if (i === 0) { run = 1; bestStreak = 1; return; }
    const prev = new Date(allDays[i - 1] + 'T00:00:00');
    const cur  = new Date(d + 'T00:00:00');
    const diff = Math.round((cur - prev) / 86400000);
    if (diff === 1) { run++; bestStreak = Math.max(bestStreak, run); }
    else run = 1;
  });

  return {
    year: now.getFullYear(),
    totalWorkouts,
    totalVolKg: Math.round(totalVolKg),
    totalSteps,
    avgSleep,
    weightDelta,
    topPRs,
    monthly,
    bestStreak,
    sleepDays: sleepArr.length,
    foodDays: 0,
  };
}

export default function YearInReviewScreen({ navigation }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => styles(colors), [colors]);

  const { data, isLoading } = useQuery({
    queryKey: ['year-in-review', user?.id],
    queryFn: () => fetchYearData(user?.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !data) return (
    <SafeAreaView style={s.safe}>
      <ScreenHeader title="Year in Review" onBack={() => navigation.goBack()} />
      <ActivityIndicator color={colors.accent} style={{ flex: 1 }} />
    </SafeAreaView>
  );

  const maxWorkouts = Math.max(...data.monthly.map(m => m.workouts), 1);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Year in Review" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Hero */}
        <View style={s.hero}>
          <Text style={s.heroYear}>{data.year}</Text>
          <Text style={s.heroSub}>Your fitness year, at a glance</Text>
        </View>

        {/* Big stats */}
        <View style={s.bigStatsGrid}>
          <View style={[s.bigStat, { borderColor: colors.accent + '50' }]}>
            <Text style={s.bigStatEmoji}>🏋️</Text>
            <Text style={[s.bigStatVal, { color: colors.accent }]}>{data.totalWorkouts}</Text>
            <Text style={s.bigStatLabel}>WORKOUTS</Text>
          </View>
          <View style={[s.bigStat, { borderColor: '#fb7185' + '50' }]}>
            <Text style={s.bigStatEmoji}>⚖️</Text>
            <Text style={[s.bigStatVal, { color: '#fb7185' }]}>
              {data.totalVolKg >= 1000 ? `${(data.totalVolKg / 1000).toFixed(1)}t` : `${data.totalVolKg}kg`}
            </Text>
            <Text style={s.bigStatLabel}>TOTAL LIFTED</Text>
          </View>
          <View style={[s.bigStat, { borderColor: '#fbbf24' + '50' }]}>
            <Text style={s.bigStatEmoji}>👟</Text>
            <Text style={[s.bigStatVal, { color: '#fbbf24' }]}>
              {data.totalSteps >= 1000000
                ? `${(data.totalSteps / 1000000).toFixed(1)}M`
                : data.totalSteps >= 1000 ? `${(data.totalSteps / 1000).toFixed(0)}k` : String(data.totalSteps)}
            </Text>
            <Text style={s.bigStatLabel}>TOTAL STEPS</Text>
          </View>
          <View style={[s.bigStat, { borderColor: '#c4b5fd' + '50' }]}>
            <Text style={s.bigStatEmoji}>😴</Text>
            <Text style={[s.bigStatVal, { color: '#c4b5fd' }]}>{data.avgSleep ? `${data.avgSleep.toFixed(1)}h` : '—'}</Text>
            <Text style={s.bigStatLabel}>AVG SLEEP</Text>
          </View>
          <View style={[s.bigStat, { borderColor: '#34d399' + '50' }]}>
            <Text style={s.bigStatEmoji}>🔥</Text>
            <Text style={[s.bigStatVal, { color: '#34d399' }]}>{data.bestStreak}</Text>
            <Text style={s.bigStatLabel}>BEST STREAK</Text>
          </View>
          <View style={[s.bigStat, { borderColor: colors.border }]}>
            <Text style={s.bigStatEmoji}>{data.weightDelta != null ? (data.weightDelta <= 0 ? '📉' : '📈') : '⚖️'}</Text>
            <Text style={[s.bigStatVal, { color: colors.text }]}>
              {data.weightDelta != null ? `${data.weightDelta > 0 ? '+' : ''}${data.weightDelta}kg` : '—'}
            </Text>
            <Text style={s.bigStatLabel}>WEIGHT CHANGE</Text>
          </View>
        </View>

        {/* Monthly workouts bar chart */}
        <View style={s.card}>
          <Text style={s.cardTitle}>WORKOUTS PER MONTH</Text>
          <View style={s.barChart}>
            {data.monthly.map((m, i) => {
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

        {/* Top PRs */}
        {data.topPRs.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>BEST LIFTS THIS YEAR</Text>
            {data.topPRs.map((pr, i) => (
              <View key={i} style={[s.prRow, i < data.topPRs.length - 1 && s.prRowBorder]}>
                <Text style={s.prRank}>#{i + 1}</Text>
                <Text style={s.prName} numberOfLines={1}>{pr.name}</Text>
                <Text style={[s.prKg, { color: colors.accent }]}>{pr.kg} kg</Text>
              </View>
            ))}
          </View>
        )}

        {/* Fun fact */}
        {data.totalSteps > 0 && (
          <View style={s.funFact}>
            <Text style={s.funFactEmoji}>🌍</Text>
            <Text style={s.funFactText}>
              {`${data.totalSteps.toLocaleString()} steps ≈ ${(data.totalSteps * 0.762 / 1000).toFixed(0)} km walked this year`}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 16 },
  hero: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  heroYear: { fontSize: 52, fontFamily: fontFamily.monoBold, color: colors.accent },
  heroSub: { fontSize: 14, color: colors.textMuted, fontFamily: fontFamily.body },
  bigStatsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bigStat: { width: '47%', backgroundColor: colors.card, borderRadius: 16, borderWidth: 1.5, padding: 14, alignItems: 'center', gap: 4 },
  bigStatEmoji: { fontSize: 24 },
  bigStatVal: { fontSize: 26, fontFamily: fontFamily.monoBold },
  bigStatLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 1 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 14 },
  cardTitle: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4 },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end', gap: 2 },
  barVal: { fontSize: 8, fontFamily: fontFamily.mono, color: colors.textDim, height: 12 },
  barTrack: { flex: 1, width: '80%', backgroundColor: colors.border, borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', borderRadius: 3 },
  barLabel: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textMuted },
  prRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  prRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  prRank: { fontSize: 12, fontFamily: fontFamily.mono, color: colors.textDim, width: 24 },
  prName: { flex: 1, fontSize: 13, fontFamily: fontFamily.bodySemibold, color: colors.text },
  prKg: { fontSize: 14, fontFamily: fontFamily.monoBold },
  funFact: { backgroundColor: colors.accent + '12', borderRadius: 14, borderWidth: 1, borderColor: colors.accent + '30', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  funFactEmoji: { fontSize: 28 },
  funFactText: { flex: 1, fontSize: 13, color: colors.text, fontFamily: fontFamily.body, lineHeight: 19 },
});
