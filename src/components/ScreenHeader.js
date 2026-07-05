import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, weight, fontFamily } from '../theme/typography';
import { useTheme } from '../context/ThemeContext';

export default function ScreenHeader({ title, onBack, colors: colorsProp, right }) {
  const { isDark, setIsDark, colors: themeColors } = useTheme();
  const colors = colorsProp ?? themeColors;
  const styles = createStyles(colors);
  return (
    <View style={styles.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
      ) : (
        <Text style={styles.logo}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
      )}
      <Text style={styles.screenLabel}>{title}</Text>
      <View style={styles.headerRight}>
        {right}
        <TouchableOpacity
          onPress={() => setIsDark(!isDark)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={isDark ? colors.accent : colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  },
  backBtn: { padding: 2, minWidth: 24 },
  logo: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.accent },
  screenLabel: { fontSize: typography.xs, fontWeight: weight.bold, letterSpacing: 2, color: colors.textMuted },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 24, justifyContent: 'flex-end' },
});
