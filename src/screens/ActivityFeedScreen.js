import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

const TYPE_ICON = {
  workout: 'barbell',
  pr: 'trophy',
  weight: 'scale',
  steps: 'footsteps',
  sleep: 'moon',
  food: 'restaurant',
};

const TYPE_EMOJI = {
  workout: '💪',
  pr: '🏆',
  weight: '⚖️',
  steps: '🚶',
  sleep: '😴',
  food: '🍽️',
};

const TYPE_GRADIENT = {
  workout: ['#9d4edd', '#c77dff'],
  pr: ['#ffd60a', '#ffb700'],
  weight: ['#4ea8ff', '#2389ff'],
  steps: ['#3ddc84', '#1fb35a'],
  sleep: ['#7c8cff', '#5a6cff'],
  food: ['#ff9f4e', '#ff7a1a'],
};

const TYPE_COLOR = {
  workout: '#9d4edd',
  pr: '#ffd60a',
  weight: '#4ea8ff',
  steps: '#3ddc84',
  sleep: '#7c8cff',
  food: '#ff9f4e',
};

export async function fetchActivityFeed(userId) {
  const { data, error } = await supabase
    .from('activity_feed')
    .select(`
      id, user_id, type, title, detail, created_at,
      profiles:user_id (id, full_name),
      activity_likes (id, user_id),
      activity_comments (id, user_id, body, created_at, profiles:user_id (id, full_name))
    `)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  return (data ?? []).map(row => ({
    ...row,
    likeCount: row.activity_likes?.length ?? 0,
    likedByMe: (row.activity_likes ?? []).some(l => l.user_id === userId),
    comments: (row.activity_comments ?? []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  }));
}

async function toggleLike(activityId, userId, currentlyLiked) {
  if (currentlyLiked) {
    const { error } = await supabase.from('activity_likes').delete().eq('activity_id', activityId).eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('activity_likes').insert({ activity_id: activityId, user_id: userId });
    if (error) throw error;
  }
}

async function addComment(activityId, userId, body) {
  const { error } = await supabase.from('activity_comments').insert({ activity_id: activityId, user_id: userId, body });
  if (error) throw error;
}

function detailChipIcon(part) {
  const p = part.toLowerCase();
  if (p.includes('top set') || p.includes('pr')) return 'flame';
  if (p.includes('exercise')) return 'list';
  if (p.includes('volume') || p.includes('kg')) return 'stats-chart';
  if (p.includes('goal')) return 'checkmark-circle';
  return 'stats-chart';
}

function timeAgo(iso, t) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('activity.justNow');
  if (mins < 60) return t('activity.minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('activity.hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  return t('activity.daysAgo', { count: days });
}

export default function ActivityFeedScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState(null);
  const [commentDrafts, setCommentDrafts] = useState({});

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['activityFeed', user?.id],
    queryFn: () => fetchActivityFeed(user.id),
    enabled: !!user?.id,
  });

  const invalidate = () => qc.invalidateQueries(['activityFeed', user.id]);

  const likeMut = useMutation({
    mutationFn: ({ activityId, likedByMe }) => toggleLike(activityId, user.id, likedByMe),
    onSuccess: invalidate,
  });

  const commentMut = useMutation({
    mutationFn: ({ activityId, body }) => addComment(activityId, user.id, body),
    onSuccess: (_data, { activityId }) => {
      setCommentDrafts(prev => ({ ...prev, [activityId]: '' }));
      invalidate();
    },
  });

  const submitComment = (activityId) => {
    const body = (commentDrafts[activityId] ?? '').trim();
    if (!body) return;
    commentMut.mutate({ activityId, body });
  };

  const shareItem = (item) => {
    const lines = [item.title, item.detail].filter(Boolean);
    Share.share({ message: lines.join('\n') }).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title={t('activity.title')} colors={colors} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} colors={[colors.accent]} />
          }
        >
          {isLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : (data ?? []).length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="people-outline" size={32} color={colors.textDim} />
              <Text style={styles.emptyText}>{t('activity.empty')}</Text>
              <Text style={styles.emptySub}>{t('activity.emptySub')}</Text>
            </View>
          ) : (
            data.map(item => {
              const isExpanded = expandedId === item.id;
              const typeColor = TYPE_COLOR[item.type] ?? colors.accent;
              const gradient = TYPE_GRADIENT[item.type] ?? [colors.accent, colors.accent];
              return (
                <View key={item.id} style={styles.card}>
                  <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.topStripe} />
                  <View style={styles.cardBody}>
                    <View style={styles.cardHeader}>
                      <Avatar name={item.profiles?.full_name} colors={colors} gradient={gradient} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardName}>{item.profiles?.full_name || t('friends.unnamed')}</Text>
                        <View style={styles.metaRow}>
                          <View style={[styles.typeTag, { backgroundColor: typeColor + '20' }]}>
                            <Text style={[styles.typeTagText, { color: typeColor }]}>{item.type?.toUpperCase()}</Text>
                          </View>
                          <Text style={styles.cardTime}>{timeAgo(item.created_at, t)}</Text>
                        </View>
                      </View>
                      <LinearGradient colors={gradient} style={styles.typeIconWrap}>
                        <Ionicons name={TYPE_ICON[item.type] ?? 'sparkles'} size={18} color="#fff" />
                      </LinearGradient>
                    </View>

                    <Text style={styles.cardTitle}>{TYPE_EMOJI[item.type] ?? '✨'}  {item.title}</Text>

                    {item.detail ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.detailScroll}>
                        {item.detail.split(' • ').map((part, i) => (
                          <LinearGradient key={i} colors={[typeColor + 'CC', typeColor + '99']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.detailChip}>
                            <Ionicons name={detailChipIcon(part)} size={12} color="#fff" style={{ marginRight: 6 }} />
                            <Text style={styles.detailChipText}>{part}</Text>
                          </LinearGradient>
                        ))}
                      </ScrollView>
                    ) : null}

                    <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[styles.actionBtn, item.likedByMe && { backgroundColor: colors.danger + '18' }]}
                        onPress={() => likeMut.mutate({ activityId: item.id, likedByMe: item.likedByMe })}
                        disabled={likeMut.isPending}
                        activeOpacity={0.7}
                      >
                        <Ionicons
                          name={item.likedByMe ? 'heart' : 'heart-outline'}
                          size={18}
                          color={item.likedByMe ? colors.danger : colors.textMuted}
                        />
                        <Text style={[styles.actionText, item.likedByMe && { color: colors.danger }]}>
                          {item.likeCount > 0 ? item.likeCount : t('activity.like')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, isExpanded && { backgroundColor: colors.accent + '18' }]}
                        onPress={() => setExpandedId(isExpanded ? null : item.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name={isExpanded ? 'chatbubble' : 'chatbubble-outline'} size={17} color={isExpanded ? colors.accent : colors.textMuted} />
                        <Text style={[styles.actionText, isExpanded && { color: colors.accent }]}>
                          {item.comments.length > 0 ? item.comments.length : t('activity.comment')}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => shareItem(item)} activeOpacity={0.7}>
                        <Ionicons name="share-social-outline" size={17} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>

                    {isExpanded && (
                      <View style={styles.commentsSection}>
                        {item.comments.length === 0 ? (
                          <Text style={styles.noComments}>{t('activity.commentPlaceholder')}</Text>
                        ) : item.comments.map(c => (
                          <View key={c.id} style={styles.commentRow}>
                            <Avatar name={c.profiles?.full_name} colors={colors} gradient={gradient} size={28} />
                            <View style={styles.commentBubble}>
                              <Text style={styles.commentName}>{c.profiles?.full_name || t('friends.unnamed')}</Text>
                              <Text style={styles.commentBody}>{c.body}</Text>
                            </View>
                          </View>
                        ))}
                        <View style={styles.commentInputRow}>
                          <Avatar name={user?.user_metadata?.full_name} colors={colors} gradient={gradient} size={28} />
                          <TextInput
                            style={styles.commentInput}
                            placeholder={t('activity.commentPlaceholder')}
                            placeholderTextColor={colors.textDim}
                            value={commentDrafts[item.id] ?? ''}
                            onChangeText={(v) => setCommentDrafts(prev => ({ ...prev, [item.id]: v }))}
                            maxLength={500}
                          />
                          <TouchableOpacity
                            onPress={() => submitComment(item.id)}
                            disabled={commentMut.isPending || !(commentDrafts[item.id] ?? '').trim()}
                            style={!(commentDrafts[item.id] ?? '').trim() && { opacity: 0.4 }}
                          >
                            <LinearGradient colors={gradient} style={styles.commentSendBtn}>
                              <Ionicons name="send" size={14} color="#fff" />
                            </LinearGradient>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Avatar({ name, colors, size = 36, gradient }) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  const inner = size - 4;
  return (
    <LinearGradient
      colors={gradient ?? [colors.accent, colors.accent]}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{
        width: inner, height: inner, borderRadius: inner / 2, backgroundColor: colors.bgCard,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: colors.text, fontWeight: weight.bold, fontSize: size > 30 ? typography.sm : typography.xs }}>{initial}</Text>
      </View>
    </LinearGradient>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },

  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: typography.base, color: colors.text, fontWeight: weight.semibold },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', paddingHorizontal: 20 },

  card: {
    backgroundColor: colors.bgCard, borderRadius: 20, overflow: 'hidden',
    marginBottom: 16, borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  topStripe: { height: 4, width: '100%' },
  cardBody: { padding: 16 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  cardName: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  typeTag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  typeTagText: { fontSize: 10, fontWeight: weight.bold, letterSpacing: 0.5 },
  cardTime: { fontSize: typography.xs, color: colors.textDim },
  typeIconWrap: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  cardTitle: { fontSize: typography.lg, fontWeight: weight.black, color: colors.text, marginBottom: 10 },

  detailScroll: { marginBottom: 4 },
  detailChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8,
  },
  detailChipText: { fontSize: typography.xs, fontWeight: weight.bold, color: '#fff' },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18,
  },
  actionText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.bold },

  commentsSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  noComments: { fontSize: typography.xs, color: colors.textDim, fontStyle: 'italic', paddingVertical: 4 },
  commentRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  commentBubble: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  commentName: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text, marginBottom: 2 },
  commentBody: { fontSize: typography.xs, color: colors.textMuted },

  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  commentInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 14, paddingVertical: 9, color: colors.text, fontSize: typography.sm,
  },
  commentSendBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
