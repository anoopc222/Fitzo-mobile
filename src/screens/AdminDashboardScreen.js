import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import { TRIAL_DAYS } from '../config/subscription';
import ScreenHeader from '../components/ScreenHeader';

const DB_LIMIT_BYTES = 500 * 1024 * 1024; // Supabase free-tier database cap

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

async function fetchDbUsage() {
  const { data, error } = await supabase.rpc('get_db_usage_stats');
  if (error) throw error;
  const rows = data ?? [];
  const totalBytes = rows[0]?.total_db_size_bytes ?? 0;
  const tables = rows
    .map(r => ({ name: r.table_name, bytes: r.table_size_bytes }))
    .slice(0, 8);
  return { totalBytes, tables };
}

async function fetchUsers() {
  const [{ data: profiles, error: pErr }, { data: subs, error: sErr }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email, is_admin, is_super_admin, created_at'),
    supabase.from('subscriptions').select('*'),
  ]);
  if (pErr) throw pErr;
  if (sErr) throw sErr;
  const subsByUser = Object.fromEntries((subs ?? []).map(s => [s.user_id, s]));
  return (profiles ?? []).map(p => {
    const sub = subsByUser[p.id];
    const trialEndsAt = p.created_at
      ? new Date(new Date(p.created_at).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
      : null;
    const isInTrial = trialEndsAt ? trialEndsAt.getTime() > Date.now() : false;
    const isPro = p.is_admin || sub?.status === 'active';
    return {
      ...p,
      sub,
      isInTrial,
      isPro,
      statusLabel: p.is_admin ? 'admin.statusAdmin' : isPro ? 'admin.statusPro' : isInTrial ? 'admin.statusTrial' : 'admin.statusFree',
    };
  });
}

function csvEscape(val) {
  const s = val === null || val === undefined ? '' : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminDashboardScreen({ navigation }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isSuperAdmin } = useSubscription();
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: users, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchUsers,
    staleTime: 0,
    gcTime: 0,
  });

  const [showDbUsage, setShowDbUsage] = useState(false);
  const { data: dbUsage, isLoading: dbUsageLoading, isFetching: dbUsageFetching, refetch: refetchDbUsage } = useQuery({
    queryKey: ['admin-db-usage'],
    queryFn: fetchDbUsage,
    staleTime: 0,
    gcTime: 0,
    enabled: showDbUsage,
  });


  const filtered = useMemo(() => {
    if (!users) return [];
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      (u.full_name ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q)
    );
  }, [users, search]);

  const summary = useMemo(() => {
    const list = users ?? [];
    return {
      total: list.length,
      pro: list.filter(u => u.isPro).length,
      trial: list.filter(u => !u.isPro && u.isInTrial).length,
      admins: list.filter(u => u.is_admin).length,
    };
  }, [users]);

  const handleExport = async () => {
    if (!users?.length) return;
    setExporting(true);
    try {
      const header = [
        t('admin.csvName'), t('admin.csvEmail'), t('admin.csvStatus'),
        t('admin.csvIsAdmin'), t('admin.csvIsSuperAdmin'), t('admin.csvPlan'),
        t('admin.csvStore'), t('admin.csvPeriodEnd'), t('admin.csvSignedUp'),
      ];
      const rows = users.map(u => [
        u.full_name ?? '', u.email ?? '', t(u.statusLabel),
        u.is_admin ? t('admin.csvYes') : t('admin.csvNo'), u.is_super_admin ? t('admin.csvYes') : t('admin.csvNo'),
        u.sub?.plan_id ?? '', u.sub?.store ?? '', u.sub?.period_end ?? '',
        u.created_at ?? '',
      ]);
      const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
      const path = `${FileSystem.cacheDirectory}fitzo-users-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: t('admin.exportDialogTitle') });
      } else {
        Alert.alert(t('admin.exportedTitle'), t('admin.exportedMessage', { path }));
      }
    } catch (e) {
      Alert.alert(t('admin.exportFailedTitle'), e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title={t('admin.headerTitle')}
        colors={colors}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity onPress={handleExport} disabled={exporting || !users?.length}>
            {exporting
              ? <ActivityIndicator color={colors.accent} />
              : <Ionicons name="download-outline" size={22} color={colors.accent} />}
          </TouchableOpacity>
        )}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={undefined}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.dbUsageTile}>
              <Text style={styles.sectionTitle}>{t('admin.databaseUsage')}</Text>
              {!showDbUsage ? (
                <TouchableOpacity
                  style={styles.showUsageBtn}
                  onPress={() => setShowDbUsage(true)}
                >
                  <Ionicons name="server-outline" size={16} color={colors.accent} />
                  <Text style={styles.showUsageBtnText}>{t('admin.showUsage')}</Text>
                </TouchableOpacity>
              ) : dbUsageLoading ? (
                <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
              ) : dbUsage ? (
                <>
                  <DbUsageCard usage={dbUsage} styles={styles} colors={colors} t={t} />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <TouchableOpacity
                      style={styles.showUsageBtn}
                      onPress={() => refetchDbUsage()}
                      disabled={dbUsageFetching}
                    >
                      {dbUsageFetching
                        ? <ActivityIndicator size="small" color={colors.accent} />
                        : <Ionicons name="refresh" size={16} color={colors.accent} />}
                      <Text style={styles.showUsageBtnText}>{t('admin.refresh')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.showUsageBtn}
                      onPress={() => setShowDbUsage(false)}
                    >
                      <Ionicons name="eye-off-outline" size={16} color={colors.textDim} />
                      <Text style={[styles.showUsageBtnText, { color: colors.textDim }]}>{t('admin.hide')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : null}
            </View>

            <View style={styles.statsGrid}>
              <StatCard label={t('admin.totalUsers')} value={summary.total} icon="people" color={colors.accent} styles={styles} />
              <StatCard label={t('admin.proUsers')} value={summary.pro} icon="star" color={colors.success} styles={styles} />
              <StatCard label={t('admin.inTrial')} value={summary.trial} icon="time" color={colors.warning} styles={styles} />
              <StatCard label={t('admin.admins')} value={summary.admins} icon="shield-checkmark" color={colors.purple} styles={styles} />
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('admin.searchPlaceholder')}
                placeholderTextColor={colors.textDim}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('admin.usersCount', { count: filtered.length })}</Text>
              {filtered.map(u => (
                <UserRow key={u.id} user={u} styles={styles} colors={colors} isSuperAdmin={isSuperAdmin} onChanged={refetch} t={t} />
              ))}
              {filtered.length === 0 && (
                <Text style={styles.emptyText}>{t('admin.noUsersMatch')}</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, icon, color, styles }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIconWrap, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function DbUsageCard({ usage, styles, colors, t }) {
  const pct = Math.min(100, (usage.totalBytes / DB_LIMIT_BYTES) * 100);
  const barColor = pct >= 90 ? colors.danger : pct >= 70 ? colors.warning : colors.success;
  const maxTableBytes = Math.max(1, ...usage.tables.map(tbl => tbl.bytes));

  return (
    <View style={styles.dbCard}>
      <View style={styles.dbHeaderRow}>
        <Text style={styles.dbTotalText}>{formatBytes(usage.totalBytes)}</Text>
        <Text style={styles.dbLimitText}> {t('admin.freeTierOf', { limit: formatBytes(DB_LIMIT_BYTES) })}</Text>
      </View>
      <View style={styles.dbBarTrack}>
        <View style={[styles.dbBarFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.dbPctText, { color: barColor }]}>{t('admin.percentUsed', { pct: pct.toFixed(1) })}</Text>

      <View style={{ marginTop: 12, gap: 8 }}>
        {usage.tables.map(tbl => (
          <View key={tbl.name} style={styles.dbTableRow}>
            <Text style={styles.dbTableName} numberOfLines={1}>{tbl.name}</Text>
            <View style={styles.dbTableBarTrack}>
              <View style={[styles.dbTableBarFill, { width: `${(tbl.bytes / maxTableBytes) * 100}%` }]} />
            </View>
            <Text style={styles.dbTableSize}>{formatBytes(tbl.bytes)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function statusColor(label, colors) {
  if (label === 'admin.statusAdmin') return colors.purple;
  if (label === 'admin.statusPro') return colors.success;
  if (label === 'admin.statusTrial') return colors.warning;
  return colors.textDim;
}

function UserRow({ user, styles, colors, isSuperAdmin, onChanged, t }) {
  const { setUserAdmin } = useSubscription();
  const [busy, setBusy] = useState(false);

  const toggleAdmin = () => {
    const makeAdmin = !user.is_admin;
    Alert.alert(
      makeAdmin ? t('admin.grantAdminTitle') : t('admin.revokeAdminTitle'),
      makeAdmin
        ? t('admin.grantAdminMessage', { email: user.email })
        : t('admin.revokeAdminMessage', { email: user.email }),
      [
        { text: t('admin.cancel'), style: 'cancel' },
        {
          text: makeAdmin ? t('admin.grant') : t('admin.revoke'),
          style: makeAdmin ? 'default' : 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await setUserAdmin(user.email, makeAdmin);
              onChanged?.();
            } catch (e) {
              Alert.alert(t('admin.errorTitle'), e.message);
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.userRow}>
      <View style={styles.userAvatar}>
        <Text style={styles.userAvatarText}>{(user.full_name?.[0] ?? user.email?.[0] ?? '?').toUpperCase()}</Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{user.full_name || t('admin.unnamed')}</Text>
        <Text style={styles.userEmail}>{user.email}</Text>
        {user.sub?.plan_id && (
          <Text style={styles.userPlan}>{user.sub.plan_id} · {user.sub.store ?? t('admin.unknownStore')}</Text>
        )}
      </View>
      <View style={styles.userRight}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(user.statusLabel, colors) + '20' }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor(user.statusLabel, colors) }]}>{t(user.statusLabel)}</Text>
        </View>
        {isSuperAdmin && !user.is_super_admin && (
          <TouchableOpacity style={styles.adminToggle} onPress={toggleAdmin} disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons
                name={user.is_admin ? 'shield-checkmark' : 'shield-outline'}
                size={18}
                color={user.is_admin ? colors.purple : colors.textDim}
              />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  content: { paddingHorizontal: 16, paddingBottom: 40 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 6 },
  statIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: typography.xl, fontWeight: weight.black, color: colors.text },
  statLabel: { fontSize: typography.xs, color: colors.textMuted },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: typography.sm, color: colors.text },

  section: { gap: 8 },
  sectionTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.8, marginBottom: 4, textTransform: 'uppercase' },
  emptyText: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', marginTop: 20 },

  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bgCard, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border },
  userAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent + '30', alignItems: 'center', justifyContent: 'center' },
  userAvatarText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent },
  userInfo: { flex: 1 },
  userName: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  userEmail: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  userPlan: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  userRight: { alignItems: 'flex-end', gap: 6 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 10, fontWeight: weight.bold },
  adminToggle: { padding: 4 },

  dbCard: { paddingTop: 4 },
  dbHeaderRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 8 },
  dbTotalText: { fontSize: typography.lg, fontWeight: weight.black, color: colors.text },
  dbLimitText: { fontSize: typography.xs, color: colors.textMuted },
  dbBarTrack: { height: 8, borderRadius: 4, backgroundColor: colors.dim, overflow: 'hidden' },
  dbBarFill: { height: 8, borderRadius: 4 },
  dbPctText: { fontSize: typography.xs, fontWeight: weight.bold, marginTop: 6 },
  dbTableRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dbTableName: { flex: 0.9, fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
  dbTableBarTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.dim, overflow: 'hidden' },
  dbTableBarFill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
  dbTableSize: { fontSize: 10, color: colors.textDim, minWidth: 50, textAlign: 'right' },
  showUsageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.bgCard, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: colors.border },
  showUsageBtnText: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.accent },
  dbUsageTile: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: colors.border, gap: 10 },
});
