import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import ActivityFeedScreen from './ActivityFeedScreen';
import FriendsScreen, { fetchFriendsData } from './FriendsScreen';
import ChallengesScreen from './ChallengesScreen';

const TABS = [
  { key: 'feed', icon: 'home', activeIcon: 'home' },
  { key: 'friends', icon: 'people-outline', activeIcon: 'people' },
  { key: 'challenges', icon: 'trophy-outline', activeIcon: 'trophy' },
];

const QUICK_ACTIONS = [
  { label: 'Weight', icon: 'scale', target: 'Weight', color: 'blue' },
  { label: 'Steps', icon: 'footsteps', target: 'Steps', color: 'good' },
  { label: 'Sleep', icon: 'moon', target: 'Sleep', color: 'purple' },
  { label: 'Food', icon: 'restaurant', target: 'Log', color: 'accent2' },
  { label: 'Workout', icon: 'barbell', target: 'Workout', color: 'danger' },
];

export default function SocialScreen({ navigation }) {
  const { user } = useAuth();
  const { colors, isDark, setIsDark } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState('feed');
  const [composerOpen, setComposerOpen] = useState(false);

  const displayName = user?.user_metadata?.full_name ?? 'You';
  const initial = (displayName[0] ?? 'F').toUpperCase();

  const { data: friendsData } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriendsData(user.id),
    enabled: !!user?.id,
  });
  const friends = friendsData?.friends ?? [];
  const incomingCount = friendsData?.incoming?.length ?? 0;

  const goQuickAction = (target) => {
    setComposerOpen(false);
    navigation.navigate(target);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
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

      {tab === 'feed' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.storiesRail} contentContainerStyle={styles.storiesContent}>
          <TouchableOpacity style={styles.storyItem} onPress={() => setTab('friends')} activeOpacity={0.8}>
            <View style={styles.storyAddRing}>
              <View style={styles.storyAvatarInner}>
                <Text style={styles.storyAvatarText}>{initial}</Text>
              </View>
              <View style={styles.storyAddBadge}>
                <Ionicons name="add" size={12} color={colors.bg} />
              </View>
            </View>
            <Text style={styles.storyLabel} numberOfLines={1}>{t('friends.add')}</Text>
          </TouchableOpacity>

          {friends.map(f => (
            <TouchableOpacity
              key={f.friendshipId}
              style={styles.storyItem}
              onPress={() => navigation.navigate('PublicProfile', { userId: f.id, name: f.full_name })}
              activeOpacity={0.8}
            >
              <LinearGradient colors={[colors.accent, colors.purple]} style={styles.storyRing}>
                <View style={styles.storyAvatarInner}>
                  <Text style={styles.storyAvatarText}>{(f.full_name?.[0] ?? '?').toUpperCase()}</Text>
                </View>
              </LinearGradient>
              <Text style={styles.storyLabel} numberOfLines={1}>{(f.full_name ?? t('friends.unnamed')).split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {tab === 'feed' && (
        <View style={styles.composerWrap}>
          <TouchableOpacity style={styles.composerRow} onPress={() => setComposerOpen(o => !o)} activeOpacity={0.8}>
            <View style={styles.composerAvatar}>
              <Text style={styles.composerAvatarText}>{initial}</Text>
            </View>
            <View style={styles.composerPill}>
              <Text style={styles.composerPillText}>{t('activity.whatsOnYourMind')}</Text>
            </View>
            <Ionicons name={composerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
          </TouchableOpacity>

          {composerOpen && (
            <View style={styles.quickActionsRow}>
              {QUICK_ACTIONS.map(qa => (
                <TouchableOpacity key={qa.label} style={styles.quickAction} onPress={() => goQuickAction(qa.target)} activeOpacity={0.8}>
                  <View style={[styles.quickActionIcon, { backgroundColor: colors[qa.color] + '20' }]}>
                    <Ionicons name={qa.icon} size={17} color={colors[qa.color]} />
                  </View>
                  <Text style={styles.quickActionLabel}>{qa.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

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

  storiesRail: { paddingTop: 12 },
  storiesContent: { paddingHorizontal: 16, gap: 14 },
  storyItem: { alignItems: 'center', width: 60 },
  storyRing: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', padding: 2,
  },
  storyAddRing: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', padding: 2,
    borderWidth: 2, borderColor: colors.border,
  },
  storyAvatarInner: {
    flex: 1, width: '100%', borderRadius: 24, backgroundColor: colors.bgCard,
    alignItems: 'center', justifyContent: 'center',
  },
  storyAvatarText: { color: colors.text, fontWeight: weight.bold, fontSize: typography.base },
  storyAddBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  storyLabel: { fontSize: typography.xs, color: colors.textMuted, marginTop: 6, fontWeight: weight.medium },

  composerWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  composerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgCard,
    borderRadius: 22, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8,
  },
  composerAvatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  composerAvatarText: { color: colors.accentText ?? colors.bg, fontWeight: weight.bold, fontSize: typography.sm },
  composerPill: { flex: 1 },
  composerPillText: { color: colors.textDim, fontSize: typography.sm },

  quickActionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 10,
    backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: 8,
  },
  quickAction: { alignItems: 'center', gap: 6, flex: 1 },
  quickActionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },

  body: { flex: 1 },
});
