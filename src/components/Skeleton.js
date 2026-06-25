import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

// Single pulsing block — the building unit for screen-specific skeleton
// layouts. Uses the core Animated API (no reanimated — see CLAUDE.md on the
// TurboModule crash that got it removed from this project).
export function SkeletonBlock({ width = '100%', height = 16, radius = 8, style }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.border, opacity },
        style,
      ]}
    />
  );
}

// A generic card-shaped skeleton: a title-width bar + a few body bars, sized
// like the bgCard panels most screens use for their stat/list cards.
export function SkeletonCard({ lines = 3, style }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }, style]}>
      <SkeletonBlock width="40%" height={12} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock key={i} width={i === lines - 1 ? '60%' : '100%'} height={14} style={{ marginBottom: i === lines - 1 ? 0 : 8 }} />
      ))}
    </View>
  );
}

// A vertical stack of SkeletonCards — drop-in replacement for a bare
// ActivityIndicator while a screen's primary query is loading.
export default function SkeletonScreen({ cards = 3, linesPerCard = 3 }) {
  return (
    <View style={styles.screen}>
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} lines={linesPerCard} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16 },
  card: {
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12,
  },
});
