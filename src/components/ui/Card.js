import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

// Mirrors web .ex-card / generic surface card
export default function Card({ children, style, variant = 'surface' }) {
  const { colors } = useTheme();
  const bg = variant === 'card' ? colors.card : colors.surface;

  return (
    <View style={[styles.base, { backgroundColor: bg, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
});
