import React, { useMemo, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import DietScreen from './DietScreen';
import ProgressScreen from './ProgressScreen';
import MeasurementsScreen from './MeasurementsScreen';

const TABS = [
  { key: 'progress', icon: 'trending-up-outline', activeIcon: 'trending-up' },
  { key: 'measurements', icon: 'body-outline', activeIcon: 'body' },
  { key: 'diet', icon: 'restaurant-outline', activeIcon: 'restaurant' },
];

export default function BodyHealthScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState('progress');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t('tabs.bodyHealth').toUpperCase()} colors={colors} />

      <View style={styles.tabBar}>
        {TABS.map(tb => {
          const active = tab === tb.key;
          return (
            <TouchableOpacity
              key={tb.key}
              style={styles.tabItem}
              onPress={() => setTab(tb.key)}
              activeOpacity={0.7}
            >
              <Ionicons name={active ? tb.activeIcon : tb.icon} size={20} color={active ? colors.accent : colors.textDim} />
              <Text style={[styles.tabLabel, active && { color: colors.accent }]}>{t(`tabs.${tb.key}`)}</Text>
              <View style={[styles.tabUnderline, active && { backgroundColor: colors.accent }]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        {tab === 'diet' && <DietScreen embedded />}
        {tab === 'progress' && <ProgressScreen embedded />}
        {tab === 'measurements' && <MeasurementsScreen embedded />}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10 },
  tabLabel: { fontSize: 11, fontWeight: weight.semibold, color: colors.textDim },
  tabUnderline: { height: 3, width: '60%', borderRadius: 2, marginTop: 4, backgroundColor: 'transparent' },

  body: { flex: 1 },
});
