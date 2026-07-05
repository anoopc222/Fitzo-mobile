import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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

async function fetchYearData(userId, year) {
  const yearStart = `${year}-01-01`;
  const yearEnd   = `${year}-12-31`;

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

  const allDays = gym.map(s => s.date).sort();
  let bestStreak = 0, run = 0;
  allDays.forEach((d, i) => {
    if (i === 0) { run = 1; bestStreak = 1; return; }
    const prev = new Date(allDays[i - 1] + 'T00:00:00');
    const cur  = new Date(d + 'T00:00:00');
    const diff = Math.round((cur - prev) / 86400000);
    if (diff === 1) { run++; bestStreak = Math.max(bestStreak, run); }
    else run = 1;
  });

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
    sleepDays: sleepArr.length,
  };
}

export default function YearInReviewScreen({ navigation }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => styles(colors), [colors]);

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data, isLoading } = useQuery({
    queryKey: ['year-in-review', user?.id, selectedYear],
    queryFn: () => fetchYearData(user?.id, selectedYear),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const canGoForward = selectedYear < currentYear;

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

        {/* Year picker */}
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

        {/* Stats grid — 2 per row, horizontal layout */}
        <View style={s.statsGrid}>
          {[
            { emoji: '🏋️', val: String(data.totalWorkouts), label: 'WORKOUTS', color: colors.accent, border: colors.accent + '40' },
            { emoji: '⚖️', val: data.totalVolKg >= 1000 ? `${(data.totalVolKg / 1000).toFixed(1)}t` : `${data.totalVolKg}kg`, label: 'TOTAL LIFTED', color: '#fb7185', border: '#fb718540' },
            { emoji: '👟', val: data.totalSteps >= 1000000 ? `${(data.totalSteps / 1000000).toFixed(1)}M` : data.totalSteps >= 1000 ? `${(data.totalSteps / 1000).toFixed(0)}k` : String(data.totalSteps), label: 'TOTAL STEPS', color: '#fbbf24', border: '#fbbf2440' },
            { emoji: '😴', val: data.avgSleep ? `${data.avgSleep.toFixed(1)}h` : '—', label: 'AVG SLEEP', color: '#c4b5fd', border: '#c4b5fd40' },
            { emoji: '🔥', val: String(data.bestStreak), label: 'BEST STREAK', color: '#34d399', border: '#34d39940' },
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

        {/* Fun fact */}
        {data.totalSteps > 0 && (
          <View style={s.funFact}>
            <Text style={s.funFactEmoji}>🌍</Text>
            <Text style={s.funFactText}>
              {`${data.totalSteps.toLocaleString()} steps ≈ ${(data.totalSteps * 0.762 / 1000).toFixed(0)} km walked in ${selectedYear}`}
            </Text>
          </View>
        )}

        {data.totalWorkouts === 0 && (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>🗓️</Text>
            <Text style={s.emptyText}>No workout data found for {selectedYear}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },
  yearPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10 },
  yearArrow: { padding: 4 },
  yearArrowDisabled: { opacity: 0.3 },
  yearCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yearText: { fontSize: 22, fontFamily: fontFamily.monoBold, color: colors.text },
  currentBadge: { backgroundColor: colors.accent + '20', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  currentBadgeText: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { width: '48%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1.5, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statEmoji: { fontSize: 22 },
  statBody: { flex: 1, gap: 2 },
  statVal: { fontSize: 20, fontFamily: fontFamily.monoBold },
  statLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.8 },
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
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
