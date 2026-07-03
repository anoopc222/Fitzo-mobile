import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator, FlatList, Pressable,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';

const GAME_LABELS = {
  memoryMatch:    { name: 'Memory Match',     unit: 's',   lowerIsBetter: true,  emoji: '🃏' },
  reactionTap:    { name: 'Reaction Tap',     unit: 'ms',  lowerIsBetter: true,  emoji: '⚡' },
  calorieGuesser: { name: 'Calorie Guesser',  unit: 'pts', lowerIsBetter: false, emoji: '🍎' },
  higherOrLower:  { name: 'Higher or Lower',  unit: ' streak', lowerIsBetter: false, emoji: '⬆️' },
  nutritionTrivia:{ name: 'Nutrition Trivia', unit: '/3',  lowerIsBetter: false, emoji: '🧠' },
  dailySpin:      { name: 'Daily Spin',       unit: ' done', lowerIsBetter: false, emoji: '🎯' },
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

export default function GameLeaderboard({ game, userId, visible, onClose }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState(null);

  const meta = GAME_LABELS[game] ?? { name: game, unit: '', lowerIsBetter: false, emoji: '🎮' };

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    supabase
      .from('game_scores')
      .select('user_id, score, updated_at, profiles(full_name)')
      .eq('game', game)
      .order('score', { ascending: meta.lowerIsBetter })
      .limit(10)
      .then(({ data }) => {
        const results = (data ?? []).map((r, i) => ({
          rank: i + 1,
          name: r.profiles?.full_name ?? 'Anonymous',
          score: r.score,
          isMe: r.user_id === userId,
        }));
        setRows(results);
        const myRow = results.find(r => r.isMe);
        setMyRank(myRow?.rank ?? null);
        setLoading(false);
      });
  }, [visible, game]);

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
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
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
    backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
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
  closeBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 48, marginTop: 10 },
  closeBtnText: { fontSize: typography.base, fontWeight: weight.bold, color: colors.bg },
});
