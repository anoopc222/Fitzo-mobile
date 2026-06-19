import React, { useEffect, useRef } from 'react';
import { Pressable, Animated, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';

// Mirrors web .wd-ex-toggle-switch
export default function ToggleSwitch({ value = false, onValueChange, style }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [value]);

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.dim, `${colors.accent}26`],
  });
  const knobColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.textDim, colors.accent],
  });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [2, 12] });

  return (
    <Pressable onPress={() => onValueChange?.(!value)}>
      <Animated.View style={[styles.track, { backgroundColor: trackColor, borderColor: colors.border }, style]}>
        <Animated.View style={[styles.knob, { backgroundColor: knobColor, transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 24,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  knob: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
