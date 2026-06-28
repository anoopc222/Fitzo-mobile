import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ShareToFeedToggle({ value, onChange, colors, label }) {
  const styles = createStyles(colors);
  return (
    <TouchableOpacity style={styles.row} onPress={() => onChange(!value)} activeOpacity={0.7}>
      <Ionicons name={value ? 'checkbox' : 'square-outline'} size={20} color={value ? colors.accent : colors.textMuted} />
      <Text style={styles.label}>{label || 'Share to Activity Feed'}</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 4 },
  label: { color: colors.textMuted, fontSize: 13 },
});
