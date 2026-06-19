import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web .wd-ex-card (collapsible exercise card with emoji, name, chips, PB pill)
export default function ExerciseCard({
  emoji = '🏋️',
  name,
  chips = [],     // e.g. ['4 sets', '12 reps']
  isPB = false,
  collapsible = true,
  defaultCollapsed = false,
  children,
}) {
  const { colors } = useTheme();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: isPB ? `${colors.accent}59` : colors.border },
      ]}
    >
      <Pressable
        style={styles.head}
        onPress={() => collapsible && setCollapsed((c) => !c)}
        disabled={!collapsible}
      >
        <Text style={styles.emoji}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{name}</Text>
          <View style={styles.metaRow}>
            {chips.map((c, i) => (
              <Text key={i} style={[styles.chip, { backgroundColor: colors.dim, color: colors.textDim }]}>{c}</Text>
            ))}
            {isPB ? (
              <Text style={[styles.pbPill, { backgroundColor: `${colors.accent}1A`, color: colors.accent, borderColor: `${colors.accent}40` }]}>
                PB
              </Text>
            ) : null}
          </View>
        </View>
        {collapsible ? (
          <Text style={[styles.chevron, { color: colors.textDim, transform: [{ rotate: collapsed ? '-90deg' : '0deg' }] }]}>▾</Text>
        ) : null}
      </Pressable>
      {!collapsed ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 11, borderWidth: 1, marginBottom: 5, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 7 },
  emoji: { fontSize: 16, width: 22, textAlign: 'center' },
  name: { fontFamily: fontFamily.bodyExtraBold, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  chip: { fontFamily: fontFamily.body, fontSize: 7, fontWeight: '600', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5 },
  pbPill: { fontFamily: fontFamily.bodyExtraBold, fontSize: 7, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, borderWidth: 1 },
  chevron: { fontSize: 8, marginLeft: 4 },
  body: { paddingHorizontal: 10, paddingBottom: 6 },
});
