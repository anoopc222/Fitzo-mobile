import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchPublicProfile(userId) {
  // profiles RLS only allows reading your own row, so public viewing goes
  // through the get_public_profile SECURITY DEFINER RPC, which itself only
  // returns data for the caller's own id or an accepted friend's id.
  const { data: rows, error } = await supabase.rpc('get_public_profile', { target_user_id: userId });
  if (error) throw error;
  const profile = rows?.[0] ?? null;

  const oneWeekAgo = localDateStr(new Date(Date.now() - 7 * 86400000));
  const [recentSessions, recentSteps] = await Promise.all([
    supabase.from('workout_sessions')
      .select('id, date, total_volume')
      .eq('user_id', userId)
      .gte('date', oneWeekAgo)
      .order('date', { ascending: false }),
    supabase.from('step_logs')
      .select('steps, logged_at')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(30),
  ]);

  const weeklyVolume = (recentSessions.data ?? []).reduce((s, r) => s + (r.total_volume ?? 0), 0);
  const weeklySessionCount = (recentSessions.data ?? []).length;

  // Consecutive-day step-logging streak, same logic pattern as HomeScreen.
  const loggedDates = new Set((recentSteps.data ?? []).map(s => s.logged_at.slice(0, 10)));
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = localDateStr(new Date(Date.now() - i * 86400000));
    if (loggedDates.has(d)) streak++;
    else if (i > 0) break;
  }

  return { profile, weeklyVolume, weeklySessionCount, streak };
}

export default function PublicProfileScreen({ route, navigation }) {
  const { userId, name } = route.params ?? {};
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['publicProfile', userId],
    queryFn: () => fetchPublicProfile(userId),
    enabled: !!userId,
  });

  const displayName = data?.profile?.full_name || name || t('friends.unnamed');

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title={t('publicProfile.title')} colors={colors} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : !data?.profile ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="lock-closed-outline" size={28} color={colors.textDim} />
            <Text style={styles.emptyText}>{t('publicProfile.notAvailable')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.headerCard}>
              <View style={styles.avatarBig}>
                <Text style={styles.avatarBigText}>{displayName[0]?.toUpperCase() ?? '?'}</Text>
              </View>
              <Text style={styles.name}>{displayName}</Text>
              {data.profile.goal ? <Text style={styles.goal}>{data.profile.goal}</Text> : null}
              {data.profile.bio ? <Text style={styles.bio}>{data.profile.bio}</Text> : null}
            </View>

            <View style={styles.statsRow}>
              <StatTile icon="barbell" value={data.weeklySessionCount} label={t('publicProfile.workoutsThisWeek')} colors={colors} />
              <StatTile icon="trending-up" value={Math.round(data.weeklyVolume)} label={t('publicProfile.weeklyVolume')} colors={colors} />
              <StatTile icon="flame" value={data.streak} label={t('publicProfile.dayStreak')} colors={colors} />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatTile({ icon, value, label, colors }) {
  const styles = useMemo(() => createTileStyles(colors), [colors]);
  return (
    <View style={styles.tile}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },

  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: typography.base, color: colors.text, fontWeight: weight.semibold },

  headerCard: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  avatarBig: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarBigText: { color: colors.bg, fontWeight: weight.black, fontSize: typography.xl },
  name: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  goal: { fontSize: typography.sm, color: colors.accent, fontWeight: weight.semibold },
  bio: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 20, marginTop: 4 },

  statsRow: { flexDirection: 'row', gap: 10 },
});

const createTileStyles = (colors) => StyleSheet.create({
  tile: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', paddingVertical: 16, gap: 4,
  },
  tileValue: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  tileLabel: { fontSize: typography.xs, color: colors.textDim, textAlign: 'center' },
});
