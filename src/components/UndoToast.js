import React, { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, View, StyleSheet } from 'react-native';

/**
 * UndoToast — a bottom slide-up toast with an Undo button.
 *
 * Props:
 *   visible   {boolean}  — whether the toast is shown
 *   message   {string}   — text to display on the left
 *   onUndo    {function} — called when the user taps "Undo"
 *   onDismiss {function} — called after the 3-second auto-dismiss (or on undo)
 */
export default function UndoToast({ visible, message, onUndo, onDismiss }) {
  const translateY = useRef(new Animated.Value(100)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    if (visible) {
      // Slide up
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();

      // Auto-dismiss after 3 s
      timerRef.current = setTimeout(() => {
        dismiss();
      }, 3000);
    } else {
      // Slide back down
      Animated.timing(translateY, {
        toValue: 100,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible]);

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(translateY, {
      toValue: 100,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      if (onDismiss) onDismiss();
    });
  }

  function handleUndo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (onUndo) onUndo();
    dismiss();
  }

  if (!visible) return null;

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateY }] }]}>
      <Text style={styles.message} numberOfLines={1}>{message}</Text>
      <TouchableOpacity onPress={handleUndo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.undoBtn}>Undo</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    right: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Shadow for iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    // Elevation for Android
    elevation: 8,
  },
  message: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '500',
    marginRight: 12,
  },
  undoBtn: {
    color: '#d4ff00',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
