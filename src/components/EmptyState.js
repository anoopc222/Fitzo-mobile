import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';

export default function EmptyState({ emoji, title, subtitle, actionLabel, onAction }) {
  const { colors } = useTheme();
  const s = styles(colors);

  return (
    <View style={s.container}>
      <Text style={s.emoji}>{emoji}</Text>
      <Text style={s.title}>{title}</Text>
      {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
      {!!actionLabel && !!onAction && (
        <TouchableOpacity style={s.actionBtn} onPress={onAction} activeOpacity={0.8}>
          <Text style={s.actionLabel}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    backgroundColor: colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border ?? colors.bgCard,
    marginVertical: 8,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 14,
  },
  title: {
    fontSize: typography.md ?? typography.sm,
    fontWeight: weight.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: typography.sm,
    color: colors.textDim,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  actionLabel: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: colors.bg,
  },
});
