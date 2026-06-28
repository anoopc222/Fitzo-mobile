import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Modal, Alert,
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

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function fetchChallenges(userId) {
  const { data, error } = await supabase
    .from('challenges')
    .select('id, creator_id, name, type, goal_value, start_date, end_date, is_public, created_at, creator:profiles!challenges_creator_id_fkey(id,full_name), challenge_participants(id,user_id,joined_at,profiles:user_id(id,full_name))')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const list = data ?? [];

  // Compute each participant's progress for the challenge's date range, in
  // parallel per challenge, since challenge_participants has no stored
  // progress column — it must be derived from step_logs / workout_sessions.
  const withProgress = await Promise.all(list.map(async (c) => {
    const participants = c.challenge_participants ?? [];
    let progressByUser = {};
    if (participants.length > 0) {
      const { data: progressRows } = await supabase.rpc('get_challenge_progress', { p_challenge_id: c.id });
      (progressRows ?? []).forEach(r => {
        progressByUser[r.user_id] = r.progress;
      });
    }
    const participantsWithProgress = participants
      .map(p => ({ ...p, progress: progressByUser[p.user_id] ?? 0 }))
      .sort((a, b) => b.progress - a.progress);

    return {
      ...c,
      participants: participantsWithProgress,
      joined: participants.some(p => p.user_id === userId),
      myProgress: progressByUser[userId] ?? 0,
    };
  }));

  return withProgress;
}

async function createChallenge(userId, { name, type, goalValue, startDate, endDate, isPublic }) {
  const { data, error } = await supabase
    .from('challenges')
    .insert({ creator_id: userId, name, type, goal_value: goalValue, start_date: startDate, end_date: endDate, is_public: isPublic })
    .select('id')
    .single();
  if (error) throw error;
  const { error: joinError } = await supabase
    .from('challenge_participants')
    .insert({ challenge_id: data.id, user_id: userId });
  if (joinError) throw joinError;
}

async function joinChallenge(challengeId, userId) {
  const { error } = await supabase.from('challenge_participants').insert({ challenge_id: challengeId, user_id: userId });
  if (error) throw error;
}

async function leaveChallenge(challengeId, userId) {
  const { error } = await supabase.from('challenge_participants').delete().eq('challenge_id', challengeId).eq('user_id', userId);
  if (error) throw error;
}

export default function ChallengesScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['challenges', user?.id],
    queryFn: () => fetchChallenges(user.id),
    enabled: !!user?.id,
  });

  const invalidate = () => qc.invalidateQueries(['challenges', user.id]);

  const joinMut = useMutation({
    mutationFn: (challengeId) => joinChallenge(challengeId, user.id),
    onSuccess: invalidate,
  });
  const leaveMut = useMutation({
    mutationFn: (challengeId) => leaveChallenge(challengeId, user.id),
    onSuccess: invalidate,
  });
  const createMut = useMutation({
    mutationFn: (payload) => createChallenge(user.id, payload),
    onSuccess: () => { invalidate(); setShowCreate(false); },
    onError: (e) => Alert.alert(t('challenges.errorTitle'), e.message),
  });

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title={t('challenges.title')}
        colors={colors}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
          </TouchableOpacity>
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : (data ?? []).length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="trophy-outline" size={32} color={colors.textDim} />
            <Text style={styles.emptyText}>{t('challenges.empty')}</Text>
            <Text style={styles.emptySub}>{t('challenges.emptySub')}</Text>
          </View>
        ) : (
          data.map(c => {
            const isExpanded = expandedId === c.id;
            const unit = c.type === 'steps' ? t('challenges.steps') : t('challenges.days');
            const pct = c.goal_value > 0 ? Math.min(100, Math.round((c.myProgress / c.goal_value) * 100)) : 0;
            return (
              <TouchableOpacity
                key={c.id}
                style={styles.card}
                onPress={() => setExpandedId(isExpanded ? null : c.id)}
                activeOpacity={0.8}
              >
                <View style={styles.cardHeaderRow}>
                  <View style={[styles.typeIconWrap, { backgroundColor: colors.accent + '18' }]}>
                    <Ionicons name={c.type === 'steps' ? 'footsteps' : 'flame'} size={15} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{c.name}</Text>
                    <Text style={styles.cardSub}>
                      {t('challenges.byCreator', { name: c.creator?.full_name || t('friends.unnamed') })} · {c.participants.length} {t('challenges.participants')}
                    </Text>
                  </View>
                  {c.is_public && <View style={styles.publicBadge}><Text style={styles.publicBadgeText}>{t('challenges.public')}</Text></View>}
                </View>

                <Text style={styles.cardGoal}>
                  {t('challenges.goalLine', { value: c.goal_value, unit })} · {c.start_date} → {c.end_date}
                </Text>

                {c.joined && (
                  <View style={styles.progressBarOuter}>
                    <View style={[styles.progressBarInner, { width: `${pct}%`, backgroundColor: colors.accent }]} />
                  </View>
                )}

                <View style={styles.actionsRow}>
                  {c.joined ? (
                    <TouchableOpacity
                      style={styles.leaveBtn}
                      onPress={() => leaveMut.mutate(c.id)}
                      disabled={leaveMut.isPending}
                    >
                      <Text style={styles.leaveBtnText}>{t('challenges.leave')}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.joinBtn}
                      onPress={() => joinMut.mutate(c.id)}
                      disabled={joinMut.isPending}
                    >
                      <Text style={styles.joinBtnText}>{t('challenges.join')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {isExpanded && (
                  <View style={styles.leaderboard}>
                    <Text style={styles.leaderboardTitle}>{t('challenges.leaderboard')}</Text>
                    {c.participants.map((p, idx) => (
                      <View key={p.id} style={styles.leaderRow}>
                        <Text style={styles.leaderRank}>#{idx + 1}</Text>
                        <Text style={styles.leaderName}>{p.profiles?.full_name || t('friends.unnamed')}</Text>
                        <Text style={styles.leaderProgress}>{p.progress} {unit}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <CreateChallengeModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(payload) => createMut.mutate(payload)}
        creating={createMut.isPending}
        colors={colors}
        t={t}
      />
    </SafeAreaView>
  );
}

function CreateChallengeModal({ visible, onClose, onCreate, creating, colors, t }) {
  const styles = useMemo(() => createModalStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [type, setType] = useState('steps');
  const [goalValue, setGoalValue] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const today = useMemo(() => localDateStr(new Date()), []);
  const inAWeek = useMemo(() => localDateStr(new Date(Date.now() + 7 * 86400000)), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(inAWeek);

  const reset = () => {
    setName(''); setType('steps'); setGoalValue(''); setIsPublic(false);
    setStartDate(today); setEndDate(inAWeek);
  };

  const submit = () => {
    const goal = parseInt(goalValue, 10);
    if (!name.trim() || !goal || goal <= 0) {
      Alert.alert(t('challenges.errorTitle'), t('challenges.validationError'));
      return;
    }
    onCreate({ name: name.trim(), type, goalValue: goal, startDate, endDate, isPublic });
    reset();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('challenges.createTitle')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>{t('challenges.nameLabel')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('challenges.namePlaceholder')}
            placeholderTextColor={colors.textDim}
          />

          <Text style={styles.label}>{t('challenges.typeLabel')}</Text>
          <View style={styles.segmentRow}>
            {['steps', 'workout_streak'].map(v => (
              <TouchableOpacity
                key={v}
                style={[styles.segmentBtn, type === v && styles.segmentBtnActive]}
                onPress={() => setType(v)}
              >
                <Text style={[styles.segmentText, type === v && styles.segmentTextActive]}>
                  {v === 'steps' ? t('challenges.typeSteps') : t('challenges.typeWorkoutStreak')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('challenges.targetLabel')}</Text>
          <TextInput
            style={styles.input}
            value={goalValue}
            onChangeText={setGoalValue}
            placeholder={type === 'steps' ? t('challenges.targetStepsPlaceholder') : t('challenges.targetDaysPlaceholder')}
            placeholderTextColor={colors.textDim}
            keyboardType="number-pad"
          />

          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t('challenges.startLabel')}</Text>
              <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textDim} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t('challenges.endLabel')}</Text>
              <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textDim} />
            </View>
          </View>

          <TouchableOpacity style={styles.publicToggleRow} onPress={() => setIsPublic(v => !v)}>
            <Ionicons name={isPublic ? 'checkbox' : 'square-outline'} size={20} color={colors.accent} />
            <Text style={styles.publicToggleText}>{t('challenges.makePublic')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={creating}>
            {creating ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.submitBtnText}>{t('challenges.createButton')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
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
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  typeIconWrap: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text },
  cardSub: { fontSize: typography.xs, color: colors.textDim, marginTop: 1 },
  publicBadge: { backgroundColor: colors.good + '18', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  publicBadgeText: { fontSize: 10, fontWeight: weight.bold, color: colors.good },

  cardGoal: { fontSize: typography.sm, color: colors.textMuted, marginBottom: 10 },

  progressBarOuter: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', marginBottom: 10 },
  progressBarInner: { height: 6, borderRadius: 3 },

  actionsRow: { flexDirection: 'row' },
  joinBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  joinBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.xs },
  leaveBtn: { backgroundColor: colors.danger + '18', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  leaveBtnText: { color: colors.danger, fontWeight: weight.bold, fontSize: typography.xs },

  leaderboard: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
  leaderboardTitle: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  leaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  leaderRank: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.textDim, width: 24 },
  leaderName: { flex: 1, fontSize: typography.sm, color: colors.text },
  leaderProgress: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent },
});

const createModalStyles = (colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgCard, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderTopWidth: 1, borderColor: colors.border, padding: 18, paddingBottom: 32,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },

  label: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted, marginBottom: 6, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: typography.sm,
  },

  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  segmentBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { fontSize: typography.xs, fontWeight: weight.semibold, color: colors.textMuted },
  segmentTextActive: { color: colors.bg },

  dateRow: { flexDirection: 'row', gap: 10 },

  publicToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  publicToggleText: { fontSize: typography.sm, color: colors.text },

  submitBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 20 },
  submitBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
});
