import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
              return (
                <View key={item.id} style={[styles.card, { borderLeftColor: typeColor }]}>
                  <View style={styles.cardHeader}>
                    <Avatar name={item.profiles?.full_name} colors={colors} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName}>{item.profiles?.full_name || t('friends.unnamed')}</Text>
                      <Text style={styles.cardTime}>{timeAgo(item.created_at, t)}</Text>
                    </View>
                    <View style={[styles.typeIconWrap, { backgroundColor: typeColor + '22' }]}>
                      <Ionicons name={TYPE_ICON[item.type] ?? 'sparkles'} size={18} color={typeColor} />
                    </View>
                  </View>

                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.detail ? (
                    <View style={styles.detailRow}>
                      {item.detail.split(' • ').map((part, i) => (
                        <View key={i} style={[styles.detailBadge, { backgroundColor: typeColor + '14', borderColor: typeColor + '40' }]}>
                          <Ionicons name={detailChipIcon(part)} size={12} color={typeColor} style={{ marginRight: 6 }} />
                          <Text style={[styles.cardDetail, { color: typeColor }]}>{part}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={[styles.actionBtn, item.likedByMe && styles.actionBtnActive]}
                      onPress={() => likeMut.mutate({ activityId: item.id, likedByMe: item.likedByMe })}
                      disabled={likeMut.isPending}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={item.likedByMe ? 'heart' : 'heart-outline'}
                        size={16}
                        color={item.likedByMe ? colors.danger : colors.textMuted}
                      />
                      <Text style={[styles.actionText, item.likedByMe && { color: colors.danger }]}>
                        {item.likeCount > 0 ? item.likeCount : t('activity.like')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, isExpanded && styles.actionBtnActive]}
                      onPress={() => setExpandedId(isExpanded ? null : item.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={isExpanded ? 'chatbubble' : 'chatbubble-outline'} size={15} color={isExpanded ? colors.accent : colors.textMuted} />
                      <Text style={[styles.actionText, isExpanded && { color: colors.accent }]}>
                        {item.comments.length > 0 ? item.comments.length : t('activity.comment')}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {isExpanded && (
                    <View style={styles.commentsSection}>
                      {item.comments.length === 0 ? (
                        <Text style={styles.noComments}>{t('activity.commentPlaceholder')}</Text>
                      ) : item.comments.map(c => (
                        <View key={c.id} style={styles.commentRow}>
                          <Avatar name={c.profiles?.full_name} colors={colors} size={26} />
                          <View style={styles.commentBubble}>
                            <Text style={styles.commentName}>{c.profiles?.full_name || t('friends.unnamed')}</Text>
                            <Text style={styles.commentBody}>{c.body}</Text>
                          </View>
                        </View>
                      ))}
                      <View style={styles.commentInputRow}>
                        <TextInput
                          style={styles.commentInput}
                          placeholder={t('activity.commentPlaceholder')}
                          placeholderTextColor={colors.textDim}
                          value={commentDrafts[item.id] ?? ''}
                          onChangeText={(v) => setCommentDrafts(prev => ({ ...prev, [item.id]: v }))}
                          maxLength={500}
                        />
                        <TouchableOpacity
                          style={[styles.commentSendBtn, !(commentDrafts[item.id] ?? '').trim() && { opacity: 0.4 }]}
                          onPress={() => submitComment(item.id)}
                          disabled={commentMut.isPending || !(commentDrafts[item.id] ?? '').trim()}
                        >
                          <Ionicons name="send" size={14} color={colors.bg} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Avatar({ name, colors, size = 34 }) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.bg, fontWeight: weight.bold, fontSize: size > 30 ? typography.sm : typography.xs }}>{initial}</Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },

  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyText: { fontSize: typography.base, color: colors.text, fontWeight: weight.semibold },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', paddingHorizontal: 20 },

  card: {
    backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    borderLeftWidth: 3, padding: 14, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardName: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  cardTime: { fontSize: typography.xs, color: colors.textDim, marginTop: 1 },
  typeIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  cardTitle: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, marginBottom: 8 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  detailBadge: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6,
  },
  cardDetail: { fontSize: typography.sm, fontWeight: weight.semibold },

  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
  },
  actionBtnActive: { backgroundColor: colors.bg },
  actionText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },

  commentsSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 10 },
  noComments: { fontSize: typography.xs, color: colors.textDim, fontStyle: 'italic', paddingVertical: 4 },
  commentRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  commentBubble: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  commentName: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text, marginBottom: 2 },
  commentBody: { fontSize: typography.xs, color: colors.textMuted },

  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  commentInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 8, color: colors.text, fontSize: typography.sm,
  },
  commentSendBtn: { backgroundColor: colors.accent, borderRadius: 10, padding: 9, alignItems: 'center', justifyContent: 'center' },
});
