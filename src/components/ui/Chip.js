import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web .logday-chip / .logday-chip.selected
export default function Chip({ label, selected = false, onPress, style }) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.base,
        {
          backgroundColor: selected ? `${colors.accent}1F` : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { color: selected ? colors.accent : colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingVertical: 5,
    paddingHorizontal: 13,
  },
  text: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 11,
    fontWeight: '600',
  },
});
