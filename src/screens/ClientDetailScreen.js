import React, { useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import Sparkline from '../components/Sparkline';

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchClientDetail(clientId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [profile, recentWorkouts, recentWeights, recentSteps, recentFood, recentSleep] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, goal, weight_goal_kg, step_goal, calorie_target')
        .eq('id', clientId)
        .single(),
      supabase
        .from('workout_sessions')
        .select('date, total_volume, duration_min, calories_burned, notes')
        .eq('user_id', clientId)
        .gte('date', thirtyDaysAgo)
        .order('date', { ascending: false }),
      supabase
        .from('weight_logs')
        .select('weight, logged_at')
        .eq('user_id', clientId)
        .gte('logged_at', thirtyDaysAgo + 'T00:00:00')
        .order('logged_at', { ascending: false }),
      supabase
        .from('step_logs')
        .select('steps, logged_at')
        .eq('user_id', clientId)
        .gte('logged_at', thirtyDaysAgo + 'T00:00:00')
        .order('logged_at', { ascending: false })
        .limit(30),
      supabase
        .from('food_logs')
        .select('calories, logged_at')
        .eq('user_id', clientId)
        .gte('logged_at', thirtyDaysAgo + 'T00:00:00'),
      supabase
        .from('sleep_logs')
        .select('hours, quality, logged_at')
        .eq('user_id', clientId)
        .gte('logged_at', thirtyDaysAgo + 'T00:00:00')
        .order('logged_at', { ascending: false })
        .limit(14),
    ]);

  return {
    profile: profile.data,
    recentWorkouts: recentWorkouts.data ?? [],
    recentWeights: recentWeights.data ?? [],
    recentSteps: recentSteps.data ?? [],
    recentFood: recentFood.data ?? [],
    recentSleep: recentSleep.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avg(arr, key) {
  if (!arr.length) return 0;
  const sum = arr.reduce((s, x) => s + (x[key] ?? 0), 0);
  return sum / arr.length;
}

function fmt(n, decimals = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function workoutRowColor(notes, colors) {
  if (!notes) return colors.accent;
  const n = notes.toLowerCase();
  if (n.includes('rest')) return colors.textDim;
  if (n.includes('cardio') || n.includes('run') || n.includes('cycle') || n.includes('swim'))
    return '#22d3ee'; // cyan
  return colors.accent;
}

function sleepBarColor(quality) {
  if (!quality) return '#6b7280';
  if (quality <= 2) return '#f87171'; // red
  if (quality === 3) return '#fbbf24'; // amber
  return '#34d399'; // green
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ title, colors }) {
  return (
    <Text
      style={{
        fontSize: typography.xs,
        fontWeight: weight.bold,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginTop: 20,
        marginBottom: 10,
      }}
    >
      {title}
    </Text>
  );
}

function StatTile({ label, value, unit, icon, colors }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bgCard,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        alignItems: 'center',
        gap: 4,
      }}
    >
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text
        style={{
          fontSize: typography.lg,
          fontWeight: weight.bold,
          color: colors.text,
          textAlign: 'center',
        }}
      >
        {value}
        {unit ? (
          <Text style={{ fontSize: typography.xs, color: colors.textMuted }}> {unit}</Text>
        ) : null}
      </Text>
      <Text style={{ fontSize: typography.xs, color: colors.textMuted, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  );
}

function WorkoutRow({ session, colors }) {
  const accent = workoutRowColor(session.notes, colors);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 10,
      }}
    >
      <View
        style={{
          width: 3,
          height: 36,
          borderRadius: 2,
          backgroundColor: accent,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>
          {fmtDate(session.date)}
        </Text>
        {session.notes ? (
          <Text
            style={{ fontSize: typography.xs, color: colors.textMuted, marginTop: 1 }}
            numberOfLines={1}
          >
            {session.notes}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ fontSize: typography.sm, color: accent, fontWeight: weight.semibold }}>
          {session.total_volume ? `${session.total_volume.toLocaleString()} kg` : '—'}
        </Text>
        <Text style={{ fontSize: typography.xs, color: colors.textDim }}>
          {session.duration_min ? `${session.duration_min} min` : ''}
        </Text>
      </View>
    </View>
  );
}

// Sleep bars using react-native-svg
function SleepChart({ sleepData, colors }) {
  const entries = sleepData.slice(0, 7).reverse();
  if (!entries.length) {
    return (
      <Text style={{ color: colors.textDim, fontSize: typography.sm }}>No sleep data</Text>
    );
  }

  const BAR_HEIGHT = 20;
  const BAR_GAP = 8;
  const LABEL_WIDTH = 42;
  const MAX_BAR = 220;
  const svgHeight = entries.length * (BAR_HEIGHT + BAR_GAP);

  return (
    <Svg width="100%" height={svgHeight} viewBox={`0 0 ${LABEL_WIDTH + MAX_BAR + 50} ${svgHeight}`}>
      {entries.map((entry, i) => {
        const y = i * (BAR_HEIGHT + BAR_GAP);
        const barW = Math.max(4, ((entry.hours ?? 0) / 10) * MAX_BAR);
        const barColor = sleepBarColor(entry.quality);
        return (
          <React.Fragment key={i}>
            <SvgText
              x={0}
              y={y + BAR_HEIGHT / 2 + 5}
              fontSize={10}
              fill={colors.textMuted}
            >
              {fmtDate(entry.logged_at)}
            </SvgText>
            <Rect
              x={LABEL_WIDTH}
              y={y}
              width={barW}
              height={BAR_HEIGHT}
              rx={4}
              fill={barColor}
              opacity={0.85}
            />
            <SvgText
              x={LABEL_WIDTH + barW + 6}
              y={y + BAR_HEIGHT / 2 + 4}
              fontSize={10}
              fill={colors.textMuted}
            >
              {entry.hours ? `${entry.hours}h` : '—'}
            </SvgText>
          </React.Fragment>
        );
      })}
    </Svg>
  );
}

// Coach notes with AsyncStorage auto-save
function CoachNotes({ clientId, colors }) {
  const storageKey = `fitzo:coachNote:${clientId}`;
  const [note, setNote] = React.useState('');
  const loaded = React.useRef(false);

  React.useEffect(() => {
    AsyncStorage.getItem(storageKey).then((val) => {
      if (val !== null) setNote(val);
      loaded.current = true;
    });
  }, [storageKey]);

  const handleBlur = () => {
    if (loaded.current) {
      AsyncStorage.setItem(storageKey, note);
    }
  };

  return (
    <View
      style={{
        backgroundColor: colors.bgCard,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Ionicons name="pencil-outline" size={16} color={colors.accent} />
        <Text style={{ fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text }}>
          Private Coach Note
        </Text>
        <Text style={{ fontSize: typography.xs, color: colors.textDim, marginLeft: 'auto' }}>
          auto-saved
        </Text>
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        onBlur={handleBlur}
        placeholder="Add private notes about this client..."
        placeholderTextColor={colors.textDim}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        style={{
          fontSize: typography.sm,
          color: colors.text,
          minHeight: 90,
          lineHeight: 20,
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function ClientDetailScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const route = useRoute();
  const { clientId, clientName } = route.params ?? {};

  const styles = useMemo(() => createStyles(colors), [colors]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['clientDetail', clientId],
    queryFn: () => fetchClientDetail(clientId),
    enabled: !!clientId,
    staleTime: 0,
    gcTime: 0,
  });

  const {
    recentWorkouts = [],
    recentWeights = [],
    recentSteps = [],
    recentFood = [],
    recentSleep = [],
  } = data ?? {};

  // Derived stats
  const avgSteps = Math.round(avg(recentSteps, 'steps'));
  const avgSleep = avg(recentSleep, 'hours');

  const daysWithFood = useMemo(() => {
    const days = new Set(
      recentFood.map((f) => (f.logged_at ?? '').slice(0, 10))
    );
    return days.size;
  }, [recentFood]);

  const totalCals = recentFood.reduce((s, f) => s + (f.calories ?? 0), 0);
  const avgCals = daysWithFood > 0 ? Math.round(totalCals / daysWithFood) : 0;

  // Weight sparkline — last 10, ascending for chart
  const weightSparkData = useMemo(
    () =>
      recentWeights
        .slice(0, 10)
        .reverse()
        .map((w) => w.weight),
    [recentWeights]
  );

  const currentWeight = recentWeights[0]?.weight;
  const oldestWeight = recentWeights[recentWeights.length - 1]?.weight;
  const weightDelta =
    currentWeight && oldestWeight && recentWeights.length > 1
      ? (currentWeight - oldestWeight).toFixed(1)
      : null;

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.clientName}>{clientName ?? 'Client'}</Text>
          <Text style={styles.headerSub}>Last 30 days</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
          <Text style={{ color: colors.textMuted, marginTop: 10 }}>Failed to load client data</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* ── Summary Stat Tiles ───────────────────────────────── */}
          <View style={styles.tilesRow}>
            <StatTile
              label="Workouts"
              value={recentWorkouts.length}
              unit="30d"
              icon="barbell-outline"
              colors={colors}
            />
            <StatTile
              label="Avg Steps"
              value={avgSteps > 0 ? avgSteps.toLocaleString() : '—'}
              icon="footsteps-outline"
              colors={colors}
            />
            <StatTile
              label="Avg Sleep"
              value={avgSleep > 0 ? fmt(avgSleep) : '—'}
              unit="hrs"
              icon="moon-outline"
              colors={colors}
            />
            <StatTile
              label="Avg Cals"
              value={avgCals > 0 ? avgCals.toLocaleString() : '—'}
              icon="flame-outline"
              colors={colors}
            />
          </View>

          {/* ── Weight Trend ─────────────────────────────────────── */}
          <SectionLabel title="Weight Trend (30d)" colors={colors} />
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10 }}>
              <View>
                <Text style={styles.bigValue}>
                  {currentWeight ? `${currentWeight} kg` : '—'}
                </Text>
                {weightDelta !== null ? (
                  <Text
                    style={{
                      fontSize: typography.xs,
                      color:
                        parseFloat(weightDelta) < 0
                          ? colors.good
                          : parseFloat(weightDelta) > 0
                          ? colors.danger
                          : colors.textMuted,
                      marginTop: 2,
                    }}
                  >
                    {parseFloat(weightDelta) > 0 ? '+' : ''}
                    {weightDelta} kg vs 30d ago
                  </Text>
                ) : null}
              </View>
              {weightSparkData.length > 1 ? (
                <Sparkline
                  data={weightSparkData}
                  color={colors.accent}
                  width={160}
                  height={50}
                  filled
                />
              ) : (
                <Text style={{ color: colors.textDim, fontSize: typography.sm }}>
                  Not enough data
                </Text>
              )}
            </View>
          </View>

          {/* ── Recent Workouts ──────────────────────────────────── */}
          <SectionLabel
            title={`Recent Workouts (${Math.min(7, recentWorkouts.length)} shown)`}
            colors={colors}
          />
          <View style={styles.card}>
            {recentWorkouts.length === 0 ? (
              <Text style={styles.emptyText}>No workouts logged</Text>
            ) : (
              recentWorkouts.slice(0, 7).map((session, i) => (
                <WorkoutRow
                  key={i}
                  session={session}
                  colors={colors}
                />
              ))
            )}
          </View>

          {/* ── Sleep Chart ──────────────────────────────────────── */}
          <SectionLabel title="Sleep (Last 7 nights)" colors={colors} />
          <View style={styles.card}>
            <SleepChart sleepData={recentSleep} colors={colors} />

            {/* Legend */}
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
              {[
                { label: 'Poor', color: '#f87171' },
                { label: 'Fair', color: '#fbbf24' },
                { label: 'Good', color: '#34d399' },
              ].map((item) => (
                <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      backgroundColor: item.color,
                    }}
                  />
                  <Text style={{ fontSize: typography.xs, color: colors.textMuted }}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* ── Coach Notes ──────────────────────────────────────── */}
          <SectionLabel title="Coach Notes" colors={colors} />
          <CoachNotes clientId={clientId} colors={colors} />

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const createStyles = (colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
    },
    backBtn: { padding: 2 },
    clientName: {
      fontSize: typography.lg,
      fontWeight: weight.bold,
      color: colors.text,
    },
    headerSub: {
      fontSize: typography.xs,
      color: colors.textDim,
      marginTop: 1,
    },

    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },

    content: { paddingHorizontal: 16, paddingBottom: 40 },

    tilesRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 6,
    },

    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 4,
    },

    bigValue: {
      fontSize: typography.xxl ?? 28,
      fontWeight: weight.bold,
      color: colors.text,
    },

    emptyText: {
      fontSize: typography.sm,
      color: colors.textDim,
      paddingVertical: 8,
    },
  });
