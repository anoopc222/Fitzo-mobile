import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import { computeAchievements } from '../lib/achievements';

export default function AchievementsRow({ home }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const badges = useMemo(() => computeAchievements(home), [home]);
  const unlockedCount = badges.filter(b => b.unlocked).length;
  const [selected, setSelected] = useState(null);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>ACHIEVEMENTS</Text>
        <Text style={styles.count}>{unlockedCount}/{badges.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {badges.map((b) => (
          <TouchableOpacity
            key={b.id}
            style={[
              styles.badge,
              b.unlocked
                ? { backgroundColor: colors.accent + '1a', borderColor: colors.accent }
                : { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            onPress={() => setSelected(b)}
          >
            <Text style={[styles.badgeIcon, !b.unlocked && styles.badgeIconLocked]}>{b.icon}</Text>
            <Text
              style={[styles.badgeLabel, { color: b.unlocked ? colors.text : colors.textDim }]}
              numberOfLines={1}
            >
              {b.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.overlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {selected && (
              <>
                <Text style={styles.sheetIcon}>{selected.icon}</Text>
                <Text style={styles.sheetLabel}>{selected.label}</Text>
                <View style={[
                  styles.statusChip,
                  selected.unlocked
                    ? { backgroundColor: colors.accent + '1a' }
                    : { backgroundColor: colors.surface },
                ]}>
                  <Ionicons
                    name={selected.unlocked ? 'checkmark-circle' : 'lock-closed'}
                    size={13}
                    color={selected.unlocked ? colors.accent : colors.textDim}
                  />
                  <Text style={[styles.statusChipText, { color: selected.unlocked ? colors.accent : colors.textDim }]}>
                    {selected.unlocked ? 'Unlocked' : 'Locked'}
                  </Text>
                </View>
                <Text style={styles.sheetDescription}>{selected.description}</Text>
                <Text style={styles.sheetDetail}>{selected.detail}</Text>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
                  <Text style={styles.closeBtnText}>Got it</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: 14, marginBottom: 4, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: typography.xs, fontWeight: weight.bold, fontFamily: fontFamily.bodyBold, color: colors.textMuted, letterSpacing: 0.6 },
  count: { fontSize: typography.xs, fontFamily: fontFamily.bodySemibold, color: colors.textDim },
  scrollContent: { gap: 8, paddingRight: 8 },
  badge: {
    width: 84, paddingVertical: 10, paddingHorizontal: 8,
    borderRadius: 14, borderWidth: 1, alignItems: 'center', gap: 4,
  },
  badgeIcon: { fontSize: 22 },
  badgeIconLocked: { opacity: 0.35 },
  badgeLabel: { fontSize: 10, fontFamily: fontFamily.bodySemibold, textAlign: 'center' },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  sheet: {
    width: '100%', maxWidth: 360, borderRadius: 20, padding: 24,
    alignItems: 'center', backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
  },
  sheetIcon: { fontSize: 40, marginBottom: 8 },
  sheetLabel: { fontSize: typography.lg, fontWeight: weight.bold, fontFamily: fontFamily.bodyBold, color: colors.text, marginBottom: 8, textAlign: 'center' },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, marginBottom: 12,
  },
  statusChipText: { fontSize: typography.xs, fontFamily: fontFamily.bodySemibold },
  sheetDescription: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', marginBottom: 8 },
  sheetDetail: { fontSize: typography.sm, color: colors.text, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  closeBtn: {
    paddingVertical: 12, paddingHorizontal: 32, borderRadius: 14,
    backgroundColor: colors.accent,
  },
  closeBtnText: { fontSize: typography.base, fontWeight: weight.bold, color: colors.bg },
});
