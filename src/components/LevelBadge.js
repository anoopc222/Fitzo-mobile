import React, { useMemo, useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ScrollView, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import { computeXP, computeXPBreakdown, computeLevel } from '../lib/levels';

export default function LevelBadge({ home }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [showDetail, setShowDetail] = useState(false);
  const xp = useMemo(() => computeXP(home), [home]);
  const breakdown = useMemo(() => computeXPBreakdown(home), [home]);
  const level = useMemo(() => computeLevel(xp), [xp]);

  // Animate the XP bar fill
  const fillAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: level.progressPct,
      duration: 1100,
      delay: 300,
      useNativeDriver: false,
    }).start();

    // Subtle glow pulse on the fill bar
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0.6, duration: 1200, useNativeDriver: false }),
      ])
    ).start();
  }, [level.progressPct]);

  const animWidth = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  const animOpacity = glowAnim;

  return (
    <>
      <TouchableOpacity style={styles.wrap} onPress={() => setShowDetail(true)} activeOpacity={0.8}>
        <Text style={styles.levelText}>LV {level.level} · {t(level.titleKey).toUpperCase()}</Text>
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { width: animWidth, opacity: animOpacity }]} />
        </View>
        <Text style={styles.xpText}>{level.xpIntoLevel}/{level.xpForNextLevel} XP</Text>
      </TouchableOpacity>

      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowDetail(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetLevel}>{t('gamification.levelDetailTitle', { level: level.level })}</Text>
            <Text style={styles.sheetTitle}>{t(level.titleKey)}</Text>
            <View style={styles.sheetTrack}>
              <Animated.View style={[styles.sheetFill, { width: animWidth }]} />
            </View>
            <Text style={styles.sheetXp}>
              {t('gamification.xpToNextLevel', { xpIntoLevel: level.xpIntoLevel, xpForNextLevel: level.xpForNextLevel, nextLevel: level.level + 1 })}
            </Text>

            <ScrollView style={styles.breakdownList}>
              {breakdown.map((b) => (
                <View key={b.key} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>{t(b.labelKey)}</Text>
                  <Text style={[styles.breakdownXp, { color: b.xp > 0 ? colors.accent : colors.textDim }]}>
                    +{b.xp} XP
                  </Text>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setShowDetail(false)}>
              <Text style={styles.closeBtnText}>{t('gamification.gotIt')}</Text>
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
