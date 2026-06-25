import React, { useMemo, useEffect } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useMoreMenu } from '../context/MoreMenuContext';
import { typography, weight } from '../theme/typography';
import { navigate } from '../navigation/navigationRef';
import { fetchProgress } from '../screens/ProgressScreen';
import { fetchMeasurements, fetchBodyStats } from '../screens/MeasurementsScreen';
import { fetchPeriodLogs } from '../screens/PeriodTrackerScreen';
import { fetchHealthLogs } from '../screens/HealthLogScreen';
import { fetchProfile } from '../screens/ProfileScreen';
import { fetchDietPlans } from '../screens/DietScreen';

const getSections = (colors, isAdmin, isPro, subReady) => [
  {
    title: 'LADIES',
    items: [
      { label: 'Period Tracker', icon: 'water', target: ['Home', 'PeriodTracker'], color: colors.pink },
    ],
  },
  {
    title: 'LOG',
    items: [
      { label: 'Food Log', icon: 'clipboard', target: ['Log'], color: colors.accent },
    ],
  },
  {
    title: 'BODY & HEALTH',
    items: [
      { label: 'Diet Plan',     icon: 'restaurant',  target: ['Home', 'Diet'],         color: colors.warning },
      { label: 'Progress',      icon: 'trending-up', target: ['Home', 'Progress'],     color: colors.success },
      { label: 'Measurements',  icon: 'body',        target: ['Home', 'Measurements'], color: colors.accent },
      { label: 'Health Log',    icon: 'heart-half',  target: ['Home', 'HealthLog'],    color: colors.danger },
    ],
  },
  {
    title: 'TOOLS',
    items: [
      { label: 'Calculators',   icon: 'calculator',  target: ['Home', 'Calculators'],  color: colors.warning },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      ...(subReady && !isPro ? [
        { label: 'Go Pro', icon: 'rocket', target: ['Home', 'Subscription'], color: colors.accent },
      ] : []),
      { label: 'Profile',       icon: 'person',      target: ['Home', 'Profile'],      color: colors.blue },
      { label: 'Settings',      icon: 'settings',    target: ['Home', 'Settings'],      color: colors.textMuted },
    ],
  },
  ...(isAdmin ? [{
    title: 'ADMIN',
    items: [
      { label: 'Admin Dashboard', icon: 'shield-checkmark', target: ['Home', 'AdminDashboard'], color: colors.purple },
    ],
  }] : []),
];

export default function MoreSheetModal() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { isAdmin, isPro, ready: subReady } = useSubscription();
  const { visible, close } = useMoreMenu();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const SECTIONS = useMemo(() => getSections(colors, isAdmin, isPro, subReady), [colors, isAdmin, isPro, subReady]);
  const qc = useQueryClient();

  // Prefetch the screens reachable from this sheet as soon as it opens, so
  // by the time the user taps a row its data is already in cache instead of
  // loading fresh after navigation. prefetchQuery is a no-op network-wise if
  // the cached data for that key is still within staleTime.
  useEffect(() => {
    if (!visible || !user?.id) return;
    qc.prefetchQuery({ queryKey: ['progress', user.id], queryFn: () => fetchProgress(user.id) });
    qc.prefetchQuery({ queryKey: ['measurements', user.id], queryFn: () => fetchMeasurements(user.id) });
    qc.prefetchQuery({ queryKey: ['measurements-bodystats', user.id], queryFn: () => fetchBodyStats(user.id) });
    qc.prefetchQuery({ queryKey: ['periodLogs', user.id], queryFn: () => fetchPeriodLogs(user.id) });
    qc.prefetchQuery({ queryKey: ['healthLogs', user.id], queryFn: () => fetchHealthLogs(user.id) });
    qc.prefetchQuery({ queryKey: ['profile', user.id], queryFn: () => fetchProfile(user.id) });
    qc.prefetchQuery({ queryKey: ['dietPlans', user.id], queryFn: () => fetchDietPlans(user.id) });
  }, [visible, user?.id, qc]);

  const onPressItem = (target) => {
    close();
    const [root, screen] = target;
    if (screen) navigate(root, { screen });
    else navigate(root);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={styles.sheet}>
        <View style={styles.grabberRow}>
          <View style={styles.grabber} />
        </View>
        <View style={styles.header}>
          <Text style={styles.title}>More</Text>
          <TouchableOpacity onPress={close} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {SECTIONS.map(section => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.list}>
                {section.items.map((item, i) => (
                  <TouchableOpacity
                    key={item.label}
                    style={[styles.row, i < section.items.length - 1 && styles.rowDivider]}
                    onPress={() => onPressItem(item.target)}
                    activeOpacity={0.6}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: item.color + '18' }]}>
                      <Ionicons name={item.icon} size={17} color={item.color} />
                    </View>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '78%',
    backgroundColor: colors.bgCard, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderTopWidth: 1, borderColor: colors.border,
  },
  grabberRow: { alignItems: 'center', paddingTop: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6,
  },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  closeBtn: { padding: 4 },

  content: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 6 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 11, fontWeight: weight.bold, color: colors.textDim,
    letterSpacing: 1, marginBottom: 6, marginLeft: 4,
  },
  list: {
    backgroundColor: colors.bg, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 11, paddingHorizontal: 12,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: typography.sm, fontWeight: weight.medium, color: colors.text },
});
