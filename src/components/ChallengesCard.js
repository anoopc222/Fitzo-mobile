import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import { computeChallenges } from '../lib/challenges';

export default function ChallengesCard({ home }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const challenges = useMemo(() => computeChallenges(home), [home]);
  const completeCount = challenges.filter(c => c.complete).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>WEEKLY CHALLENGES</Text>
        <Text style={styles.count}>{completeCount}/{challenges.length}</Text>
      </View>
      <View style={styles.card}>
        {challenges.map((c, i) => (
          <View key={c.id} style={[styles.row, i !== challenges.length - 1 && styles.rowBorder]}>
            <Text style={styles.icon}>{c.icon}</Text>
            <View style={styles.body}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: c.complete ? colors.accent : colors.text }]} numberOfLines={1}>
                  {c.label}
                </Text>
                <Text style={[styles.progressText, { color: c.complete ? colors.accent : colors.textDim }]}>
                  {c.progress}/{c.target}
                </Text>
              </View>
              <Text style={styles.description} numberOfLines={1}>{c.description}</Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round((c.progress / c.target) * 100)}%`, backgroundColor: c.complete ? colors.accent : colors.textDim },
                  ]}
                />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  wrap: { marginTop: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: typography.xs, fontWeight: weight.bold, fontFamily: fontFamily.bodyBold, color: colors.textMuted, letterSpacing: 0.6 },
  count: { fontSize: typography.xs, fontFamily: fontFamily.bodySemibold, color: colors.textDim },
  card: {
    backgroundColor: colors.bgCard, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  icon: { fontSize: 20 },
  body: { flex: 1, gap: 4 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: typography.base, fontFamily: fontFamily.bodySemibold, flex: 1 },
  progressText: { fontSize: typography.xs, fontFamily: fontFamily.bodySemibold },
  description: { fontSize: typography.xs, color: colors.textDim },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden', marginTop: 2 },
  fill: { height: 5, borderRadius: 3 },
});
