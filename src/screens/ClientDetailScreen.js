import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Svg, Line, Text as SvgText, Rect } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
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
      .order('logged_at', { ascending: true }),
    supabase.from('food_logs')
      .select('calories, protein, carbs, fats, logged_at')
      .eq('user_id', clientId)
      .gte('logged_at', sevenDaysAgo + 'T00:00:00'),
    supabase.from('sleep_logs')
      .select('hours, quality, notes, logged_at')
      .eq('user_id', clientId)
      .gte('logged_at', sevenDaysAgo + 'T00:00:00')
      .order('logged_at', { ascending: true }),
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
function fmtDay(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString(undefined, { weekday: 'short' });
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
function sleepQualityColor(q) {
  if (!q) return '#6b7280';
  if (q <= 2) return '#f87171';
  if (q === 3) return '#fbbf24';
  return '#34d399';
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon, iconColor, title, sub, badge, colors }) {
  const ic = iconColor ?? colors.accent;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: ic + '18', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={16} color={ic} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: weight.bold, color: colors.text, flex: 1 }}>{title}</Text>
      {badge != null && (
        <View style={{ backgroundColor: ic + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontSize: 11, fontWeight: weight.bold, color: ic }}>{badge}</Text>
        </View>
      )}
      {sub ? <Text style={{ fontSize: 11, color: colors.textDim }}>{sub}</Text> : null}
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

// ─── Locked placeholder ───────────────────────────────────────────────────────

function LockedSection({ colors }) {
  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#f9731620', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="lock-closed" size={16} color="#f97316" />
      </View>
      <View>
        <Text style={{ fontSize: 13, fontWeight: weight.semibold, color: colors.text }}>Restricted by client</Text>
        <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>Client has hidden this data from coaches</Text>
      </View>
    </View>
  );
}

// ─── Bar chart (steps / sleep / calories) ────────────────────────────────────

function BarChart({ bars, color, goalLine, maxOverride, labelKey, valueKey, valueSuffix, colors }) {
  if (!bars.length) return null;
  const cW = W - 64;
  const cH = 100;
  const padB = 22;
  const padT = 8;
  const padLR = 4;
  const chartH = cH - padB - padT;
  const vals = bars.map(b => b[valueKey] ?? 0);
  const maxVal = maxOverride ?? Math.max(...vals, 1);
  const barW = Math.max(8, (cW - padLR * 2) / bars.length - 4);
  const spacing = (cW - padLR * 2 - barW * bars.length) / Math.max(bars.length - 1, 1);
  const goalY = goalLine != null ? padT + (1 - Math.min(1, goalLine / maxVal)) * chartH : null;

  return (
    <Svg width={cW} height={cH}>
      {/* Goal dashed line */}
      {goalY != null && (
        <Line x1={padLR} y1={goalY} x2={cW - padLR} y2={goalY} stroke="#34d399" strokeWidth={1} strokeDasharray="4,3" />
      )}
      {bars.map((b, i) => {
        const val = b[valueKey] ?? 0;
        const pct = Math.min(1, val / maxVal);
        const barH = Math.max(3, pct * chartH);
        const x = padLR + i * (barW + spacing);
        const y = padT + chartH - barH;
        const met = goalLine != null ? val >= goalLine : null;
        const barColor = met === null ? color : met ? '#34d399' : '#f87171';
        return (
          <React.Fragment key={i}>
            <Rect x={x} y={padT} width={barW} height={chartH} rx={4} fill={colors.border + '40'} />
            <Rect x={x} y={y} width={barW} height={barH} rx={4} fill={barColor} />
            <SvgText x={x + barW / 2} y={cH - 4} fontSize={9} fill={colors.textDim} textAnchor="middle">
              {b[labelKey]}
            </SvgText>
            {val > 0 && (
              <SvgText x={x + barW / 2} y={y - 3} fontSize={9} fill={barColor} textAnchor="middle" fontWeight="bold">
                {valueSuffix ? `${val}${valueSuffix}` : val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
              </SvgText>
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// ─── Stat tile row ────────────────────────────────────────────────────────────

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
      <View style={{ height: 3, backgroundColor: accent }} />
      <TouchableOpacity onPress={() => hasEx && setExpanded(e => !e)} activeOpacity={0.75}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
          <View style={{ alignItems: 'center', minWidth: 34 }}>
            <Text style={{ fontSize: 18, fontWeight: weight.black, color: colors.text, lineHeight: 20 }}>
              {new Date(session.date).getDate()}
            </Text>
            <Text style={{ fontSize: 9, color: colors.textDim, fontWeight: weight.bold, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {new Date(session.date).toLocaleDateString(undefined, { month: 'short' })}
            </Text>
          </View>
          <View style={{ width: 1, height: 32, backgroundColor: colors.border }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: colors.text, fontWeight: weight.semibold }} numberOfLines={1}>
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
  const avgSleep7 = Math.round(avg(sleep, 'hours') * 10) / 10;
  const currentWeight = weights[0]?.weight;
  // 7-day weight stats
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const weights7 = weights.filter(w => (w.logged_at ?? '').slice(0, 10) >= sevenDaysAgoStr);
  const avgWeight7 = weights7.length ? Math.round(avg(weights7, 'weight') * 10) / 10 : null;
  const weightWeekAgo = weights.find(w => (w.logged_at ?? '').slice(0, 10) <= sevenDaysAgoStr)?.weight ?? null;
  const weeklyChange = currentWeight && weightWeekAgo ? (currentWeight - weightWeekAgo).toFixed(1) : null;
  const highWeight7 = weights7.length ? Math.max(...weights7.map(w => w.weight)) : null;
  const lowWeight7  = weights7.length ? Math.min(...weights7.map(w => w.weight)) : null;

  // Step bars: one per day
  const stepBars = useMemo(() => steps.map(s => ({
    label: fmtDay(s.logged_at),
    steps: s.steps,
  })), [steps]);

  // Sleep bars
  const sleepBars = useMemo(() => sleep.map(s => ({
    label: fmtDay(s.logged_at),
    hours: s.hours ?? 0,
    quality: s.quality,
  })), [sleep]);

  // Calorie bars: daily totals
  const calBars = useMemo(() => {
    const map = {};
    food.forEach(f => {
      const d = (f.logged_at ?? '').slice(0, 10);
      if (!map[d]) map[d] = 0;
      map[d] += f.calories ?? 0;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, cal]) => ({
      label: fmtDay(date + 'T12:00:00'),
      calories: Math.round(cal),
    }));
  }, [food]);

  const avgCals = calBars.length
    ? Math.round(calBars.reduce((s, b) => s + b.calories, 0) / calBars.length) : 0;

  // Workout counts
  const workoutCount = workouts.filter(w => sessionType(w.notes) !== 'rest').length;
  const strengthCount = workouts.filter(w => sessionType(w.notes) === 'strength').length;
  const cardioCount = workouts.filter(w => sessionType(w.notes) === 'cardio').length;

  const initials = (clientName ?? '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  if (isLoading) {
    return (
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent + '22', borderWidth: 1.5, borderColor: colors.accent + '55', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: weight.black, color: colors.accent }}>{initials}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 16, fontWeight: weight.bold, color: colors.text }}>{clientName ?? 'Client'}</Text>
            {profile?.goal && <Text style={{ fontSize: 11, color: colors.textDim }}>{profile.goal}</Text>}
          </View>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('CoachChat', { coachId: user?.id, clientId, clientName: clientName ?? 'Client' })}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="chatbubble-ellipses" size={16} color={colors.bg} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Quick summary chips ─────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {[
            { icon: 'barbell-outline',   color: colors.accent, label: 'Workouts',  restricted: !vis.workouts,  value: vis.workouts ? String(workoutCount) : null },
            { icon: 'footsteps-outline', color: '#22c55e',     label: 'Avg Steps', restricted: !vis.steps,     value: vis.steps ? (avgSteps7 > 0 ? (avgSteps7 >= 1000 ? `${(avgSteps7/1000).toFixed(1)}k` : String(avgSteps7)) : '—') : null },
            { icon: 'moon-outline',      color: '#6366f1',     label: 'Avg Sleep', restricted: !vis.sleep,     value: vis.sleep ? (avgSleep7 > 0 ? `${avgSleep7}h` : '—') : null },
            { icon: 'flame-outline',     color: '#ef4444',     label: 'Avg Kcal',  restricted: !vis.food,      value: vis.food ? (avgCals > 0 ? (avgCals >= 1000 ? `${(avgCals/1000).toFixed(1)}k` : String(avgCals)) : '—') : null },
          ].map(({ icon, color, label, value, restricted }) => (
            <View key={label} style={{ flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 10, alignItems: 'center', gap: 5 }}>
              <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: restricted ? colors.border + '40' : color + '18', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={restricted ? 'lock-closed' : icon} size={14} color={restricted ? '#f97316' : color} />
              </View>
              <Text style={{ fontSize: 14, fontWeight: weight.black, color: restricted ? colors.textDim : colors.text }}>
                {restricted ? '—' : value}
              </Text>
              <Text style={{ fontSize: 9, color: restricted ? '#f97316' : colors.textDim, textAlign: 'center', fontWeight: restricted ? weight.bold : '400' }}>
                {restricted ? 'Restricted' : label}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Weight ──────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 }}>
          <SectionHeader icon="scale-outline" iconColor="#f97316" title="Body Weight"
            sub="7-day stats" colors={colors}
          />
          {!vis.weight ? <LockedSection colors={colors} /> : weights.length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.textDim }}>No weight logged</Text>
          ) : (
            <>
              {/* Current weight hero */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 }}>
                <Text style={{ fontSize: 32, fontWeight: weight.black, color: colors.text, lineHeight: 34 }}>
                  {currentWeight != null ? `${currentWeight}` : '—'}
                </Text>
                <Text style={{ fontSize: 16, color: colors.textDim, marginBottom: 3 }}>kg</Text>
                {weeklyChange !== null && (
                  <View style={{ marginLeft: 4, marginBottom: 3, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons
                      name={parseFloat(weeklyChange) > 0 ? 'arrow-up' : parseFloat(weeklyChange) < 0 ? 'arrow-down' : 'remove'}
                      size={12}
                      color={parseFloat(weeklyChange) <= 0 ? '#34d399' : '#f87171'}
                    />
                    <Text style={{ fontSize: 13, fontWeight: weight.bold, color: parseFloat(weeklyChange) <= 0 ? '#34d399' : '#f87171' }}>
                      {parseFloat(weeklyChange) > 0 ? '+' : ''}{weeklyChange} kg this week
                    </Text>
                  </View>
                )}
              </View>

              {/* 2×2 stats grid */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[
                  { label: '7-DAY AVG',  value: avgWeight7  != null ? `${avgWeight7} kg`  : '—', color: '#f97316' },
                  { label: 'WEEKLY ΔCHG', value: weeklyChange != null ? `${parseFloat(weeklyChange) > 0 ? '+' : ''}${weeklyChange} kg` : '—', color: parseFloat(weeklyChange) <= 0 ? '#34d399' : '#f87171' },
                  { label: '7-DAY HIGH',  value: highWeight7 != null ? `${highWeight7} kg` : '—', color: '#f87171' },
                  { label: '7-DAY LOW',   value: lowWeight7  != null ? `${lowWeight7} kg`  : '—', color: '#34d399' },
                ].map(({ label, value, color }) => (
                  <View key={label} style={{ flex: 1, backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, alignItems: 'center', gap: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: weight.black, color }}>{value}</Text>
                    <Text style={{ fontSize: 8, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center' }}>{label}</Text>
                  </View>
                ))}
              </View>

              {/* Goal progress */}
              {profile?.weight_goal_kg && currentWeight != null && (
                <View style={{ marginTop: 12, backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontSize: 11, color: colors.textDim }}>Goal: {profile.weight_goal_kg} kg</Text>
                    <Text style={{ fontSize: 11, fontWeight: weight.semibold, color: Math.abs(currentWeight - profile.weight_goal_kg) < 1 ? '#34d399' : colors.textDim }}>
                      {Math.abs(currentWeight - profile.weight_goal_kg).toFixed(1)} kg to go
                    </Text>
                  </View>
                  {(() => {
                    const start = weightWeekAgo ?? currentWeight;
                    const goal = profile.weight_goal_kg;
                    const total = Math.abs(start - goal);
                    const done = total > 0 ? Math.min(1, Math.abs(start - currentWeight) / total) : (currentWeight === goal ? 1 : 0);
                    return (
                      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
                        <View style={{ height: 4, width: `${Math.round(done * 100)}%`, backgroundColor: '#34d399', borderRadius: 2 }} />
                      </View>
                    );
                  })()}
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Steps ───────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 }}>
          <SectionHeader icon="footsteps-outline" iconColor="#22c55e" title="Steps"
            badge={avgSteps7 > 0 && vis.steps ? `avg ${avgSteps7 >= 1000 ? `${(avgSteps7/1000).toFixed(1)}k` : avgSteps7}` : undefined}
            sub="Last 7 days" colors={colors}
          />
          {!vis.steps ? <LockedSection colors={colors} /> : steps.length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.textDim }}>No step data</Text>
          ) : (
            <>
              <BarChart
                bars={stepBars} color="#22c55e"
                goalLine={profile?.step_goal} maxOverride={profile?.step_goal ? Math.max(profile.step_goal * 1.1, Math.max(...stepBars.map(b => b.steps))) : undefined}
                labelKey="label" valueKey="steps" colors={colors}
              />
              {profile?.step_goal && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                  <View style={{ width: 16, height: 1.5, backgroundColor: '#34d399' }} />
                  <Text style={{ fontSize: 9, color: colors.textDim }}>Goal {profile.step_goal.toLocaleString()} steps/day</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Sleep ───────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 }}>
          <SectionHeader icon="moon-outline" iconColor="#6366f1" title="Sleep"
            badge={avgSleep7 > 0 && vis.sleep ? `avg ${avgSleep7}h` : undefined}
            sub="Last 7 nights" colors={colors}
          />
          {!vis.sleep ? <LockedSection colors={colors} /> : sleep.length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.textDim }}>No sleep logged</Text>
          ) : (
            <>
              <BarChart
                bars={sleepBars} color="#6366f1"
                goalLine={profile?.sleep_goal_hours}
                labelKey="label" valueKey="hours" valueSuffix="h"
                maxOverride={Math.max(10, ...sleepBars.map(b => b.hours))}
                colors={colors}
              />
              {profile?.sleep_goal_hours && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                  <View style={{ width: 16, height: 1.5, backgroundColor: '#34d399' }} />
                  <Text style={{ fontSize: 9, color: colors.textDim }}>Goal {profile.sleep_goal_hours}h per night</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Calories ────────────────────────────────────────────────── */}
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 14 }}>
          <SectionHeader icon="flame-outline" iconColor="#ef4444" title="Calories"
            badge={avgCals > 0 && vis.food ? `avg ${avgCals >= 1000 ? `${(avgCals/1000).toFixed(1)}k` : avgCals} kcal` : undefined}
            sub="Last 7 days" colors={colors}
          />
          {!vis.food ? <LockedSection colors={colors} /> : calBars.length === 0 ? (
            <Text style={{ fontSize: 13, color: colors.textDim }}>No food logged</Text>
          ) : (
            <>
              <BarChart
                bars={calBars} color="#ef4444"
                goalLine={profile?.calorie_target}
                labelKey="label" valueKey="calories" colors={colors}
              />
              {profile?.calorie_target && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                  <View style={{ width: 16, height: 1.5, backgroundColor: '#34d399' }} />
                  <Text style={{ fontSize: 9, color: colors.textDim }}>Target {profile.calorie_target} kcal/day</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Workouts ────────────────────────────────────────────────── */}
        {(() => {
          const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
          const recent = workouts.filter(w => w.date >= fourteenDaysAgo && sessionType(w.notes) !== 'rest');
          return (
            <View style={{ marginBottom: 14 }}>
              <SectionHeader icon="barbell-outline" iconColor={colors.accent} title="Workouts"
                badge={vis.workouts ? `${strengthCount}S · ${cardioCount}C` : undefined}
                sub="Last 14 days" colors={colors}
              />
              {!vis.workouts ? <LockedSection colors={colors} /> : recent.length === 0 ? (
                <View style={{ backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 }}>
                  <Text style={{ fontSize: 13, color: colors.textDim }}>No workouts in last 14 days</Text>
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
