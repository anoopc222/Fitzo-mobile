import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
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
            <ActivityIndicator />
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
              return (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Avatar name={item.profiles?.full_name} colors={colors} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardName}>{item.profiles?.full_name || t('friends.unnamed')}</Text>
                      <Text style={styles.cardTime}>{timeAgo(item.created_at, t)}</Text>
                    </View>
                    <View style={[styles.typeIconWrap, { backgroundColor: colors.accent + '18' }]}>
                      <Ionicons name={TYPE_ICON[item.type] ?? 'sparkles'} size={14} color={colors.accent} />
                    </View>
                  </View>

                  <Text style={styles.cardTitle}>{item.title}</Text>
                  {item.detail ? <Text style={styles.cardDetail}>{item.detail}</Text> : null}

                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => likeMut.mutate({ activityId: item.id, likedByMe: item.likedByMe })}
                      disabled={likeMut.isPending}
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
                      style={styles.actionBtn}
                      onPress={() => setExpandedId(isExpanded ? null : item.id)}
                    >
                      <Ionicons name="chatbubble-outline" size={15} color={colors.textMuted} />
                      <Text style={styles.actionText}>
                        {item.comments.length > 0 ? item.comments.length : t('activity.comment')}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {isExpanded && (
                    <View style={styles.commentsSection}>
                      {item.comments.map(c => (
                        <View key={c.id} style={styles.commentRow}>
                          <Text style={styles.commentName}>{c.profiles?.full_name || t('friends.unnamed')}</Text>
                          <Text style={styles.commentBody}>{c.body}</Text>
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
                          style={styles.commentSendBtn}
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

function Avatar({ name, colors }) {
  const initial = (name?.[0] ?? '?').toUpperCase();
  return (
    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.bg, fontWeight: weight.bold, fontSize: typography.sm }}>{initial}</Text>
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
    padding: 14, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  cardName: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  cardTime: { fontSize: typography.xs, color: colors.textDim, marginTop: 1 },
  typeIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text, marginBottom: 2 },
  cardDetail: { fontSize: typography.sm, color: colors.textMuted },

  actionsRow: { flexDirection: 'row', gap: 18, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },

  commentsSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 8 },
  commentRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  commentName: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text },
  commentBody: { fontSize: typography.xs, color: colors.textMuted, flex: 1 },

  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  commentInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 10, paddingVertical: 8, color: colors.text, fontSize: typography.sm,
  },
  commentSendBtn: { backgroundColor: colors.accent, borderRadius: 10, padding: 9, alignItems: 'center', justifyContent: 'center' },
});
