import React, { useMemo, useEffect } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useMoreMenu } from '../context/MoreMenuContext';
import { typography, weight } from '../theme/typography';
import { navigate } from '../navigation/navigationRef';
import { fetchProfile } from '../screens/ProfileScreen';

const getSections = (t, colors, isSuperAdmin, isPro, subReady) => [
  {
    title: t('more.sectionLog'),
    items: [
      { label: t('more.foodLog'), icon: 'restaurant', target: ['Log'], color: colors.accent },
    ],
  },
  {
    title: t('more.sectionBodyHealth'),
    items: [
      { label: t('more.progress'),          icon: 'trending-up',   target: ['Home', 'Progress'],           color: colors.good },
      { label: t('more.measurements'),      icon: 'body',           target: ['Home', 'Measurements'],       color: colors.purple },
      { label: 'Exercise Reference',        icon: 'barbell',        target: ['Home', 'ExerciseReference'],  color: colors.warning },
      { label: t('more.dietPlan'),          icon: 'nutrition',      target: ['Home', 'Diet'],               color: colors.accent2 },
    ],
  },
  {
    title: 'Entertainment & Tools',
    items: [
      { label: 'Game Zone',              icon: 'game-controller', target: ['Home', 'GameZone'],    color: colors.accent },
      { label: t('tabs.social'),         icon: 'people',          target: ['Social'],              color: colors.danger },
      { label: t('more.calculators'),    icon: 'calculator',      target: ['Home', 'Calculators'], color: colors.warning },
    ],
  },
  {
    title: t('more.sectionAccount'),
    items: [
      ...(subReady && !isPro ? [
        { label: t('more.goPro'), icon: 'rocket', target: ['Home', 'Subscription'], color: colors.accent },
      ] : []),
      { label: t('more.profile'),  icon: 'person',   target: ['Home', 'Profile'],  color: colors.blue },
      { label: t('more.settings'), icon: 'settings', target: ['Home', 'Settings'], color: colors.textDim },
    ],
  },
  ...(isSuperAdmin ? [{
    title: t('more.sectionAdmin'),
    items: [
      { label: t('more.adminDashboard'), icon: 'shield-checkmark', target: ['Home', 'AdminDashboard'], color: colors.purple },
    ],
  }] : []),
];

export default function MoreSheetModal() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { isSuperAdmin, isPro, ready: subReady } = useSubscription();
  const { visible, close } = useMoreMenu();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const SECTIONS = useMemo(() => getSections(t, colors, isSuperAdmin, isPro, subReady), [t, colors, isSuperAdmin, isPro, subReady]);
  const qc = useQueryClient();

  // Prefetch the screens reachable from this sheet as soon as it opens, so
  // by the time the user taps a row its data is already in cache instead of
  // loading fresh after navigation. prefetchQuery is a no-op network-wise if
  // the cached data for that key is still within staleTime.
  useEffect(() => {
    if (!visible || !user?.id) return;
    qc.prefetchQuery({ queryKey: ['profile', user.id], queryFn: () => fetchProfile(user.id) });
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
          <Text style={styles.title}>{t('more.title')}</Text>
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
