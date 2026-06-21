import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import { TRIAL_DAYS } from '../config/subscription';

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
      statusLabel: p.is_admin ? 'Admin' : isPro ? 'Pro' : isInTrial ? 'Trial' : 'Free',
    };
  });
}

function csvEscape(val) {
  const s = val === null || val === undefined ? '' : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AdminDashboardScreen({ navigation }) {
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
      const header = ['Name', 'Email', 'Status', 'Is Admin', 'Is Super Admin', 'Plan', 'Store', 'Period End', 'Signed Up'];
      const rows = users.map(u => [
        u.full_name ?? '', u.email ?? '', u.statusLabel,
        u.is_admin ? 'Yes' : 'No', u.is_super_admin ? 'Yes' : 'No',
        u.sub?.plan_id ?? '', u.sub?.store ?? '', u.sub?.period_end ?? '',
        u.created_at ?? '',
      ]);
      const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
      const path = `${FileSystem.cacheDirectory}fitzo-users-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Users' });
      } else {
        Alert.alert('Exported', `Saved to ${path}`);
      }
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Admin Dashboard</Text>
        <TouchableOpacity onPress={handleExport} disabled={exporting || !users?.length}>
          {exporting
            ? <ActivityIndicator color={colors.accent} />
            : <Ionicons name="download-outline" size={22} color={colors.accent} />}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={undefined}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.statsGrid}>
              <StatCard label="Total Users" value={summary.total} icon="people" color={colors.accent} styles={styles} />
              <StatCard label="Pro Users" value={summary.pro} icon="star" color={colors.success} styles={styles} />
              <StatCard label="In Trial" value={summary.trial} icon="time" color={colors.warning} styles={styles} />
              <StatCard label="Admins" value={summary.admins} icon="shield-checkmark" color={colors.purple} styles={styles} />
            </View>

            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or email"
                placeholderTextColor={colors.textDim}
                value={search}
                onChangeText={setSearch}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>USERS ({filtered.length})</Text>
              {filtered.map(u => (
                <UserRow key={u.id} user={u} styles={styles} colors={colors} isSuperAdmin={isSuperAdmin} onChanged={refetch} />
              ))}
              {filtered.length === 0 && (
                <Text style={styles.emptyText}>No users match your search.</Text>
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

function statusColor(label, colors) {
  if (label === 'Admin') return colors.purple;
  if (label === 'Pro') return colors.success;
  if (label === 'Trial') return colors.warning;
  return colors.textDim;
}

function UserRow({ user, styles, colors, isSuperAdmin, onChanged }) {
  const { setUserAdmin } = useSubscription();
  const [busy, setBusy] = useState(false);

  const toggleAdmin = () => {
    const makeAdmin = !user.is_admin;
    Alert.alert(
      makeAdmin ? 'Grant Admin' : 'Revoke Admin',
      `${makeAdmin ? 'Grant' : 'Revoke'} admin access for ${user.email}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: makeAdmin ? 'Grant' : 'Revoke',
          style: makeAdmin ? 'default' : 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await setUserAdmin(user.email, makeAdmin);
              onChanged?.();
            } catch (e) {
              Alert.alert('Error', e.message);
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
        <Text style={styles.userName}>{user.full_name || 'Unnamed'}</Text>
        <Text style={styles.userEmail}>{user.email}</Text>
        {user.sub?.plan_id && (
          <Text style={styles.userPlan}>{user.sub.plan_id} · {user.sub.store ?? 'unknown store'}</Text>
        )}
      </View>
      <View style={styles.userRight}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(user.statusLabel, colors) + '20' }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor(user.statusLabel, colors) }]}>{user.statusLabel}</Text>
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
});
