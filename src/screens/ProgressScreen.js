import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import PaywallModal from '../components/ui/PaywallModal';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';

export async function fetchProgress(userId) {
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('workout_exercises')
    .select(`
      id, exercise_name,
      sets ( id, set_number, weight_kg, reps, rpe ),
      workout_sessions!inner ( id, date, user_id )
    `)
    .eq('workout_sessions.user_id', userId)
    .gte('workout_sessions.date', oneYearAgo)
    .order('exercise_name', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

function groupByExercise(exercises) {
  const map = {};
  for (const ex of exercises) {
    const name = ex.exercise_name;
    if (!map[name]) map[name] = { name, sessions: [] };
    const bestSet = (ex.sets ?? []).reduce(
      (best, s) => ((s.weight_kg ?? 0) * (s.reps ?? 0) > (best.weight_kg ?? 0) * (best.reps ?? 0) ? s : best),
      { weight_kg: 0, reps: 0 }
    );
    map[name].sessions.push({
      date: ex.workout_sessions?.date,
      sets: ex.sets ?? [],
      bestSet,
      volume: (ex.sets ?? []).reduce((s, st) => s + (st.weight_kg ?? 0) * (st.reps ?? 0), 0),
    });
  }
  for (const name in map) {
    map[name].sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
}

function calcTrend(sessions) {
  if (sessions.length < 2) return null;
  const recent = sessions.slice(0, 3).map(s => s.bestSet?.weight_kg ?? 0);
  const older = sessions.slice(3, 6).map(s => s.bestSet?.weight_kg ?? 0);
  if (older.length === 0) return null;
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const diff = recentAvg - olderAvg;
  if (diff > 1) return 'up';
  if (diff < -1) return 'down';
  return 'flat';
}

function TrendIcon({ trend }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!trend) return null;
  const map = {
    up: { icon: 'trending-up', color: colors.success, label: 'Improving' },
    down: { icon: 'trending-down', color: colors.danger, label: 'Declining' },
    flat: { icon: 'remove', color: colors.textMuted, label: 'Plateau' },
  };
  const { icon, color, label } = map[trend];
  return (
    <View style={[styles.trendBadge, { borderColor: color + '44', backgroundColor: color + '15' }]}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.trendText, { color }]}>{label}</Text>
    </View>
  );
}

export default function ProgressScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { hasAccess } = useSubscription();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [expandedEx, setExpandedEx] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const { data: rawData = [], isLoading, refetch } = useQuery({
    queryKey: ['progress', user?.id],
    queryFn: () => fetchProgress(user.id),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const grouped = useMemo(() => groupByExercise(rawData), [rawData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped.filter(ex => ex.name.toLowerCase().includes(q));
  }, [grouped, search]);

  const toggleExpand = (name) => setExpandedEx(prev => prev === name ? null : name);

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="PROGRESS" colors={colors} onBack={() => navigation.goBack()} />
      <Text style={styles.subtitle}>{grouped.length} exercises tracked</Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textDim} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search exercises…"
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
      <>
        {isLoading && <SkeletonScreen cards={5} linesPerCard={3} />}
        {!isLoading && grouped.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="barbell-outline" size={48} color={colors.textDim} />
            <Text style={styles.emptyTitle}>No exercises logged yet</Text>
            <Text style={styles.emptySub}>Log workouts to track your progress</Text>
          </View>
        )}
        {!isLoading && filtered.length === 0 && search.length > 0 && (
          <Text style={styles.noResults}>No exercises match "{search}"</Text>
        )}

        {filtered.map((ex, exIndex) => {
          const isExpanded = expandedEx === ex.name;
          const last3 = ex.sessions.slice(0, 3);
          const pr = ex.sessions.reduce((best, s) => {
            const topSet = s.sets.reduce((b, st) => (st.weight_kg ?? 0) > (b.weight_kg ?? 0) ? st : b, { weight_kg: 0 });
            return (topSet.weight_kg ?? 0) > (best.kg ?? 0) ? { kg: topSet.weight_kg, date: s.date } : best;
          }, { kg: 0, date: null });
          const trend = calcTrend(ex.sessions);

          const onHeaderPress = () => hasAccess ? toggleExpand(ex.name) : setShowPaywall(true);

          return (
            <View key={ex.name} style={styles.exCard}>
              <TouchableOpacity style={styles.exHeader} onPress={onHeaderPress} activeOpacity={0.8}>
                <View style={styles.exHeaderLeft}>
                  <Text style={styles.exName}>{ex.name}</Text>
                  <View style={styles.exMeta}>
                    <Text style={styles.exSessions}>{ex.sessions.length} sessions</Text>
                    {hasAccess && <TrendIcon trend={trend} />}
                  </View>
                </View>
                <View style={styles.exHeaderRight}>
                  {!hasAccess ? (
                    <View style={styles.proBadge}>
                      <Ionicons name="lock-closed" size={10} color={colors.textMuted} />
                      <Text style={styles.proBadgeText}>PRO</Text>
                    </View>
                  ) : pr.kg > 0 ? (
                    <View style={styles.prBadge}>
                      <Ionicons name="trophy" size={11} color={colors.warning} />
                      <Text style={styles.prText}>PR {pr.kg}kg</Text>
                    </View>
                  ) : null}
                  {hasAccess && (
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16} color={colors.textMuted}
                    />
                  )}
                </View>
              </TouchableOpacity>

              {/* Last 3 sessions preview */}
              {last3.length > 0 && !isExpanded && (
                <View style={styles.sessionsPreview}>
                  {last3.map((s, i) => (
                    <View key={i} style={styles.sessionPreviewRow}>
                      <Text style={styles.previewDate}>
                        {hasAccess ? new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '●●●'}
                      </Text>
                      <Text style={styles.previewBest}>
                        {hasAccess ? `${s.bestSet?.weight_kg ?? '--'} kg × ${s.bestSet?.reps ?? '--'}` : '●● kg × ●●'}
                      </Text>
                      <Text style={styles.previewVol}>{hasAccess ? `${s.volume.toLocaleString()} kg vol` : '●●● kg vol'}</Text>
                      {hasAccess && i === 0 && <View style={[styles.statusDot, { backgroundColor: colors.success }]} />}
                      {hasAccess && i === 1 && <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />}
                      {hasAccess && i === 2 && <View style={[styles.statusDot, { backgroundColor: colors.textDim }]} />}
                    </View>
                  ))}
                  {!hasAccess && (
                    <Text style={styles.lockedHint} onPress={() => setShowPaywall(true)}>
                      🔒 Unlock PR badges, trend insights, and full session history
                    </Text>
                  )}
                </View>
              )}

              {/* Expanded full history */}
              {hasAccess && isExpanded && (
                <View style={styles.fullHistory}>
                  {pr.kg > 0 && (
                    <View style={styles.prRow}>
                      <Ionicons name="trophy" size={14} color={colors.warning} />
                      <Text style={styles.prRowText}>Personal Best: {pr.kg} kg</Text>
                      {pr.date && <Text style={styles.prDate}>{new Date(pr.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>}
                    </View>
                  )}
                  <Text style={styles.histSectionLabel}>LAST {Math.min(ex.sessions.length, 10)} SESSIONS</Text>
                  {ex.sessions.slice(0, 10).map((s, i) => (
                    <View key={i} style={styles.histSessionRow}>
                      <Text style={styles.histDate}>
                        {new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                      <View style={styles.histSets}>
                        {s.sets.slice(0, 5).map((st, j) => (
                          <Text key={j} style={styles.histSet}>
                            {st.weight_kg}×{st.reps}{st.rpe ? `@${st.rpe}` : ''}
                          </Text>
                        ))}
                        {s.sets.length > 5 && <Text style={styles.histMoreSets}>+{s.sets.length - 5} more</Text>}
                      </View>
                      <Text style={styles.histVol}>{s.volume.toLocaleString()}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
        <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
      </>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text },
  subtitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, marginTop: 4, paddingHorizontal: 20 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim },
  noResults: { textAlign: 'center', color: colors.textDim, marginTop: 30, fontSize: typography.sm },

  exCard: {
    backgroundColor: colors.bgCard, borderRadius: 16, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  exHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: 14,
  },
  exHeaderLeft: { flex: 1 },
  exName: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, marginBottom: 4 },
  exMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exSessions: { fontSize: 10, color: colors.textDim },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  trendText: { fontSize: 9, fontWeight: weight.bold },
  exHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.warning + '20', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10,
    borderWidth: 1, borderColor: colors.warning + '44',
  },
  prText: { fontSize: 10, color: colors.warning, fontWeight: weight.bold },
  proBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.bgElevated, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  proBadgeText: { fontSize: 9, fontWeight: weight.black, color: colors.textMuted, letterSpacing: 0.5 },
  lockedHint: { fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 16 },

  sessionsPreview: { paddingHorizontal: 14, paddingBottom: 12 },
  sessionPreviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 5, borderTopWidth: 1, borderTopColor: colors.border,
  },
  previewDate: { width: 50, fontSize: 10, color: colors.textMuted },
  previewBest: { flex: 1, fontSize: typography.xs, color: colors.text, fontWeight: weight.medium },
  previewVol: { fontSize: 10, color: colors.textDim },
  statusDot: { width: 7, height: 7, borderRadius: 4 },

  fullHistory: { paddingHorizontal: 14, paddingBottom: 12, borderTopWidth: 1, borderTopColor: colors.border },
  prRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10,
    backgroundColor: colors.warning + '15', borderRadius: 8, marginTop: 10, marginBottom: 8,
  },
  prRowText: { fontSize: typography.sm, color: colors.warning, fontWeight: weight.semibold, flex: 1 },
  prDate: { fontSize: 10, color: colors.textDim },
  histSectionLabel: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.8, marginBottom: 6, marginTop: 4 },
  histSessionRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.bgElevated,
  },
  histDate: { width: 50, fontSize: 10, color: colors.textMuted, paddingTop: 2 },
  histSets: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  histSet: {
    fontSize: 10, color: colors.text, fontWeight: weight.medium,
    backgroundColor: colors.bgElevated, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  histMoreSets: { fontSize: 10, color: colors.textDim },
  histVol: { fontSize: 10, color: colors.accent, fontWeight: weight.bold, minWidth: 50, textAlign: 'right' },
});
