import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Rect, Text as SvgText, Line, Polyline } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import Sparkline from '../components/Sparkline';

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

function fmt(n, d = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(d);
}

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sessionType(notes) {
  if (!notes) return 'strength';
  const n = notes.toLowerCase();
  if (n.includes('rest')) return 'rest';
  if (n.includes('cardio') || n.includes('run') || n.includes('cycle') || n.includes('swim')) return 'cardio';
  return 'strength';
}

function cleanNotes(notes) {
  if (!notes) return null;
  // Filter out placeholder/deleted values
  const cleaned = notes.trim();
  if (!cleaned || cleaned.toLowerCase().includes('deleted') || cleaned === '-') return null;
  return cleaned;
}

function typeColor(type, colors) {
  if (type === 'rest') return colors.textDim;
  if (type === 'cardio') return '#22d3ee';
  return colors.accent;
}

function sleepBarColor(quality) {
  if (!quality) return '#6b7280';
  if (quality <= 2) return '#f87171';
  if (quality === 3) return '#fbbf24';
  return '#34d399';
}

function qualityLabel(q) {
  if (!q) return '';
  if (q <= 2) return 'Poor';
  if (q === 3) return 'Fair';
  return 'Good';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ title, colors, right }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 10 }}>
      <Text style={{
        fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted,
        textTransform: 'uppercase', letterSpacing: 1, flex: 1,
      }}>
        {title}
      </Text>
      {right}
    </View>
  );
}

function StatTile({ label, value, sub, icon, accent, colors }) {
  return (
    <View style={{
      flex: 1, backgroundColor: colors.bgCard, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center', gap: 3,
    }}>
      <Ionicons name={icon} size={17} color={accent ?? colors.accent} />
      <Text style={{ fontSize: typography.base, fontWeight: weight.bold, color: colors.text, textAlign: 'center' }}>
        {value}
      </Text>
      {sub ? <Text style={{ fontSize: 10, color: sub.color ?? colors.textDim, textAlign: 'center' }}>{sub.text}</Text> : null}
      <Text style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function WeekDayRow({ label, value, goal, color, colors }) {
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
        <Text style={{ fontSize: typography.xs, color: colors.textMuted }}>{label}</Text>
        <Text style={{ fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold }}>
          {value.toLocaleString()}{goal ? ` / ${goal.toLocaleString()}` : ''}
        </Text>
      </View>
      <View style={{ height: 4, backgroundColor: colors.bgElevated, borderRadius: 2 }}>
        <View style={{ height: 4, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

// Expandable workout session row with sets drill-down
function WorkoutRow({ session, colors }) {
  const [expanded, setExpanded] = useState(false);
  const type = sessionType(session.notes);
  const accent = typeColor(type, colors);
  const exercises = (session.workout_exercises ?? [])
    .slice()
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

  const totalSets = exercises.reduce((s, e) => s + (e.sets?.length ?? 0), 0);
  const note = cleanNotes(session.notes);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <TouchableOpacity
        onPress={() => exercises.length > 0 && setExpanded(e => !e)}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 10 }}
      >
        <View style={{ width: 3, height: 38, borderRadius: 2, backgroundColor: accent }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>
            {fmtDate(session.date)}
          </Text>
          {exercises.length > 0 ? (
            <>
              <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }} numberOfLines={1}>
                {exercises.map(e => e.exercise_name).join(', ')}
              </Text>
              <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 1 }}>
                {`${exercises.length} exercise${exercises.length > 1 ? 's' : ''} · ${totalSets} set${totalSets !== 1 ? 's' : ''}`}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
              {note ?? 'Strength session'}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          {session.total_volume ? (
            <Text style={{ fontSize: typography.sm, color: accent, fontWeight: weight.semibold }}>
              {session.total_volume.toLocaleString()} kg
            </Text>
          ) : null}
          {session.duration_min ? (
            <Text style={{ fontSize: 11, color: colors.textDim }}>{session.duration_min} min</Text>
          ) : null}
        </View>
        {exercises.length > 0 && (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14} color={colors.textDim}
          />
        )}
      </TouchableOpacity>

      {expanded && exercises.length > 0 && (
        <View style={{ paddingLeft: 13, paddingBottom: 10, gap: 10 }}>
          {exercises.map((ex) => {
            const sets = (ex.sets ?? []).slice().sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0));
            return (
              <View key={ex.id}>
                <Text style={{ fontSize: typography.xs, fontWeight: weight.bold, color: colors.accent, marginBottom: 4 }}>
                  {ex.exercise_name}
                </Text>
                {sets.length === 0 ? (
                  <Text style={{ fontSize: 11, color: colors.textDim }}>No sets logged</Text>
                ) : (
                  <View>
                    {/* Header */}
                    <View style={{ flexDirection: 'row', paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      {['Set', 'Weight', 'Reps', 'RPE'].map(h => (
                        <Text key={h} style={{ flex: 1, fontSize: 10, color: colors.textDim, fontWeight: weight.bold }}>
                          {h}
                        </Text>
                      ))}
                    </View>
                    {sets.map((s, i) => (
                      <View key={i} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                        <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted }}>#{s.set_number ?? i + 1}</Text>
                        <Text style={{ flex: 1, fontSize: 12, color: colors.text, fontWeight: weight.semibold }}>
                          {s.weight_kg ? `${s.weight_kg} kg` : '—'}
                        </Text>
                        <Text style={{ flex: 1, fontSize: 12, color: colors.text }}>{s.reps ?? '—'}</Text>
                        <Text style={{ flex: 1, fontSize: 12, color: colors.textDim }}>{s.rpe ?? '—'}</Text>
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

function SleepRow({ entry, colors }) {
  const color = sleepBarColor(entry.quality);
  const pct = Math.min(1, (entry.hours ?? 0) / 10);
  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: typography.xs, color: colors.textMuted }}>{fmtDate(entry.logged_at)}</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {entry.quality ? (
            <View style={{ backgroundColor: color + '33', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, color, fontWeight: weight.bold }}>{qualityLabel(entry.quality)}</Text>
            </View>
          ) : null}
          <Text style={{ fontSize: typography.xs, color: colors.text, fontWeight: weight.semibold }}>
            {entry.hours ? `${entry.hours}h` : '—'}
          </Text>
        </View>
      </View>
      <View style={{ height: 8, backgroundColor: colors.bgElevated, borderRadius: 4 }}>
        <View style={{ height: 8, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      {entry.notes ? (
        <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 3 }} numberOfLines={1}>
          {entry.notes}
        </Text>
      ) : null}
    </View>
  );
}

function WeightHistoryRow({ entry, prev, colors }) {
  const delta = prev ? (entry.weight - prev.weight).toFixed(1) : null;
  const deltaColor = delta === null ? colors.textDim
    : parseFloat(delta) < 0 ? '#34d399'
    : parseFloat(delta) > 0 ? '#f87171'
    : colors.textDim;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ flex: 1, fontSize: typography.xs, color: colors.textMuted }}>{fmtDate(entry.logged_at)}</Text>
      <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>{entry.weight} kg</Text>
      {delta !== null && (
        <Text style={{ fontSize: 11, color: deltaColor, marginLeft: 10, width: 54, textAlign: 'right' }}>
          {parseFloat(delta) > 0 ? '+' : ''}{delta} kg
        </Text>
      )}
    </View>
  );
}

function LockedSection({ label, colors }) {
  return (
    <View style={{
      backgroundColor: colors.bgCard, borderRadius: 14,
      borderWidth: 1, borderColor: colors.border,
      borderStyle: 'dashed', padding: 20,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    }}>
      <View style={{
        width: 38, height: 38, borderRadius: 19,
        backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name="lock-closed" size={18} color={colors.textDim} />
      </View>
      <View>
        <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.textMuted }}>
          {label} hidden
        </Text>
        <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
          Client has restricted access to this section
        </Text>
      </View>
    </View>
  );
}

function CoachNotes({ clientId, colors }) {
  const key = `fitzo:coachNote:${clientId}`;
  const [note, setNote] = useState('');
  const loaded = React.useRef(false);

  React.useEffect(() => {
    AsyncStorage.getItem(key).then(v => { if (v !== null) setNote(v); loaded.current = true; });
  }, [key]);

  return (
    <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Ionicons name="pencil-outline" size={16} color={colors.accent} />
        <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>Private Coach Note</Text>
        <Text style={{ fontSize: 10, color: colors.textDim, marginLeft: 'auto' }}>auto-saved</Text>
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        onBlur={() => loaded.current && AsyncStorage.setItem(key, note)}
        placeholder="Add private notes about this client..."
        placeholderTextColor={colors.textDim}
        multiline
        textAlignVertical="top"
        style={{ fontSize: typography.sm, color: colors.text, minHeight: 80, lineHeight: 20 }}
      />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ClientDetailScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { clientId, clientName } = useRoute().params ?? {};

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['clientDetail', clientId],
    queryFn: () => fetchClientDetail(clientId),
    enabled: !!clientId,
    staleTime: 0, gcTime: 0,
  });

  const { profile, workouts = [], weights = [], steps = [], food = [], sleep = [] } = data ?? {};

  // Privacy visibility (defaults to all visible if client hasn't set)
  const vis = { workouts: true, weight: true, steps: true, sleep: true, food: true, ...(profile?.coach_visibility ?? {}) };

  // ── Derived ────────────────────────────────────────────────────────────────
  const last7Workouts = workouts.filter(w => {
    const d = new Date(w.date);
    return Date.now() - d.getTime() <= 7 * 86400000;
  });

  const avgSteps7 = Math.round(avg(steps, 'steps'));

  const dayFood = useMemo(() => {
    const map = {};
    food.forEach(f => {
      const day = (f.logged_at ?? '').slice(0, 10);
      if (!map[day]) map[day] = { cal: 0, protein: 0, carbs: 0, fats: 0 };
      map[day].cal     += f.calories ?? 0;
      map[day].protein += f.protein  ?? 0;
      map[day].carbs   += f.carbs    ?? 0;
      map[day].fats    += f.fats     ?? 0;
    });
    return map;
  }, [food]);

  const avgCals = useMemo(() => {
    const days = Object.values(dayFood);
    return days.length ? Math.round(days.reduce((s, d) => s + d.cal, 0) / days.length) : 0;
  }, [dayFood]);

  const avgSleep7 = avg(sleep, 'hours');

  const weightSparkData = useMemo(() =>
    weights.slice(0, 14).reverse().map(w => w.weight), [weights]);

  const currentWeight = weights[0]?.weight;
  const oldestWeight  = weights[weights.length - 1]?.weight;
  const weightDelta   = currentWeight && oldestWeight && weights.length > 1
    ? (currentWeight - oldestWeight).toFixed(1) : null;

  const goalWeight = profile?.weight_goal_kg;

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: typography.lg, fontWeight: weight.bold, color: colors.text }}>
            {clientName ?? 'Client'}
          </Text>
          {profile?.goal ? (
            <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 1 }}>Goal: {profile.goal}</Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 50 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />}
      >
        {/* ── 4 Stat Tiles ─────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          <StatTile
            label="Workouts (30d)"
            value={vis.workouts ? workouts.length : '🔒'}
            icon="barbell-outline" colors={colors}
            accent={vis.workouts ? colors.accent : colors.textDim}
          />
          <StatTile
            label="Avg Steps (7d)"
            value={!vis.steps ? '🔒' : avgSteps7 > 0 ? avgSteps7.toLocaleString() : '—'}
            icon="footsteps-outline" colors={colors}
            accent={vis.steps ? colors.accent : colors.textDim}
            sub={vis.steps && profile?.step_goal ? {
              text: `Goal: ${profile.step_goal.toLocaleString()}`,
              color: avgSteps7 >= profile.step_goal ? '#34d399' : '#f87171',
            } : null}
          />
          <StatTile
            label="Avg Sleep (7d)"
            value={!vis.sleep ? '🔒' : avgSleep7 > 0 ? fmt(avgSleep7) + 'h' : '—'}
            icon="moon-outline" colors={colors}
            accent={vis.sleep ? colors.accent : colors.textDim}
            sub={vis.sleep && profile?.sleep_goal_hours ? {
              text: `Goal: ${profile.sleep_goal_hours}h`,
              color: avgSleep7 >= profile.sleep_goal_hours ? '#34d399' : '#f87171',
            } : null}
          />
          <StatTile
            label="Avg Cals (30d)"
            value={!vis.food ? '🔒' : avgCals > 0 ? avgCals.toLocaleString() : '—'}
            icon="flame-outline" colors={colors}
            accent={vis.food ? colors.accent : colors.textDim}
            sub={vis.food && profile?.calorie_target ? {
              text: `Target: ${profile.calorie_target}`,
              color: Math.abs(avgCals - profile.calorie_target) < 200 ? '#34d399' : '#fbbf24',
            } : null}
          />
        </View>

        {/* ── Weight ───────────────────────────────────────────────── */}
        <SectionLabel title="Weight (30d)" colors={colors}
          right={!vis.weight && <Ionicons name="lock-closed" size={13} color={colors.textDim} />}
        />
        {!vis.weight ? <LockedSection label="Weight" colors={colors} /> :
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 28, fontWeight: weight.bold, color: colors.text }}>
                {currentWeight ? `${currentWeight} kg` : '—'}
              </Text>
              {weightDelta !== null && (
                <Text style={{ fontSize: 12, color: parseFloat(weightDelta) < 0 ? '#34d399' : parseFloat(weightDelta) > 0 ? '#f87171' : colors.textDim, marginTop: 2 }}>
                  {parseFloat(weightDelta) > 0 ? '+' : ''}{weightDelta} kg vs 30d ago
                </Text>
              )}
              {goalWeight && currentWeight && (
                <Text style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                  Goal: {goalWeight} kg · {Math.abs(currentWeight - goalWeight).toFixed(1)} kg to go
                </Text>
              )}
            </View>
            {weightSparkData.length > 1 && (
              <Sparkline data={weightSparkData} color={colors.accent} width={150} height={50} filled />
            )}
          </View>

          {/* Weight history list */}
          {weights.slice(0, 7).map((entry, i) => (
            <WeightHistoryRow key={i} entry={entry} prev={weights[i + 1]} colors={colors} />
          ))}
          {weights.length === 0 && (
            <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No weight logged</Text>
          )}
        </View>}

        {/* ── Last 7 Days Summary ───────────────────────────────────── */}
        <SectionLabel title="Last 7 Days" colors={colors} />
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 20, marginBottom: 10 }}>
            {[
              { label: 'Workouts', value: last7Workouts.length, icon: 'barbell-outline', color: colors.accent },
              { label: 'Sleep logs', value: sleep.length, icon: 'moon-outline', color: '#818cf8' },
              { label: 'Step logs', value: steps.length, icon: 'footsteps-outline', color: '#34d399' },
            ].map(item => (
              <View key={item.label} style={{ alignItems: 'center', gap: 3 }}>
                <Ionicons name={item.icon} size={16} color={item.color} />
                <Text style={{ fontSize: typography.lg, fontWeight: weight.bold, color: colors.text }}>{item.value}</Text>
                <Text style={{ fontSize: 10, color: colors.textDim }}>{item.label}</Text>
              </View>
            ))}
          </View>

          {/* Step bars per day */}
          {!vis.steps ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
              <Ionicons name="lock-closed" size={14} color={colors.textDim} />
              <Text style={{ fontSize: 12, color: colors.textDim }}>Step data hidden by client</Text>
            </View>
          ) : steps.length > 0 ? steps.slice(0, 7).reverse().map((s, i) => (
            <WeekDayRow
              key={i}
              label={fmtDate(s.logged_at)}
              value={s.steps}
              goal={profile?.step_goal ?? 0}
              color="#34d399"
              colors={colors}
            />
          )) : null}
        </View>

        {/* ── Workouts (expandable) ─────────────────────────────────── */}
        <SectionLabel
          title={`Workouts · ${workouts.length} sessions`}
          colors={colors}
          right={vis.workouts
            ? <Text style={{ fontSize: 10, color: colors.textDim }}>Tap to see sets</Text>
            : <Ionicons name="lock-closed" size={13} color={colors.textDim} />}
        />
        {!vis.workouts ? <LockedSection label="Workouts" colors={colors} /> :
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 }}>
          {workouts.length === 0 ? (
            <Text style={{ fontSize: typography.sm, color: colors.textDim, paddingVertical: 14 }}>No workouts in last 30 days</Text>
          ) : (
            workouts.map((session, i) => (
              <WorkoutRow key={session.id ?? i} session={session} colors={colors} />
            ))
          )}
        </View>}

        {/* ── Sleep (last 7 nights) ─────────────────────────────────── */}
        <SectionLabel title="Sleep · Last 7 nights" colors={colors}
          right={!vis.sleep && <Ionicons name="lock-closed" size={13} color={colors.textDim} />}
        />
        {!vis.sleep ? <LockedSection label="Sleep" colors={colors} /> :
        <View style={{ backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
          {sleep.length === 0 ? (
            <Text style={{ fontSize: typography.sm, color: colors.textDim }}>No sleep logged</Text>
          ) : (
            sleep.slice(0, 7).map((entry, i) => (
              <SleepRow key={i} entry={entry} colors={colors} />
            ))
          )}
          {avgSleep7 > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontSize: typography.xs, color: colors.textMuted }}>Average</Text>
              <Text style={{ fontSize: typography.sm, fontWeight: weight.bold, color: colors.text }}>{fmt(avgSleep7)}h</Text>
            </View>
          )}
        </View>}

        {/* ── Coach Notes ───────────────────────────────────────────── */}
        <SectionLabel title="Coach Notes" colors={colors} />
        <CoachNotes clientId={clientId} colors={colors} />

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
