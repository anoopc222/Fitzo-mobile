import React, { useEffect, useRef } from 'react';
import { Modal, Animated, View, Pressable, Text, StyleSheet, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web #wdModal / #wdSheet (centered scale-in dialog)
export default function CenterDialog({ visible, onClose, children, style }) {
  const { colors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 180 }),
      ]).start();
    } else {
      scale.setValue(0.92);
      opacity.setValue(0);
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
          <BlurView intensity={20} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.72)' }]} />
        </Pressable>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border, opacity, transform: [{ scale }] },
            style,
          ]}
        >
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: colors.dim, borderColor: colors.border }]}
          >
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>✕</Text>
          </Pressable>
          <ScrollView style={{ maxHeight: '100%' }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '88%',
    borderRadius: 22,
    borderWidth: 1,
  },
  closeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
});
