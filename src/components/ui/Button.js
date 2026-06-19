import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web .btn / .btn-primary / .btn-secondary / .btn-danger / .btn-sm
export default function Button({
  title,
  onPress,
  variant = 'primary', // primary | secondary | danger
  size = 'md',          // md | sm
  disabled = false,
  loading = false,
  style,
  textStyle,
}) {
  const { colors } = useTheme();

  const variantStyle = {
    primary:   { backgroundColor: colors.accent, borderWidth: 0 },
    secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.border },
    danger:    { backgroundColor: 'rgba(248,113,113,0.15)', borderWidth: 1.5, borderColor: 'rgba(248,113,113,0.25)' },
  }[variant];

  const textColor = {
    primary:   colors.accentText,
    secondary: colors.textMuted,
    danger:    colors.danger,
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        variantStyle,
        pressed && !disabled && { transform: [{ scale: 0.97 }] },
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {loading
        ? <ActivityIndicator color={textColor} size="small" />
        : <Text style={[styles.text, size === 'sm' && styles.textSm, { color: textColor }, textStyle]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  md: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
  },
  sm: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 14,
    fontWeight: '700',
  },
  textSm: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
