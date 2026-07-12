import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import FriendsScreen, { fetchFriendsData } from './FriendsScreen';
import ChallengesScreen from './ChallengesScreen';

const TABS = [
  { key: 'challenges', icon: 'trophy-outline', activeIcon: 'trophy' },
  { key: 'friends', icon: 'people-outline', activeIcon: 'people' },
];

export default function SocialScreen({ navigation }) {
  const { user } = useAuth();
  const { colors, isDark, setIsDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState('challenges');

  const { data: friendsData } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriendsData(user.id),
    enabled: !!user?.id,
  });
  const incomingCount = friendsData?.incoming?.length ?? 0;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.topBar}>
        <View style={styles.backBtn} />
        <Text style={styles.logo}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
        <View style={styles.topBarRight}>
          <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => setTab('friends')}>
            <Ionicons name="person-add-outline" size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setIsDark(!isDark)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={isDark ? colors.accent : colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

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
              <View>
                <Ionicons name={active ? tb.activeIcon : tb.icon} size={22} color={active ? colors.accent : colors.textDim} />
                {tb.key === 'friends' && incomingCount > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{incomingCount > 9 ? '9+' : incomingCount}</Text>
                  </View>
                )}
              </View>
              <View style={[styles.tabUnderline, active && { backgroundColor: colors.accent }]} />
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.body}>
        {tab === 'friends' && <FriendsScreen navigation={navigation} embedded />}
        {tab === 'challenges' && <ChallengesScreen navigation={navigation} embedded />}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8,
  },
  backBtn: { padding: 2, width: 28 },
  logo: { flex: 1, fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.accent },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabUnderline: { height: 3, width: '60%', borderRadius: 2, marginTop: 6, backgroundColor: 'transparent' },
  tabBadge: {
    position: 'absolute', top: -4, right: -10, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: weight.bold },

  body: { flex: 1 },
});
