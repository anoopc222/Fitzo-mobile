import React, { useMemo } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useMoreMenu } from '../context/MoreMenuContext';
import { typography, weight } from '../theme/typography';
import { navigate } from '../navigation/navigationRef';

const getSections = (colors, isAdmin) => [
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
  const { isAdmin } = useSubscription();
  const { visible, close } = useMoreMenu();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const SECTIONS = useMemo(() => getSections(colors, isAdmin), [colors, isAdmin]);

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
              <View style={styles.grid}>
                {section.items.map(item => (
                  <TouchableOpacity
                    key={item.label}
                    style={styles.tile}
                    onPress={() => onPressItem(item.target)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.iconWrap, { backgroundColor: item.color + '20' }]}>
                      <Ionicons name={item.icon} size={22} color={item.color} />
                    </View>
                    <Text style={styles.tileLabel}>{item.label}</Text>
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

  content: { paddingHorizontal: 16, paddingBottom: 28, paddingTop: 6 },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 11, fontWeight: weight.bold, color: colors.textDim,
    letterSpacing: 1, marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '47%', alignItems: 'center', gap: 8,
    backgroundColor: colors.bg, borderRadius: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: colors.border,
  },
  iconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: typography.sm, fontWeight: weight.medium, color: colors.text, textAlign: 'center' },
});
