import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import { computeXP, computeXPBreakdown, computeLevel } from '../lib/levels';

export default function LevelBadge({ home }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [showDetail, setShowDetail] = useState(false);
  const xp = useMemo(() => computeXP(home), [home]);
  const breakdown = useMemo(() => computeXPBreakdown(home), [home]);
  const level = useMemo(() => computeLevel(xp), [xp]);

  return (
    <>
      <TouchableOpacity style={styles.wrap} onPress={() => setShowDetail(true)} activeOpacity={0.8}>
        <Text style={styles.levelText}>LV {level.level} · {level.title.toUpperCase()}</Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${level.progressPct}%` }]} />
        </View>
        <Text style={styles.xpText}>{level.xpIntoLevel}/{level.xpForNextLevel} XP</Text>
      </TouchableOpacity>

      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowDetail(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetLevel}>Level {level.level}</Text>
            <Text style={styles.sheetTitle}>{level.title}</Text>
            <View style={styles.sheetTrack}>
              <View style={[styles.sheetFill, { width: `${level.progressPct}%` }]} />
            </View>
            <Text style={styles.sheetXp}>{level.xpIntoLevel}/{level.xpForNextLevel} XP to Level {level.level + 1}</Text>

            <ScrollView style={styles.breakdownList}>
              {breakdown.map((b) => (
                <View key={b.key} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>{b.label}</Text>
                  <Text style={[styles.breakdownXp, { color: b.xp > 0 ? colors.accent : colors.textDim }]}>
                    +{b.xp} XP
                  </Text>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowDetail(false)}>
              <Text style={styles.closeBtnText}>Got it</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: 10, gap: 4 },
  levelText: { fontSize: typography.xs, fontWeight: weight.bold, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 0.5 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  xpText: { fontSize: 10, color: colors.textDim, fontFamily: fontFamily.bodySemibold },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  sheet: {
    width: '100%', maxWidth: 360, maxHeight: '70%', borderRadius: 20, padding: 24,
    alignItems: 'center', backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
  },
  sheetLevel: { fontSize: typography.lg, fontWeight: weight.bold, fontFamily: fontFamily.bodyBold, color: colors.text },
  sheetTitle: { fontSize: typography.sm, color: colors.accent, fontFamily: fontFamily.bodySemibold, marginBottom: 12 },
  sheetTrack: { width: '100%', height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  sheetFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  sheetXp: { fontSize: typography.xs, color: colors.textDim, marginTop: 6, marginBottom: 16 },
  breakdownList: { width: '100%', marginBottom: 16 },
  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  breakdownLabel: { fontSize: typography.sm, color: colors.textMuted, flex: 1 },
  breakdownXp: { fontSize: typography.sm, fontFamily: fontFamily.bodySemibold },
  closeBtn: { paddingVertical: 12, paddingHorizontal: 32, borderRadius: 14, backgroundColor: colors.accent },
  closeBtnText: { fontSize: typography.base, fontWeight: weight.bold, color: colors.bg },
});
