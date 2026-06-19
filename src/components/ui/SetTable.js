import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web .wd-set-table — sets: [{ weight, reps, isBest }]
export default function SetTable({ sets = [] }) {
  const { colors } = useTheme();

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={[styles.th, { color: colors.textDim, width: 28 }]}>#</Text>
        <Text style={[styles.th, { color: colors.textDim, flex: 1 }]}>WEIGHT × REPS</Text>
        <Text style={[styles.th, { color: colors.textDim, width: 60, textAlign: 'right' }]}>BEST</Text>
      </View>
      {sets.map((s, i) => (
        <View key={i} style={styles.row}>
          <View style={[styles.numBadge, { backgroundColor: colors.dim }]}>
            <Text style={[styles.numText, { color: colors.textDim }]}>{i + 1}</Text>
          </View>
          <View style={styles.weightReps}>
            <Text style={[styles.weight, { color: colors.text }]}>{s.weight}</Text>
            <Text style={[styles.x, { color: colors.textDim }]}>×</Text>
            <Text style={[styles.reps, { color: colors.textMuted }]}>{s.reps}</Text>
          </View>
          <Text style={[styles.best, { color: colors.accent, width: 60, textAlign: 'right' }]}>
            {s.isBest ? '★ PB' : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', paddingHorizontal: 10, paddingBottom: 3 },
  th: { fontFamily: fontFamily.bodyBold, fontSize: 7, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 2 },
  numBadge: { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  numText: { fontFamily: fontFamily.bodyBold, fontSize: 8, fontWeight: '700' },
  weightReps: { flex: 1, flexDirection: 'row', alignItems: 'baseline' },
  weight: { fontFamily: fontFamily.monoBold, fontSize: 12, fontWeight: '800' },
  x: { fontFamily: fontFamily.mono, fontSize: 10, marginHorizontal: 2 },
  reps: { fontFamily: fontFamily.mono, fontSize: 12, fontWeight: '700' },
  best: { fontFamily: fontFamily.monoBold, fontSize: 8, fontWeight: '700' },
});
