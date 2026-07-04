import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  FlatList, Pressable,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import { SkeletonBlock } from './Skeleton';

const GAME_LABELS = {
  memoryMatch:    { name: 'Memory Match',     unit: 's',   lowerIsBetter: true,  emoji: '🃏' },
  reactionTap:    { name: 'Reaction Tap',     unit: 'ms',  lowerIsBetter: true,  emoji: '⚡' },
  calorieGuesser: { name: 'Calorie Guesser',  unit: 'pts', lowerIsBetter: false, emoji: '🍎' },
  higherOrLower:  { name: 'Higher or Lower',  unit: ' streak', lowerIsBetter: false, emoji: '⬆️' },
  nutritionTrivia:{ name: 'Nutrition Trivia', unit: '/3',  lowerIsBetter: false, emoji: '🧠' },
  dailySpin:      { name: 'Daily Spin',       unit: ' done', lowerIsBetter: false, emoji: '🎯' },
  macroMatch:      { name: 'Macro Match',       unit: ' pts', lowerIsBetter: false, emoji: '🥗' },
  foodSortingRush: { name: 'Food Sorting Rush', unit: ' pts', lowerIsBetter: false, emoji: '🍽️' },
  calorieStack:    { name: 'Calorie Stack',     unit: ' pts', lowerIsBetter: false, emoji: '🍔' },
  workoutBuilder:  { name: 'Workout Builder',   unit: ' pts', lowerIsBetter: false, emoji: '🏋️' },
  macroSniper:     { name: 'Macro Sniper',      unit: ' pts', lowerIsBetter: false, emoji: '🎯' },
  bodyClockQuiz:   { name: 'Body Clock Quiz',   unit: '/8',   lowerIsBetter: false, emoji: '⏰' },
};

const MEDALS = ['🥇', '🥈', '🥉'];

export async function upsertGameScore(userId, game, score) {
  const { data: existing } = await supabase
    .from('game_scores')
    .select('score')
    .eq('user_id', userId)
    .eq('game', game)
    .single();

  const meta = GAME_LABELS[game];
  const isBetter = !existing || (meta?.lowerIsBetter ? score < existing.score : score > existing.score);
  if (!isBetter) return;

  await supabase.from('game_scores').upsert(
    { user_id: userId, game, score, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,game' }
  );
}

const historyKey = (userId, game) => `fitzo:gameHistory:${userId}:${game}`;

export async function recordGameHistory(userId, game, score) {
  if (!userId) return;
  const key = historyKey(userId, game);
  const raw = await AsyncStorage.getItem(key);
  let arr = [];
  try { arr = raw ? JSON.parse(raw) : []; } catch {}
  arr.push(score);
  if (arr.length > 10) arr = arr.slice(arr.length - 10);
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

export default function GameLeaderboard({ game, userId, visible, onClose }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState(null);
  const [scoreHistory, setScoreHistory] = useState([]);

  const meta = GAME_LABELS[game] ?? { name: game, unit: '', lowerIsBetter: false, emoji: '🎮' };

  useEffect(() => {
    if (!visible || !userId) return;
    AsyncStorage.getItem(historyKey(userId, game)).then(raw => {
      try { setScoreHistory(raw ? JSON.parse(raw) : []); } catch { setScoreHistory([]); }
    });
  }, [visible, game, userId]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);

    supabase
      .from('game_scores')
      .select('user_id, score, updated_at')
      .eq('game', game)
      .order('score', { ascending: meta.lowerIsBetter })
      .limit(10)
      .then(async ({ data, error }) => {
        if (error) { setLoading(false); return; }
        const rows = data ?? [];

        // Fetch profile names for all user_ids in one query
        let nameMap = {};
        if (rows.length > 0) {
          const ids = rows.map(r => r.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', ids);
          (profiles ?? []).forEach(p => { nameMap[p.id] = p.full_name; });
        }

        const results = rows.map((r, i) => ({
          rank: i + 1,
          name: nameMap[r.user_id] ?? 'Anonymous',
          score: r.score,
          isMe: r.user_id === userId,
        }));
        setRows(results);

        // If user not in top 10, fetch their rank separately
        const myRow = results.find(r => r.isMe);
        if (myRow) {
          setMyRank(myRow.rank);
        } else if (userId) {
          const { count } = await supabase
            .from('game_scores')
            .select('*', { count: 'exact', head: true })
            .eq('game', game)
            .filter('score', meta.lowerIsBetter ? 'lt' : 'gt',
              (await supabase.from('game_scores').select('score').eq('game', game).eq('user_id', userId).single()).data?.score ?? 0
            );
          setMyRank(count != null ? count + 1 : null);
        } else {
          setMyRank(null);
        }

        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [visible, game, userId]);

  function HistorySparkline({ data, color }) {
    const W = 200, H = 48, pad = 4;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const points = data.map((v, i) => {
      const x = pad + (i / (data.length - 1)) * (W - pad * 2);
      const y = pad + (1 - (v - min) / range) * (H - pad * 2);
      return `${x},${y}`;
    }).join(' ');
    return (
      <Svg width={W} height={H}>
        <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    );
  }

  function formatScore(score) {
    if (meta.lowerIsBetter && meta.unit === 's') return `${(score / 1000).toFixed(2)}s`;
    return `${score}${meta.unit}`;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />

          <Text style={s.gameEmoji}>{meta.emoji}</Text>
          <Text style={s.title}>{meta.name}</Text>
          <Text style={s.subtitle}>Top 10 Leaderboard</Text>

          {loading ? (
            <View style={s.skeletonList}>
              {Array.from({ length: 5 }).map((_, i) => (
                <View key={i} style={s.skeletonRow}>
                  <SkeletonBlock width={28} height={14} radius={4} />
                  <SkeletonBlock height={14} radius={4} style={{ flex: 1 }} />
                  <SkeletonBlock width={50} height={14} radius={4} />
                </View>
              ))}
            </View>
          ) : rows.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyEmoji}>🏁</Text>
              <Text style={s.emptyText}>No scores yet — be the first!</Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(_, i) => String(i)}
              style={s.list}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={[s.row, item.isMe && s.rowMe]}>
                  <Text style={s.rankText}>
                    {item.rank <= 3 ? MEDALS[item.rank - 1] : `#${item.rank}`}
                  </Text>
                  <Text style={[s.nameText, item.isMe && s.nameMe]} numberOfLines={1}>
                    {item.name}{item.isMe ? ' (you)' : ''}
                  </Text>
                  <Text style={[s.scoreText, item.isMe && { color: colors.accent }]}>
                    {formatScore(item.score)}
                  </Text>
                </View>
              )}
            />
          )}

          {myRank && myRank > 10 && (
            <Text style={s.myRankNote}>Your rank: #{myRank}</Text>
          )}

          {scoreHistory.length >= 3 && (
            <View style={s.historyBox}>
              <Text style={s.historyLabel}>Your recent scores</Text>
              <HistorySparkline data={scoreHistory} color={colors.accent} />
            </View>
          )}

          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <Text style={s.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = (colors) => StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111118', borderTopLeftRadius: 24, borderTopRightRadius: 24, /* hardcoded: must stay solid even inside game modal ThemeContext overrides */
    padding: 24, paddingBottom: 36, alignItems: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 20 },
  gameEmoji: { fontSize: 36, marginBottom: 6 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, marginBottom: 2 },
  subtitle: { fontSize: typography.xs, color: colors.textDim, marginBottom: 16, letterSpacing: 1, textTransform: 'uppercase' },

  list: { width: '100%', marginBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  rowMe: { backgroundColor: colors.accent + '0e', borderRadius: 8, paddingHorizontal: 6, borderBottomWidth: 0, marginBottom: 1 },
  rankText: { width: 28, fontSize: typography.sm, fontWeight: weight.bold, color: colors.textDim, textAlign: 'center' },
  nameText: { flex: 1, fontSize: typography.sm, color: colors.text },
  nameMe: { fontWeight: weight.bold, color: colors.text },
  scoreText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textDim },

  emptyBox: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyEmoji: { fontSize: 32 },
  emptyText: { fontSize: typography.sm, color: colors.textDim },

  myRankNote: { fontSize: typography.xs, color: colors.textDim, marginBottom: 8 },
  historyBox: { width: '100%', alignItems: 'center', paddingTop: 12, paddingBottom: 4 },
  historyLabel: { fontSize: typography.xs, color: colors.textDim, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' },
  skeletonList: { width: '100%', marginTop: 16, gap: 12, marginBottom: 8 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 48, marginTop: 10 },
  closeBtnText: { fontSize: typography.base, fontWeight: weight.bold, color: '#000' },
});
