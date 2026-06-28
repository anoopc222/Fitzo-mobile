import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activity';
import { typography, weight, fontFamily } from '../theme/typography';
import ActivityFeedScreen from './ActivityFeedScreen';
import FriendsScreen, { fetchFriendsData } from './FriendsScreen';
import ChallengesScreen from './ChallengesScreen';

const TABS = [
  { key: 'feed', icon: 'home', activeIcon: 'home' },
  { key: 'log', icon: 'add-circle-outline', activeIcon: 'add-circle' },
  { key: 'friends', icon: 'people-outline', activeIcon: 'people' },
  { key: 'challenges', icon: 'trophy-outline', activeIcon: 'trophy' },
];

const QUICK_ACTIONS = [
  { label: 'Weight', icon: 'scale', target: 'Weight', type: 'weight', color: 'blue' },
  { label: 'Steps', icon: 'footsteps', target: 'Steps', type: 'steps', color: 'good' },
  { label: 'Sleep', icon: 'moon', target: 'Sleep', type: 'sleep', color: 'purple' },
  { label: 'Food', icon: 'restaurant', target: 'Log', type: 'food', color: 'accent2' },
  { label: 'Workout', icon: 'barbell', target: 'Workout', type: 'workout', color: 'danger' },
];

const LOG_OPTIONS = [
  { label: 'Workout', icon: 'barbell', target: 'Workout', type: 'workout', color: 'danger' },
  { label: 'Steps', icon: 'footsteps', target: 'Steps', type: 'steps', color: 'good' },
  { label: 'Weight', icon: 'scale', target: 'Weight', type: 'weight', color: 'blue' },
  { label: 'Sleep', icon: 'moon', target: 'Sleep', type: 'sleep', color: 'purple' },
];

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchTodaySummary(userId, type) {
  const today = localDateStr(new Date());

  if (type === 'weight') {
    const { data } = await supabase.from('weight_logs').select('weight, notes').eq('user_id', userId).eq('logged_at', today).order('id', { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    return { title: 'Logged weight', detail: data.notes ? `${data.weight} kg — ${data.notes}` : `${data.weight} kg` };
  }
  if (type === 'steps') {
    const { data } = await supabase.from('step_logs').select('steps, goal').eq('user_id', userId).eq('logged_at', today).order('id', { ascending: false }).limit(1).maybeSingle();
    if (!data || !data.steps) return null;
    return { title: 'Logged steps', detail: `${data.steps.toLocaleString()} steps${data.goal && data.steps >= data.goal ? ' — goal reached!' : ''}` };
  }
  if (type === 'sleep') {
    const { data } = await supabase.from('sleep_logs').select('hours').eq('user_id', userId).eq('logged_at', today).order('id', { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    return { title: 'Logged sleep', detail: `${data.hours} hrs` };
  }
  if (type === 'food') {
    const { data } = await supabase.from('food_logs').select('calories').eq('user_id', userId).gte('logged_at', `${today}T00:00:00`).lte('logged_at', `${today}T23:59:59`);
    if (!data || data.length === 0) return null;
    const totalCalories = data.reduce((s, f) => s + (f.calories || 0), 0);
    return { title: 'Logged meals today', detail: `${data.length} meal${data.length > 1 ? 's' : ''} — ${Math.round(totalCalories)} kcal` };
  }
  if (type === 'workout') {
    const { data } = await supabase.from('workout_sessions').select('id, notes, total_volume, duration_min').eq('user_id', userId).eq('date', today).order('id', { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    const parts = [];
    if (data.total_volume) parts.push(`${Math.round(data.total_volume)} kg volume`);
    if (data.duration_min) parts.push(`${data.duration_min} min`);
    return { title: data.notes || 'Workout', detail: parts.join(' • ') };
  }
  return null;
}

export default function SocialScreen({ navigation }) {
  const { user } = useAuth();
  const { colors, isDark, setIsDark } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tab, setTab] = useState('feed');
  const [composerOpen, setComposerOpen] = useState(false);
  const [shareSheet, setShareSheet] = useState(null); // { qa, loading, summary }
  const [posting, setPosting] = useState(false);
  const qc = useQueryClient();

  const displayName = user?.user_metadata?.full_name ?? 'You';
  const initial = (displayName[0] ?? 'F').toUpperCase();

  const { data: friendsData } = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriendsData(user.id),
    enabled: !!user?.id,
  });
  const incomingCount = friendsData?.incoming?.length ?? 0;

  const { data: todayLogs } = useQuery({
    queryKey: ['todayLogs', user?.id, localDateStr(new Date())],
    queryFn: async () => {
      const entries = await Promise.all(LOG_OPTIONS.map(o => fetchTodaySummary(user.id, o.type).then(s => [o.type, s])));
      return Object.fromEntries(entries);
    },
    enabled: !!user?.id && tab === 'log',
  });

  const goQuickAction = async (qa) => {
    setComposerOpen(false);
    if (!user?.id) { navigation.navigate(qa.target); return; }
    setShareSheet({ qa, loading: true, summary: null });
    const summary = await fetchTodaySummary(user.id, qa.type).catch(() => null);
    if (!summary) { setShareSheet(null); navigation.navigate(qa.target); return; }
    setShareSheet({ qa, loading: false, summary });
  };

  const closeShareSheet = () => setShareSheet(null);

  const postShare = () => {
    if (!shareSheet?.summary || !user?.id) return;
    setPosting(true);
    logActivity(user.id, shareSheet.qa.type, shareSheet.summary.title, shareSheet.summary.detail);
    qc.invalidateQueries(['activityFeed', user.id]);
    setPosting(false);
    setShareSheet(null);
    setTab('feed');
  };

  return (
    <SafeAreaView style={styles.safe}>
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
                <TouchableOpacity key={qa.label} style={styles.quickAction} onPress={() => goQuickAction(qa)} activeOpacity={0.8}>
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
        {tab === 'log' && (
          <View style={styles.logBody}>
            <Text style={styles.logHeading}>Log today's activity</Text>
            <Text style={styles.logSubheading}>Tap a card to log it and share your progress with friends.</Text>
            <View style={styles.logGrid}>
              {LOG_OPTIONS.map(opt => {
                const logged = !!todayLogs?.[opt.type];
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={styles.logCard}
                    onPress={() => goQuickAction(opt)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.logCardIcon, { backgroundColor: colors[opt.color] + '20' }]}>
                      <Ionicons name={opt.icon} size={26} color={colors[opt.color]} />
                    </View>
                    <Text style={styles.logCardLabel}>{opt.label}</Text>
                    <View style={styles.logCardStatusRow}>
                      <Ionicons
                        name={logged ? 'checkmark-circle' : 'add-circle-outline'}
                        size={13}
                        color={logged ? colors.success : colors.textDim}
                      />
                      <Text style={[styles.logCardStatus, logged && { color: colors.success }]}>
                        {logged ? 'Logged today' : 'Log now'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
        {tab === 'friends' && <FriendsScreen navigation={navigation} embedded />}
        {tab === 'challenges' && <ChallengesScreen navigation={navigation} embedded />}
      </View>

      <Modal visible={!!shareSheet} transparent animationType="fade" onRequestClose={closeShareSheet}>
        <Pressable style={styles.shareBackdrop} onPress={closeShareSheet} />
        <View style={styles.shareSheet}>
          {shareSheet?.loading ? (
            <ActivityIndicator color={colors.accent} style={{ paddingVertical: 24 }} />
          ) : shareSheet?.summary && (
            <>
              <View style={styles.shareHeader}>
                <View style={[styles.shareIcon, { backgroundColor: colors[shareSheet.qa.color] + '20' }]}>
                  <Ionicons name={shareSheet.qa.icon} size={18} color={colors[shareSheet.qa.color]} />
                </View>
                <Text style={styles.shareTitle}>{shareSheet.summary.title}</Text>
              </View>
              <Text style={styles.shareDetail}>{shareSheet.summary.detail}</Text>
              <TouchableOpacity style={styles.sharePostBtn} onPress={postShare} disabled={posting} activeOpacity={0.8}>
                <Ionicons name="share-social" size={16} color={colors.accentText ?? colors.bg} />
                <Text style={styles.sharePostBtnText}>Share to feed</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareCancelBtn} onPress={closeShareSheet}>
                <Text style={styles.shareCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
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

  composerWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
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

  logBody: { flex: 1, paddingHorizontal: 16, paddingTop: 18 },
  logHeading: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  logSubheading: { fontSize: typography.sm, color: colors.textMuted, marginTop: 4, marginBottom: 18 },
  logGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  logCard: {
    width: '47%', backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 18, paddingHorizontal: 14, alignItems: 'flex-start', gap: 4,
  },
  logCardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logCardLabel: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  logCardStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  logCardStatus: { fontSize: typography.xs, color: colors.textDim, fontWeight: weight.semibold },

  shareBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  shareSheet: {
    position: 'absolute', left: 16, right: 16, top: '32%',
    backgroundColor: colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
    padding: 18,
  },
  shareHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  shareTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text, flex: 1 },
  shareDetail: { fontSize: typography.sm, color: colors.textMuted, marginTop: 10, marginBottom: 16 },
  sharePostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 12,
  },
  sharePostBtnText: { color: colors.accentText ?? colors.bg, fontWeight: weight.bold, fontSize: typography.sm },
  shareCancelBtn: { alignItems: 'center', paddingVertical: 12 },
  shareCancelBtnText: { color: colors.textDim, fontWeight: weight.semibold, fontSize: typography.sm },
});
