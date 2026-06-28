import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import ActivityFeedScreen from './ActivityFeedScreen';
import FriendsScreen from './FriendsScreen';
import ChallengesScreen from './ChallengesScreen';

const TABS = [
  { key: 'feed', icon: 'newspaper' },
  { key: 'friends', icon: 'people' },
  { key: 'challenges', icon: 'trophy' },
];

export default function SocialScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState('feed');

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title={t('more.feed')} colors={colors} onBack={() => navigation.goBack()} />
      <View style={styles.tabRow}>
        {TABS.map(tb => (
          <TouchableOpacity
            key={tb.key}
            style={[styles.tabBtn, tab === tb.key && styles.tabBtnActive]}
            onPress={() => setTab(tb.key)}
            activeOpacity={0.8}
          >
            <Ionicons name={tb.icon} size={15} color={tab === tb.key ? colors.bg : colors.textMuted} />
            <Text style={[styles.tabBtnText, tab === tb.key && styles.tabBtnTextActive]}>
              {t(`more.${tb.key === 'feed' ? 'activityFeed' : tb.key}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.body}>
        {tab === 'feed' && <ActivityFeedScreen navigation={navigation} embedded />}
        {tab === 'friends' && <FriendsScreen navigation={navigation} embedded />}
        {tab === 'challenges' && <ChallengesScreen navigation={navigation} embedded />}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  tabRow: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 9,
  },
  tabBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabBtnText: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted },
  tabBtnTextActive: { color: colors.bg },
  body: { flex: 1 },
});
