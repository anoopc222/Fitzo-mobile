import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import Sparkline from '../components/Sparkline';
const W = Dimensions.get('window').width;

// ─── Data ────────────────────────────────────────────────────────────────────

async function fetchClientDetail(clientId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const sevenDaysAgo  = new Date(Date.now() -  7 * 86400000).toISOString().split('T')[0];

  const [profile, workouts, weights, steps, food, sleep] = await Promise.all([
    supabase.from('profiles')
      .select('full_name, goal, weight_goal_kg, step_goal, sleep_goal_hours, calorie_target, coach_visibility')
      .eq('id', clientId).single(),
    supabase.from('workout_sessions')
      .select(`id, date, total_volume, duration_min, calories_burned, notes,
        workout_exercises(id, exercise_name, order_index,
          sets(set_number, weight_kg, reps, rpe))`)
      .eq('user_id', clientId)
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: false })
      .limit(30),
    supabase.from('weight_logs')
      .select('weight, logged_at')
      .eq('user_id', clientId)
      .gte('logged_at', thirtyDaysAgo + 'T00:00:00')
      .order('logged_at', { ascending: false }),
    supabase.from('step_logs')
      .select('steps, logged_at')
      .eq('user_id', clientId)
      .gte('logged_at', sevenDaysAgo + 'T00:00:00')
      .order('logged_at', { ascending: false }),
    supabase.from('food_logs')
      .select('calories, protein, carbs, fats, logged_at')
      .eq('user_id', clientId)
      .gte('logged_at', thirtyDaysAgo + 'T00:00:00'),
    supabase.from('sleep_logs')
      .select('hours, quality, notes, logged_at')
      .eq('user_id', clientId)
      .gte('logged_at', sevenDaysAgo + 'T00:00:00')
      .order('logged_at', { ascending: false }),
  ]);

  return {
    profile: profile.data,
    workouts: workouts.data ?? [],
    weights: weights.data ?? [],
    steps: steps.data ?? [],
    food: food.data ?? [],
    sleep: sleep.data ?? [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avg(arr, key) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + (x[key] ?? 0), 0) / arr.length;
}
function fmt(n, d = 1) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(d); }
function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function sessionType(notes) {
  if (!notes) return 'strength';
  const n = notes.toLowerCase();
  if (n.includes('rest')) return 'rest';
  if (n.includes('cardio') || n.includes('run') || n.includes('cycle')) return 'cardio';
  return 'strength';
}
function cleanNotes(notes) {
  if (!notes) return null;
  const c = notes.trim();
  if (!c || c.toLowerCase().includes('deleted') || c === '-') return null;
  return c;
}
function typeColor(type, colors) {
  if (type === 'rest') return colors.textDim;
  if (type === 'cardio') return '#22d3ee';
  return colors.accent;
}
function sleepBarColor(q) {
  if (!q) return '#6b7280';
  if (q <= 2) return '#f87171';
  if (q === 3) return '#fbbf24';
  return '#34d399';
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, sub, colors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: colors.accent + '18', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={14} color={colors.accent} />
      </View>
      <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text, flex: 1 }}>{title}</Text>
      {sub ? <Text style={{ fontSize: 11, color: colors.textDim }}>{sub}</Text> : null}
    </View>
  );
}

// ─── Metric chip ──────────────────────────────────────────────────────────────

function MetricChip({ icon, value, label, accent, goalMet, colors }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center', gap: 4 }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: (accent ?? colors.accent) + '18', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={15} color={accent ?? colors.accent} />
      </View>
      <Text style={{ fontSize: typography.base, fontWeight: weight.black, color: colors.text }}>{value}</Text>
      <Text style={{ fontSize: 10, color: colors.textDim, textAlign: 'center' }}>{label}</Text>
      {goalMet != null && (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: goalMet ? '#34d399' : '#f87171' }} />
      )}
    </View>
  );
}

// ─── RPE chip ─────────────────────────────────────────────────────────────────

function RpeChip({ rpe, colors }) {
  if (!rpe) return <Text style={{ fontSize: 11, color: colors.textDim }}>—</Text>;
  const color = rpe >= 9 ? '#f87171' : rpe >= 7 ? '#fbbf24' : '#34d399';
  return (
    <View style={{ backgroundColor: color + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ fontSize: 10, color, fontWeight: weight.bold }}>{rpe}</Text>
    </View>
  );
}

// ─── Workout row (expandable card) ────────────────────────────────────────────

function WorkoutRow({ session, colors }) {
  const [expanded, setExpanded] = useState(false);
  const type = sessionType(session.notes);
  const accent = typeColor(type, colors);
  const exercises = (session.workout_exercises ?? [])
    .slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const totalSets = exercises.reduce((s, e) => s + (e.sets?.length ?? 0), 0);
  const note = cleanNotes(session.notes);
  const hasEx = exercises.length > 0;

  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 8, overflow: 'hidden' }}>
      <View style={{ height: 2, backgroundColor: accent }} />
      <TouchableOpacity onPress={() => hasEx && setExpanded(e => !e)} activeOpacity={0.75}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
          <View style={{ alignItems: 'center', minWidth: 32 }}>
            <Text style={{ fontSize: 17, fontWeight: weight.black, color: colors.text, lineHeight: 19 }}>
              {new Date(session.date).getDate()}
            </Text>
            <Text style={{ fontSize: 9, color: colors.textDim, fontWeight: weight.bold, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {new Date(session.date).toLocaleDateString(undefined, { month: 'short' })}
            </Text>
          </View>
          <View style={{ width: 1, height: 30, backgroundColor: colors.border }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: typography.sm, color: colors.text, fontWeight: weight.semibold }} numberOfLines={1}>
              {hasEx ? exercises.map(e => e.exercise_name).join(' · ') : (note ?? (type === 'rest' ? 'Rest Day' : 'Strength'))}
            </Text>
            {hasEx && (
              <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                {exercises.length} exercise{exercises.length > 1 ? 's' : ''} · {totalSets} set{totalSets !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            {session.total_volume ? (
              <Text style={{ fontSize: 12, color: accent, fontWeight: weight.bold }}>
                {session.total_volume >= 1000 ? `${(session.total_volume / 1000).toFixed(1)}k` : session.total_volume} kg
              </Text>
            ) : null}
            {session.duration_min ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Ionicons name="time-outline" size={9} color={colors.textDim} />
                <Text style={{ fontSize: 9, color: colors.textDim }}>{session.duration_min}m</Text>
              </View>
            ) : null}
          </View>
          {hasEx && (
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textDim} />
            </View>
          )}
        </View>
      </TouchableOpacity>

      {expanded && hasEx && (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
          {exercises.map((ex, ei) => {
            const sets = (ex.sets ?? []).slice().sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
            return (
              <View key={ex.id} style={{ margin: 10, marginTop: ei === 0 ? 10 : 0, marginBottom: ei < exercises.length - 1 ? 4 : 10, backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                <LinearGradient colors={[colors.accent + '15', colors.accent + '03']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.accent }} />
                  <Text style={{ fontSize: 12, fontWeight: weight.bold, color: colors.accent, flex: 1 }}>{ex.exercise_name}</Text>
                  <Text style={{ fontSize: 10, color: colors.textDim }}>{sets.length} sets</Text>
                </LinearGradient>
                {sets.length > 0 && (
                  <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
                    <View style={{ flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      {['SET', 'WEIGHT', 'REPS', 'RPE'].map(h => (
                        <Text key={h} style={{ flex: h === 'SET' ? 0 : 1, width: h === 'SET' ? 28 : undefined, fontSize: 9, color: colors.textDim, fontWeight: weight.bold }}>{h}</Text>
                      ))}
                    </View>
                    {sets.map((s, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: i < sets.length - 1 ? 1 : 0, borderBottomColor: colors.border + '50' }}>
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                          <Text style={{ fontSize: 8, fontWeight: weight.bold, color: colors.textDim }}>{s.set_number ?? i + 1}</Text>
                        </View>
                        <Text style={{ flex: 1, fontSize: 12, color: colors.text, fontWeight: weight.semibold }}>{s.weight_kg ? `${s.weight_kg} kg` : '—'}</Text>
                        <Text style={{ flex: 1, fontSize: 12, color: colors.text }}>{s.reps ? `${s.reps}` : '—'}</Text>
                        <View style={{ flex: 1 }}><RpeChip rpe={s.rpe} colors={colors} /></View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Locked placeholder ───────────────────────────────────────────────────────

function LockedSection({ colors }) {
  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name="lock-closed" size={16} color={colors.textDim} />
      <Text style={{ fontSize: typography.sm, color: colors.textDim }}>Hidden by client</Text>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ClientDetailScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation();
  const { clientId, clientName } = useRoute().params ?? {};

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['clientDetail', clientId],
    queryFn: () => fetchClientDetail(clientId),
    enabled: !!clientId,
    staleTime: 0, gcTime: 0,
  });

  const { profile, workouts = [], weights = [], steps = [], food = [], sleep = [] } = data ?? {};
  const vis = { workouts: true, weight: true, steps: true, sleep: true, food: true, ...(profile?.coach_visibility ?? {}) };

  // ── Derived ────────────────────────────────────────────────────────────────
  const avgSteps7 = Math.round(avg(steps, 'steps'));
  const avgSleep7 = avg(sleep, 'hours');

  const dayFood = useMemo(() => {
    const map = {};
    food.forEach(f => {
      const day = (f.logged_at ?? '').slice(0, 10);
      if (!map[day]) map[day] = { cal: 0 };
      map[day].cal += f.calories ?? 0;
    });
    return map;
  }, [food]);

  const avgCals = useMemo(() => {
    const days = Object.values(dayFood);
    return days.length ? Math.round(days.reduce((s, d) => s + d.cal, 0) / days.length) : 0;
  }, [dayFood]);

  const currentWeight = weights[0]?.weight;
  const oldestWeight = weights[weights.length - 1]?.weight;
  const weightDelta = currentWeight && oldestWeight && weights.length > 1
    ? (currentWeight - oldestWeight).toFixed(1) : null;
  const weightSparkData = useMemo(() => weights.slice(0, 14).reverse().map(w => w.weight), [weights]);

  // Heatmap data: workout volume per day
  const heatmapData = useMemo(() => {
    const map = {};
    workouts.forEach(w => {
      if (w.date) map[w.date] = w.total_volume ?? 1;
    });
    return map;
  }, [workouts]);

  // Heatmap type colors: rest=dim, cardio=cyan, strength=accent
  const heatmapTypeColors = useMemo(() => {
    const map = {};
    workouts.forEach(w => {
      if (!w.date) return;
      const t = sessionType(w.notes);
      if (t === 'rest') map[w.date] = colors.textDim;
      else if (t === 'cardio') map[w.date] = '#22d3ee';
      else map[w.date] = colors.accent;
    });
    return map;
  }, [workouts, colors]);

  // Streak: consecutive workout days ending today
  const workoutStreak = useMemo(() => {
    const days = new Set(workouts.filter(w => sessionType(w.notes) !== 'rest').map(w => w.date));
    let streak = 0;
    const d = new Date();
    while (true) {
      const str = d.toISOString().split('T')[0];
      if (!days.has(str)) break;
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }, [workouts]);

  const now = new Date();

  const initials = (clientName ?? '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent + '22', borderWidth: 1.5, borderColor: colors.accent + '55', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: weight.black, color: colors.accent }}>{initials}</Text>
          </View>
          <View>
            <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.text }}>{clientName ?? 'Client'}</Text>
            {profile?.goal && <Text style={{ fontSize: 11, color: colors.textDim }}>{profile.goal}</Text>}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('CoachChat', { coachId: user?.id, clientId, clientName: clientName ?? 'Client' })}
          style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chatbubble-ellipses" size={16} color={colors.bg} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Stat chips ──────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <MetricChip
            icon="barbell-outline"
            value={vis.workouts
              ? (() => {
                  const s = workouts.filter(w => sessionType(w.notes) === 'strength').length;
                  const c = workouts.filter(w => sessionType(w.notes) === 'cardio').length;
                  return `${s}S · ${c}C`;
                })()
              : '🔒'}
            label="Workout · Cardio"
            accent={colors.accent}
            colors={colors}
          />
          <MetricChip icon="footsteps-outline"
            value={!vis.steps ? '🔒' : avgSteps7 > 0 ? (avgSteps7 >= 1000 ? `${(avgSteps7/1000).toFixed(1)}k` : avgSteps7) : '—'}
            label="Avg Steps 7d" accent="#34d399" colors={colors}
            goalMet={vis.steps && profile?.step_goal && avgSteps7 > 0 ? avgSteps7 >= profile.step_goal : null}
          />
          <MetricChip icon="moon-outline" value={!vis.sleep ? '🔒' : avgSleep7 > 0 ? fmt(avgSleep7) + 'h' : '—'}
            label="Avg Sleep 7d" accent="#818cf8" colors={colors}
            goalMet={vis.sleep && profile?.sleep_goal_hours && avgSleep7 > 0 ? avgSleep7 >= profile.sleep_goal_hours : null}
          />
          <MetricChip icon="flame-outline" value={!vis.food ? '🔒' : avgCals > 0 ? (avgCals >= 1000 ? `${(avgCals/1000).toFixed(1)}k` : avgCals) : '—'}
            label="Avg Kcal 30d" accent="#f97316" colors={colors}
          />
        </View>


        {/* ── Weight ──────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 }}>
          <SectionHeader icon="scale-outline" title="Body Weight" sub="30d" colors={colors} />
          {!vis.weight ? <LockedSection colors={colors} /> : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 26, fontWeight: weight.black, color: colors.text }}>
                    {currentWeight ? `${currentWeight} kg` : '—'}
                  </Text>
                  {weightDelta !== null && (
                    <Text style={{ fontSize: 12, color: parseFloat(weightDelta) < 0 ? '#34d399' : '#f87171', marginTop: 2, fontWeight: weight.semibold }}>
                      {parseFloat(weightDelta) > 0 ? '+' : ''}{weightDelta} kg vs 30d ago
                    </Text>
                  )}
                  {profile?.weight_goal_kg && currentWeight && (
                    <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                      Goal {profile.weight_goal_kg} kg · {Math.abs(currentWeight - profile.weight_goal_kg).toFixed(1)} kg to go
                    </Text>
                  )}
                </View>
                {weightSparkData.length > 1 && (
                  <Sparkline data={weightSparkData} color={colors.accent} width={130} height={48} filled />
                )}
              </View>
              {/* Compact weight list */}
              {weights.slice(0, 7).map((entry, i) => {
                const prev = weights[i + 1];
                const delta = prev ? (entry.weight - prev.weight).toFixed(1) : null;
                const dc = delta === null ? colors.textDim : parseFloat(delta) < 0 ? '#34d399' : parseFloat(delta) > 0 ? '#f87171' : colors.textDim;
                return (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ flex: 1, fontSize: 11, color: colors.textDim }}>{fmtDate(entry.logged_at)}</Text>
                    <Text style={{ fontSize: 13, fontWeight: weight.semibold, color: colors.text }}>{entry.weight} kg</Text>
                    {delta !== null && (
                      <Text style={{ fontSize: 11, color: dc, marginLeft: 10, width: 52, textAlign: 'right' }}>
                        {parseFloat(delta) > 0 ? '+' : ''}{delta}
                      </Text>
                    )}
                  </View>
                );
              })}
              {weights.length === 0 && <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No weight logged</Text>}
            </>
          )}
        </View>

        {/* ── Steps 7d ────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 }}>
          <SectionHeader icon="footsteps-outline" title="Steps" sub="Last 7 days" colors={colors} />
          {!vis.steps ? <LockedSection colors={colors} /> : steps.length === 0 ? (
            <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No step data</Text>
          ) : (
            steps.slice(0, 7).reverse().map((s, i) => {
              const pct = profile?.step_goal ? Math.min(1, s.steps / profile.step_goal) : 0;
              const color = pct >= 1 ? '#34d399' : pct >= 0.7 ? '#fbbf24' : '#f87171';
              return (
                <View key={i} style={{ marginBottom: 7 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                    <Text style={{ fontSize: 11, color: colors.textDim }}>{fmtDate(s.logged_at)}</Text>
                    <Text style={{ fontSize: 11, color: colors.text, fontWeight: weight.semibold }}>
                      {s.steps.toLocaleString()}{profile?.step_goal ? ` / ${profile.step_goal.toLocaleString()}` : ''}
                    </Text>
                  </View>
                  <View style={{ height: 5, backgroundColor: colors.bg, borderRadius: 3 }}>
                    <View style={{ height: 5, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── Sleep 7d ────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 }}>
          <SectionHeader icon="moon-outline" title="Sleep"
            sub={avgSleep7 > 0 && vis.sleep ? `avg ${fmt(avgSleep7)}h` : 'Last 7 nights'}
            colors={colors}
          />
          {!vis.sleep ? <LockedSection colors={colors} /> : sleep.length === 0 ? (
            <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No sleep logged</Text>
          ) : (
            sleep.slice(0, 7).map((entry, i) => {
              const color = sleepBarColor(entry.quality);
              const pct = Math.min(1, (entry.hours ?? 0) / 10);
              return (
                <View key={i} style={{ marginBottom: 7 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                    <Text style={{ fontSize: 11, color: colors.textDim }}>{fmtDate(entry.logged_at)}</Text>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      {entry.quality ? (
                        <View style={{ backgroundColor: color + '30', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 9, color, fontWeight: weight.bold }}>
                            {entry.quality <= 2 ? 'Poor' : entry.quality === 3 ? 'Fair' : 'Good'}
                          </Text>
                        </View>
                      ) : null}
                      <Text style={{ fontSize: 11, color: colors.text, fontWeight: weight.semibold }}>{entry.hours ? `${entry.hours}h` : '—'}</Text>
                    </View>
                  </View>
                  <View style={{ height: 5, backgroundColor: colors.bg, borderRadius: 3 }}>
                    <View style={{ height: 5, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 3 }} />
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ── Workouts (last 14 days, rest excluded) ──────────────────── */}
        {(() => {
          const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
          const recent = workouts.filter(w => w.date >= fourteenDaysAgo && sessionType(w.notes) !== 'rest');
          const sCount = recent.filter(w => sessionType(w.notes) === 'strength').length;
          const cCount = recent.filter(w => sessionType(w.notes) === 'cardio').length;
          const subLabel = vis.workouts
            ? `${sCount} strength · ${cCount} cardio · tap to expand`
            : undefined;
          return (
            <View style={{ marginBottom: 14 }}>
              <SectionHeader icon="barbell-outline" title="Workouts" sub={subLabel} colors={colors} />
              {!vis.workouts ? <LockedSection colors={colors} /> : recent.length === 0 ? (
                <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                  <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No workouts in last 14 days</Text>
                </View>
              ) : recent.map((session, i) => (
                <WorkoutRow key={session.id ?? i} session={session} colors={colors} />
              ))}
            </View>
          );
        })()}

      </ScrollView>
    </SafeAreaView>
  );
}
