import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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

const TREND_SCORE = { up: 2, flat: 1, down: 0 };

const SORT_OPTIONS = [
  { key: 'recent',   label: 'Recent' },
  { key: 'name',     label: 'Name' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'trend',    label: 'Improving' },
];

// Epley formula — standard estimated-1RM approximation from a sub-max set.
function epley1RM(weightKg, reps) {
  if (!weightKg || !reps) return 0;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function calcVolumePR(sessions) {
  return sessions.reduce((best, s) => (s.volume > (best.volume ?? 0) ? { volume: s.volume, date: s.date } : best), { volume: 0, date: null });
}

function calcRepPR(sessions) {
  let best = { reps: 0, weight_kg: 0, date: null };
  for (const s of sessions) {
    for (const st of s.sets) {
      if ((st.reps ?? 0) > best.reps) best = { reps: st.reps, weight_kg: st.weight_kg ?? 0, date: s.date };
    }
  }
  return best;
}

function calcRpeTrend(sessions) {
  const rpesOf = (arr) => arr.flatMap(s => s.sets.map(st => st.rpe).filter(Boolean));
  const recent = rpesOf(sessions.slice(0, 3));
  const older = rpesOf(sessions.slice(3, 6));
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  if (!older.length) return { trend: null, avgRecent: recent.length ? Math.round(avg(recent) * 10) / 10 : null };
  const diff = avg(recent) - avg(older);
  const trend = diff > 0.3 ? 'up' : diff < -0.3 ? 'down' : 'flat';
  return { trend, avgRecent: recent.length ? Math.round(avg(recent) * 10) / 10 : null };
}

function avgDaysBetweenSessions(sessions) {
  if (sessions.length < 2) return null;
  let totalDays = 0;
  for (let i = 0; i < sessions.length - 1; i++) {
    totalDays += Math.abs(new Date(sessions[i].date) - new Date(sessions[i + 1].date)) / 86400000;
  }
  return Math.round(totalDays / (sessions.length - 1));
}

function enrichExercise(ex) {
  const pr = ex.sessions.reduce((best, s) => {
    const topSet = s.sets.reduce((b, st) => (st.weight_kg ?? 0) > (b.weight_kg ?? 0) ? st : b, { weight_kg: 0 });
    return (topSet.weight_kg ?? 0) > (best.kg ?? 0) ? { kg: topSet.weight_kg, date: s.date } : best;
  }, { kg: 0, date: null });
  const trend = calcTrend(ex.sessions);
  const [latest, prev] = ex.sessions;
  const volumeDelta = latest && prev ? latest.volume - prev.volume : null;
  const weightDelta = latest && prev ? (latest.bestSet?.weight_kg ?? 0) - (prev.bestSet?.weight_kg ?? 0) : null;
  const e1rm = latest?.bestSet ? epley1RM(latest.bestSet.weight_kg, latest.bestSet.reps) : 0;
  const volumePR = calcVolumePR(ex.sessions);
  const repPR = calcRepPR(ex.sessions);
  const { trend: rpeTrend, avgRecent: avgRecentRpe } = calcRpeTrend(ex.sessions);
  const avgDaysBetween = avgDaysBetweenSessions(ex.sessions);
  return {
    ...ex, pr, trend, daysSinceLast: daysSince(latest?.date), volumeDelta, weightDelta, e1rm,
    volumePR, repPR, rpeTrend, avgRecentRpe, avgDaysBetween,
  };
}

function TrendIcon({ trend }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!trend) return null;
  const map = {
    up: { icon: 'trending-up', color: colors.success, label: t('progress.trendImproving') },
    down: { icon: 'trending-down', color: colors.danger, label: t('progress.trendDeclining') },
    flat: { icon: 'remove', color: colors.textMuted, label: t('progress.trendPlateau') },
  };
  const { icon, color, label } = map[trend];
  return (
    <View style={[styles.trendBadge, { borderColor: color + '44', backgroundColor: color + '15' }]}>
      <Ionicons name={icon} size={12} color={color} />
      <Text style={[styles.trendText, { color }]}>{label}</Text>
    </View>
  );
}

export default function ProgressScreen({ navigation, embedded = false } = {}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { hasAccess } = useSubscription();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [expandedEx, setExpandedEx] = useState(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [sortBy, setSortBy] = useState('recent');

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
  const enriched = useMemo(() => grouped.map(enrichExercise), [grouped]);

  const overview = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const cutoff30 = Date.now() - 30 * 86400000;
    let totalVolumeThisMonth = 0;
    let prsThisMonth = 0;
    let mostImproved = null;
    const recentPRs = [];
    for (const ex of enriched) {
      for (const s of ex.sessions) {
        if (s.date?.slice(0, 7) === monthKey) totalVolumeThisMonth += s.volume;
      }
      if (ex.pr.date?.slice(0, 7) === monthKey) prsThisMonth += 1;
      if (ex.weightDelta > 0 && (!mostImproved || ex.weightDelta > mostImproved.delta)) {
        mostImproved = { name: ex.name, delta: ex.weightDelta };
      }
      if (ex.pr.date && new Date(ex.pr.date).getTime() >= cutoff30) {
        recentPRs.push({ name: ex.name, type: 'weight', value: ex.pr.kg, date: ex.pr.date });
      }
      if (ex.volumePR.date && new Date(ex.volumePR.date).getTime() >= cutoff30) {
        recentPRs.push({ name: ex.name, type: 'volume', value: ex.volumePR.volume, date: ex.volumePR.date });
      }
    }
    recentPRs.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { totalVolumeThisMonth, prsThisMonth, mostImproved, recentPRs: recentPRs.slice(0, 8) };
  }, [enriched]);

  const filtered = useMemo(() => {
    if (!search.trim()) return enriched;
    const q = search.toLowerCase();
    return enriched.filter(ex => ex.name.toLowerCase().includes(q));
  }, [enriched, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'name') arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'sessions') arr.sort((a, b) => b.sessions.length - a.sessions.length);
    else if (sortBy === 'trend') arr.sort((a, b) => (TREND_SCORE[b.trend] ?? -1) - (TREND_SCORE[a.trend] ?? -1));
    else arr.sort((a, b) => new Date(b.sessions[0]?.date ?? 0) - new Date(a.sessions[0]?.date ?? 0));
    return arr;
  }, [filtered, sortBy]);

  const toggleExpand = (name) => setExpandedEx(prev => prev === name ? null : name);

  const Wrap = embedded ? View : SafeAreaView;

  return (
    <Wrap style={styles.safe}>
      {!embedded && <ScreenHeader title={t('progress.headerTitle')} colors={colors} onBack={() => navigation.goBack()} />}
      <Text style={styles.subtitle}>{t('progress.exercisesTracked', { count: grouped.length })}</Text>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textDim} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('progress.searchPlaceholder')}
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

      {grouped.length > 0 && (
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortChip, sortBy === opt.key && styles.sortChipActive]}
              onPress={() => setSortBy(opt.key)}
            >
              <Text style={[styles.sortChipText, sortBy === opt.key && styles.sortChipTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
      <>
        {isLoading && <SkeletonScreen cards={5} linesPerCard={3} />}
        {!isLoading && grouped.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="barbell-outline" size={48} color={colors.textDim} />
            <Text style={styles.emptyTitle}>{t('progress.emptyTitle')}</Text>
            <Text style={styles.emptySub}>{t('progress.emptySub')}</Text>
          </View>
        )}
        {!isLoading && filtered.length === 0 && search.length > 0 && (
          <Text style={styles.noResults}>{t('progress.noResults', { search })}</Text>
        )}

        {sorted.map((ex, exIndex) => {
          const isExpanded = expandedEx === ex.name;
          const last3 = ex.sessions.slice(0, 3);
          const { pr, trend, daysSinceLast, volumeDelta, e1rm } = ex;

          const unlocked = hasAccess || exIndex < 2;
          const onHeaderPress = () => unlocked ? toggleExpand(ex.name) : setShowPaywall(true);

          return (
            <View key={ex.name} style={styles.exCard}>
              <TouchableOpacity style={styles.exHeader} onPress={onHeaderPress} activeOpacity={0.8}>
                <View style={styles.exHeaderLeft}>
                  <Text style={styles.exName}>{ex.name}</Text>
                  <View style={styles.exMeta}>
                    <Text style={styles.exSessions}>{t('progress.sessionsCount', { count: ex.sessions.length })}</Text>
                    {unlocked && daysSinceLast != null && (
                      <Text style={styles.daysSinceText}>
                        {daysSinceLast === 0 ? t('progress.trainedToday') : t('progress.daysSinceLast', { count: daysSinceLast })}
                      </Text>
                    )}
                    {unlocked && <TrendIcon trend={trend} />}
                  </View>
                </View>
                <View style={styles.exHeaderRight}>
                  {!unlocked ? (
                    <View style={styles.proBadge}>
                      <Ionicons name="lock-closed" size={10} color={colors.textMuted} />
                      <Text style={styles.proBadgeText}>{t('progress.proBadge')}</Text>
                    </View>
                  ) : pr.kg > 0 ? (
                    <View style={styles.prBadgeStack}>
                      <View style={styles.prBadge}>
                        <Ionicons name="trophy" size={11} color={colors.warning} />
                        <Text style={styles.prText}>{t('progress.prBadge', { kg: pr.kg })}</Text>
                      </View>
                      {e1rm > 0 && <Text style={styles.e1rmText}>{t('progress.e1rm', { kg: e1rm })}</Text>}
                    </View>
                  ) : null}
                  {unlocked && (
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
                        {unlocked ? new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '●●●'}
                      </Text>
                      <Text style={styles.previewBest}>
                        {unlocked ? `${s.bestSet?.weight_kg ?? '--'} kg × ${s.bestSet?.reps ?? '--'}` : '●● kg × ●●'}
                      </Text>
                      <Text style={styles.previewVol}>{unlocked ? t('progress.kgVolLabel', { value: s.volume.toLocaleString() }) : t('progress.kgVolMasked')}</Text>
                      {unlocked && i === 0 && volumeDelta != null && volumeDelta !== 0 && (
                        <Text style={[styles.deltaText, { color: volumeDelta > 0 ? colors.success : colors.danger }]}>
                          {volumeDelta > 0 ? '+' : ''}{Math.round(volumeDelta).toLocaleString()}
                        </Text>
                      )}
                      {unlocked && i === 0 && <View style={[styles.statusDot, { backgroundColor: colors.success }]} />}
                      {unlocked && i === 1 && <View style={[styles.statusDot, { backgroundColor: colors.warning }]} />}
                      {unlocked && i === 2 && <View style={[styles.statusDot, { backgroundColor: colors.textDim }]} />}
                    </View>
                  ))}
                  {!unlocked && (
                    <Text style={styles.lockedHint} onPress={() => setShowPaywall(true)}>
                      {t('progress.lockedHint')}
                    </Text>
                  )}
                </View>
              )}

              {/* Expanded full history */}
              {unlocked && isExpanded && (
                <View style={styles.fullHistory}>
                  {pr.kg > 0 && (
                    <View style={styles.prRow}>
                      <Ionicons name="trophy" size={14} color={colors.warning} />
                      <Text style={styles.prRowText}>{t('progress.personalBest', { kg: pr.kg })}</Text>
                      {pr.date && <Text style={styles.prDate}>{new Date(pr.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>}
                    </View>
                  )}

                  <View style={styles.statsGrid}>
                    {ex.volumePR.volume > 0 && (
                      <View style={styles.statChip}>
                        <Text style={styles.statChipLabel}>{t('progress.volumePr')}</Text>
                        <Text style={styles.statChipValue}>{t('progress.kgVolLabel', { value: ex.volumePR.volume.toLocaleString() })}</Text>
                      </View>
                    )}
                    {ex.repPR.reps > 0 && (
                      <View style={styles.statChip}>
                        <Text style={styles.statChipLabel}>{t('progress.repPr')}</Text>
                        <Text style={styles.statChipValue}>{t('progress.repPrValue', { reps: ex.repPR.reps, kg: ex.repPR.weight_kg })}</Text>
                      </View>
                    )}
                    {ex.avgDaysBetween != null && (
                      <View style={styles.statChip}>
                        <Text style={styles.statChipLabel}>{t('progress.frequency')}</Text>
                        <Text style={styles.statChipValue}>{t('progress.frequencyValue', { count: ex.avgDaysBetween })}</Text>
                      </View>
                    )}
                    {ex.avgRecentRpe != null && (
                      <View style={styles.statChip}>
                        <Text style={styles.statChipLabel}>{t('progress.avgRpe')}</Text>
                        <View style={styles.statChipValueRow}>
                          <Text style={styles.statChipValue}>{ex.avgRecentRpe}</Text>
                          {ex.rpeTrend && (
                            <Ionicons
                              name={ex.rpeTrend === 'up' ? 'trending-up' : ex.rpeTrend === 'down' ? 'trending-down' : 'remove'}
                              size={11}
                              color={ex.rpeTrend === 'up' ? colors.danger : ex.rpeTrend === 'down' ? colors.success : colors.textMuted}
                            />
                          )}
                        </View>
                      </View>
                    )}
                  </View>

                  <Text style={styles.histSectionLabel}>{t('progress.lastSessions', { count: Math.min(ex.sessions.length, 10) })}</Text>
                  {ex.sessions.slice(0, 10).map((s, i) => {
                    const validSets = s.sets.filter(st => (st.reps ?? 0) > 0);
                    if (validSets.length === 0 && s.volume === 0) return null;
                    return (
                      <View key={i} style={styles.histSessionRow}>
                        <Text style={styles.histDate}>
                          {new Date(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </Text>
                        <View style={styles.histSets}>
                          {validSets.slice(0, 5).map((st, j) => (
                            <Text key={j} style={styles.histSet}>
                              {(st.weight_kg ?? 0) > 0 ? st.weight_kg : 'BW'}×{st.reps}{st.rpe ? `@${st.rpe}` : ''}
                            </Text>
                          ))}
                          {validSets.length > 5 && (
                            <Text style={styles.histMoreSets}>{t('progress.moreSets', { count: validSets.length - 5 })}</Text>
                          )}
                        </View>
                        <Text style={styles.histVol}>{s.volume.toLocaleString()}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
        <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
      </>
      </ScrollView>
    </Wrap>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text },
  subtitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, marginTop: 4, paddingHorizontal: 20 },
  overviewRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
  overviewCard: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center',
  },
  overviewValue: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  overviewValueSmall: { fontSize: typography.xs },
  overviewLabel: { fontSize: 9, color: colors.textDim, marginTop: 2, textAlign: 'center' },

  recentPrsSection: { marginTop: 10, marginBottom: 4 },
  recentPrsTitle: { fontSize: 10, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.6, paddingHorizontal: 16, marginBottom: 6, textTransform: 'uppercase' },
  recentPrsContent: { paddingHorizontal: 16, gap: 8 },
  recentPrCard: {
    backgroundColor: colors.bgCard, borderRadius: 12, borderWidth: 1, borderColor: colors.warning + '33',
    paddingVertical: 8, paddingHorizontal: 10, width: 110, gap: 2,
  },
  recentPrName: { fontSize: 10, color: colors.text, fontWeight: weight.semibold, marginTop: 2 },
  recentPrValue: { fontSize: 11, color: colors.warning, fontWeight: weight.bold },
  recentPrDate: { fontSize: 9, color: colors.textDim },

  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
  sortChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
  },
  sortChipActive: { backgroundColor: colors.accent + '20', borderColor: colors.accent },
  sortChipText: { fontSize: 12, color: colors.textMuted, fontWeight: weight.medium },
  sortChipTextActive: { color: colors.accent, fontWeight: weight.bold },

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
  daysSinceText: { fontSize: 10, color: colors.textDim },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  trendText: { fontSize: 9, fontWeight: weight.bold },
  exHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.warning + '20', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10,
    borderWidth: 1, borderColor: colors.warning + '44',
  },
  prText: { fontSize: 10, color: colors.warning, fontWeight: weight.bold },
  prBadgeStack: { alignItems: 'flex-end', gap: 3 },
  e1rmText: { fontSize: 9, color: colors.textDim },
  deltaText: { fontSize: 10, fontWeight: weight.bold },
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
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  statChip: {
    backgroundColor: colors.bgElevated, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
    minWidth: '47%', flexGrow: 1,
  },
  statChipLabel: { fontSize: 9, color: colors.textDim, marginBottom: 1 },
  statChipValue: { fontSize: 11, color: colors.text, fontWeight: weight.semibold },
  statChipValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
