import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import GameLeaderboard, { upsertGameScore } from './GameLeaderboard';
import { useSound } from '../lib/useSound';
import { haptics } from '../lib/haptics';

const EMOJIS = ['💪', '🔥', '🏆', '🧘', '⚡', '💧', '🥗', '🏃'];
const CARD_COUNT = 16; // 8 pairs

function storageKey(userId) {
  return `fitzo:memoryMatch:${userId}:bestTime`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeCards() {
  return shuffle([...EMOJIS, ...EMOJIS]).map((emoji, id) => ({ id, emoji }));
}

function fmtTime(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function MemoryMatch({ userId }) {
  const { colors } = useTheme();

  const [cards, setCards] = useState(makeCards);
  const [revealed, setRevealed] = useState(new Set());
  const [matched, setMatched] = useState(new Set());
  const [pending, setPending] = useState([]); // up to 2 card IDs awaiting check
  const { play } = useSound();
  const [locked, setLocked] = useState(false);
  const [moves, setMoves] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [bestTime, setBestTime] = useState(null);
  const [won, setWon] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  // Per-card scale animations for match pop
  const scaleAnims = useRef(cards.map(() => new Animated.Value(1))).current;
  // Shake anim for mismatch
  const shakeAnim = useRef(new Animated.Value(0)).current;
  // Win scale
  const winAnim = useRef(new Animated.Value(0)).current;

  const timerRef = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem(storageKey(userId)).then(v => v && setBestTime(Number(v)));
  }, [userId]);

  useEffect(() => {
    if (startTime && !won) {
      timerRef.current = setInterval(() => setElapsed(Date.now() - startTime), 500);
    }
    return () => clearInterval(timerRef.current);
  }, [startTime, won]);

  const popCard = useCallback((id) => {
    Animated.sequence([
      Animated.timing(scaleAnims[id], { toValue: 1.25, duration: 120, useNativeDriver: true }),
      Animated.spring(scaleAnims[id], { toValue: 1, useNativeDriver: true, bounciness: 12 }),
    ]).start();
  }, [scaleAnims]);

  const shake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  const handlePress = useCallback((id) => {
    if (locked || matched.has(id) || revealed.has(id)) return;
    haptics.light();

    if (!startTime) setStartTime(Date.now());

    const nextRevealed = new Set(revealed);
    nextRevealed.add(id);
    setRevealed(nextRevealed);
    play('flip');

    const nextPending = [...pending, id];

    if (nextPending.length < 2) {
      setPending(nextPending);
      return;
    }

    // Two cards flipped — evaluate
    setPending([]);
    setLocked(true);
    setMoves(m => m + 1);

    const [a, b] = nextPending;
    const emojiA = cards[a].emoji;
    const emojiB = cards[b].emoji;

    if (emojiA === emojiB) {
      // Match!
      haptics.success();
      const nextMatched = new Set(matched);
      nextMatched.add(a);
      nextMatched.add(b);
      setMatched(nextMatched);
      popCard(a);
      popCard(b);
      play('match');
      setLocked(false);

      if (nextMatched.size === CARD_COUNT) {
        // Won
        clearInterval(timerRef.current);
        const finalTime = Date.now() - startTime;
        setElapsed(finalTime);
        setWon(true);
        play('win');
        if (!bestTime || finalTime < bestTime) {
          setBestTime(finalTime);
          AsyncStorage.setItem(storageKey(userId), String(finalTime));
          upsertGameScore(userId, 'memoryMatch', finalTime);
        }
        Animated.spring(winAnim, { toValue: 1, useNativeDriver: true, bounciness: 14 }).start();
      }
    } else {
      // Mismatch — hide after 800ms
      haptics.error();
      play('wrong');
      shake();
      setTimeout(() => {
        const reverted = new Set(nextRevealed);
        reverted.delete(a);
        reverted.delete(b);
        setRevealed(reverted);
        setLocked(false);
      }, 800);
    }
  }, [locked, matched, revealed, pending, startTime, cards, popCard, shake, bestTime, userId, winAnim, play]);

  const reset = useCallback(() => {
    clearInterval(timerRef.current);
    setCards(makeCards());
    setRevealed(new Set());
    setMatched(new Set());
    setPending([]);
    setLocked(false);
    setMoves(0);
    setStartTime(null);
    setElapsed(0);
    setWon(false);
    winAnim.setValue(0);
  }, [winAnim]);

  const CARD_W = Math.floor((Dimensions.get('window').width - 64) / 4);
  const CARD_H = Math.round(CARD_W * 1.15);

  const s = styles(colors);

  return (
    <View style={s.card}>
      {/* Header */}
      <TouchableOpacity style={s.header} onPress={() => setCollapsed(v => !v)} activeOpacity={0.7}>
        <Text style={s.title}>🃏 Memory Match</Text>
        <View style={s.headerRight}>
          {bestTime && <Text style={s.bestBadge}>🏅 {fmtTime(bestTime)}</Text>}
          <TouchableOpacity onPress={() => setShowBoard(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.lbBtn}>🏆</Text>
          </TouchableOpacity>
          <Text style={s.chevron}>{collapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          {/* Stats bar */}
          <View style={s.statsRow}>
            <Text style={s.stat}>Moves: <Text style={s.statVal}>{moves}</Text></Text>
            <Text style={s.stat}>
              {won ? '✅ Done!' : startTime ? fmtTime(elapsed) : 'Tap to start'}
            </Text>
            <Text style={s.stat}>
              {matched.size / 2}/{EMOJIS.length} pairs
            </Text>
          </View>

          {/* Grid */}
          <Animated.View style={[s.grid, { transform: [{ translateX: shakeAnim }] }]}>
            {cards.map((card) => {
              const isRevealed = revealed.has(card.id) || matched.has(card.id);
              const isMatched = matched.has(card.id);
              return (
                <Animated.View
                  key={card.id}
                  style={{ transform: [{ scale: scaleAnims[card.id] }] }}
                >
                  <TouchableOpacity
                    onPress={() => handlePress(card.id)}
                    activeOpacity={0.75}
                    disabled={isMatched || locked}
                    style={[
                      s.cardTile,
                      { width: CARD_W, height: CARD_H },
                      isMatched && s.cardMatched,
                      !isRevealed && s.cardBack,
                      isRevealed && !isMatched && s.cardFront,
                    ]}
                  >
                    <Text style={s.cardEmoji}>
                      {isRevealed ? card.emoji : '❓'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </Animated.View>

          {/* Win banner */}
          {won && (
            <Animated.View style={[s.winBanner, {
              transform: [{ scale: winAnim }],
              opacity: winAnim,
            }]}>
              <Text style={s.winText}>🎉 Cleared in {moves} moves!</Text>
              {bestTime === elapsed && <Text style={s.winSub}>New best time: {fmtTime(bestTime)}</Text>}
              <TouchableOpacity style={s.replayBtn} onPress={reset}>
                <Text style={s.replayText}>Play Again</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {!won && (
            <TouchableOpacity onPress={reset} style={s.resetBtn}>
              <Text style={s.resetText}>↺ Restart</Text>
            </TouchableOpacity>
          )}
        </>
      )}
      <GameLeaderboard game="memoryMatch" userId={userId} visible={showBoard} onClose={() => setShowBoard(false)} />
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1,
    borderColor: colors.border, padding: 14, marginBottom: 14, overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bestBadge: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.semibold },
  chevron: { fontSize: 13, color: colors.textDim },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  stat: { fontSize: typography.xs, color: colors.textDim },
  statVal: { color: colors.text, fontWeight: weight.semibold },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
  cardTile: {
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
  },
  cardBack: { backgroundColor: colors.bgElevated, borderColor: colors.border },
  cardFront: { backgroundColor: colors.accent + '18', borderColor: colors.accent + '60' },
  cardMatched: { backgroundColor: colors.success + '15', borderColor: colors.success + '50' },
  cardEmoji: { fontSize: 22 },

  winBanner: {
    marginTop: 12, backgroundColor: colors.accent + '18', borderRadius: 12,
    borderWidth: 1, borderColor: colors.accent + '40', padding: 14, alignItems: 'center',
  },
  winText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent, marginBottom: 2 },
  winSub: { fontSize: typography.xs, color: colors.textDim, marginBottom: 10 },
  replayBtn: {
    backgroundColor: colors.accent, borderRadius: 10,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  replayText: { fontSize: typography.xs, color: colors.bg, fontWeight: weight.bold },

  resetBtn: { marginTop: 10, alignSelf: 'center' },
  resetText: { fontSize: typography.xs, color: colors.textDim },
  lbBtn: { fontSize: 16 },
});
