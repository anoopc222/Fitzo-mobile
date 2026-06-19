import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web .toast.show
export default function Toast({ visible, message }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, { toValue: visible ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [visible]);

  if (!visible && opacity.__getValue?.() === 0) return null;

  return (
    <Animated.View
      style={[
        styles.base,
        { backgroundColor: `${colors.accent}14`, borderColor: `${colors.accent}26`, opacity },
      ]}
    >
      <Text style={[styles.text, { color: colors.accent }]}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    alignItems: 'center',
  },
  text: {
    fontFamily: fontFamily.monoBold,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});
