import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import { computeAchievements } from '../lib/achievements';

export default function AchievementsRow({ home }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const badges = useMemo(() => computeAchievements(home), [home]);
  const unlockedCount = badges.filter(b => b.unlocked).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>ACHIEVEMENTS</Text>
        <Text style={styles.count}>{unlockedCount}/{badges.length}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {badges.map((b) => (
          <View
            key={b.id}
            style={[
              styles.badge,
              b.unlocked
                ? { backgroundColor: colors.accent + '1a', borderColor: colors.accent }
                : { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.badgeIcon, !b.unlocked && styles.badgeIconLocked]}>{b.icon}</Text>
            <Text
              style={[styles.badgeLabel, { color: b.unlocked ? colors.text : colors.textDim }]}
              numberOfLines={1}
            >
              {b.label}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: 14, marginBottom: 4 },
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
});
