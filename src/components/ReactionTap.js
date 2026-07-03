import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import GameLeaderboard, { upsertGameScore } from './GameLeaderboard';
import { useSound } from '../lib/useSound';
import { haptics } from '../lib/haptics';

const TARGETS = [
  { emoji: '💪', label: 'Tap the flex!' },
  { emoji: '🔥', label: 'Tap the fire!' },
  { emoji: '⚡', label: 'Tap the bolt!' },
  { emoji: '🏆', label: 'Tap the trophy!' },
  { emoji: '🎯', label: 'Tap the target!' },
];

const BEST_KEY = (userId) => `fitzo:reactionTap:${userId}:best`;

// States: idle → countdown → waiting → active → result
export default function ReactionTap({ userId }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const { play } = useSound();

  const [phase, setPhase] = useState('idle'); // idle | countdown | waiting | active | result | toosoon
  const [countdown, setCountdown] = useState(3);
  const [reactionMs, setReactionMs] = useState(null);
  const [best, setBest] = useState(null);
  const [round, setRound] = useState(0);
  const [history, setHistory] = useState([]); // last 5 times
  const [target, setTarget] = useState(TARGETS[0]);
  const [collapsed, setCollapsed] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  const startedAt = useRef(null);
  const waitTimer = useRef(null);
  const countdownTimer = useRef(null);

  const bgAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY(userId)).then(v => v && setBest(Number(v)));
    return () => {
      clearTimeout(waitTimer.current);
      clearInterval(countdownTimer.current);
      pulseLoop.current?.stop();
    };
  }, [userId]);

  const startCountdown = useCallback(() => {
    setPhase('countdown');
    setCountdown(3);
    let c = 3;
    countdownTimer.current = setInterval(() => {
      c--;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(countdownTimer.current);
        beginWait();
      } else {
        play('tick');
      }
    }, 800);
  }, [play]);

  function beginWait() {
    const t = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    setTarget(t);
    setPhase('waiting');
    bgAnim.setValue(0);
    scaleAnim.setValue(0);

    // Random delay 1.5–4s
    const delay = 1500 + Math.random() * 2500;
    waitTimer.current = setTimeout(() => {
      startedAt.current = Date.now();
      play('go');
      haptics.heavy();
      setPhase('active');

      // Animate target in
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, bounciness: 16 }).start();
      Animated.timing(bgAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();

      // Pulse loop — stored in ref so it can be stopped on unmount / tap
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    }, delay);
  }

  function handleTap() {
    if (phase === 'waiting') {
      // Too soon
      clearTimeout(waitTimer.current);
      haptics.error();
      setPhase('toosoon');
      return;
    }
    if (phase === 'active') {
      const ms = Date.now() - startedAt.current;
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);

      const newHistory = [...history, ms].slice(-5);
      setHistory(newHistory);
      setReactionMs(ms);
      if (ms < 300) haptics.success();
      play(ms < 300 ? 'correct' : 'reveal');
      setRound(r => r + 1);

      const newBest = best === null || ms < best ? ms : best;
      if (newBest !== best) {
        setBest(newBest);
        AsyncStorage.setItem(BEST_KEY(userId), String(newBest));
        upsertGameScore(userId, 'reactionTap', ms);
      }
      setPhase('result');
      return;
    }
    if (phase === 'idle' || phase === 'result' || phase === 'toosoon') {
      startCountdown();
    }
  }

  function ratingLabel(ms) {
    if (ms < 200) return { text: '⚡ Lightning!', color: '#d4ff00' };
    if (ms < 280) return { text: '🔥 Blazing!', color: '#4ecdc4' };
    if (ms < 360) return { text: '💪 Fast!', color: '#45b7d1' };
    if (ms < 500) return { text: '👍 Good', color: '#f59e0b' };
    return { text: '🐢 Keep practicing', color: colors.textDim };
  }

  const bgColor = bgAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.bgElevated, colors.accent + '25'],
  });

  const avg = history.length > 0 ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null;

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.header} onPress={() => setCollapsed(v => !v)} activeOpacity={0.7}>
        <Text style={s.title}>⚡ Reaction Tap</Text>
        <View style={s.headerRight}>
          {best && <Text style={s.bestBadge}>🏅 {best}ms</Text>}
          {avg && <Text style={s.avgBadge}>Avg: {avg}ms</Text>}
          <TouchableOpacity onPress={() => setShowBoard(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16 }}>🏆</Text>
          </TouchableOpacity>
          <Text style={s.chevron}>{collapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <TouchableOpacity onPress={handleTap} activeOpacity={0.85} style={{ borderRadius: 12, overflow: 'hidden' }}>
          <Animated.View style={[s.arena, { backgroundColor: bgColor }]}>
            {phase === 'idle' && (
              <View style={s.centerContent}>
                <Text style={s.arenaEmoji}>👆</Text>
                <Text style={s.arenaTitle}>Test Your Reflexes</Text>
                <Text style={s.arenaSub}>Tap to start</Text>
              </View>
            )}

            {phase === 'countdown' && (
              <View style={s.centerContent}>
                <Text style={[s.countdownNum, { color: colors.accent }]}>{countdown}</Text>
                <Text style={s.arenaSub}>Get ready…</Text>
              </View>
            )}

            {phase === 'waiting' && (
              <View style={s.centerContent}>
                <Text style={s.arenaEmoji}>👀</Text>
                <Text style={s.arenaTitle}>Wait for it…</Text>
                <Text style={s.arenaSub}>Don't tap yet!</Text>
              </View>
            )}

            {phase === 'active' && (
              <Animated.View style={[s.centerContent, { transform: [{ scale: Animated.multiply(scaleAnim, pulseAnim) }] }]}>
                <Text style={s.targetEmoji}>{target.emoji}</Text>
                <Text style={[s.arenaTitle, { color: colors.accent }]}>{target.label}</Text>
                <Text style={s.arenaSub}>TAP NOW!</Text>
              </Animated.View>
            )}

            {phase === 'toosoon' && (
              <View style={s.centerContent}>
                <Text style={s.arenaEmoji}>🚫</Text>
                <Text style={[s.arenaTitle, { color: colors.danger }]}>Too soon!</Text>
                <Text style={s.arenaSub}>Tap to try again</Text>
              </View>
            )}

            {phase === 'result' && reactionMs !== null && (
              <View style={s.centerContent}>
                <Text style={[s.resultMs, { color: ratingLabel(reactionMs).color }]}>{reactionMs}ms</Text>
                <Text style={[s.resultRating, { color: ratingLabel(reactionMs).color }]}>{ratingLabel(reactionMs).text}</Text>
                {best === reactionMs && round > 1 && <Text style={s.newBest}>🎉 New best!</Text>}
                <Text style={s.arenaSub}>Tap to go again</Text>

                {history.length > 1 && (
                  <View style={s.historyRow}>
                    {history.map((ms2, i) => (
                      <View key={i} style={[s.historyDot, { height: Math.min(28, ms2 / 20), backgroundColor: i === history.length - 1 ? colors.accent : colors.textDim + '80' }]} />
                    ))}
                  </View>
                )}
              </View>
            )}
          </Animated.View>
        </TouchableOpacity>
      )}
      <GameLeaderboard game="reactionTap" userId={userId} visible={showBoard} onClose={() => setShowBoard(false)} />
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bestBadge: { fontSize: 10, color: colors.accent, fontWeight: weight.semibold },
  avgBadge: { fontSize: 10, color: colors.textDim },
  chevron: { fontSize: 13, color: colors.textDim },

  arena: { borderRadius: 12, minHeight: 150, alignItems: 'center', justifyContent: 'center', padding: 20, borderWidth: 1, borderColor: colors.border },
  centerContent: { alignItems: 'center', gap: 6 },
  arenaEmoji: { fontSize: 36, marginBottom: 4 },
  targetEmoji: { fontSize: 52, marginBottom: 4 },
  arenaTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  arenaSub: { fontSize: 11, color: colors.textDim },
  countdownNum: { fontSize: 56, fontWeight: weight.black, lineHeight: 60 },

  resultMs: { fontSize: 44, fontWeight: weight.black, lineHeight: 50 },
  resultRating: { fontSize: typography.sm, fontWeight: weight.bold },
  newBest: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.bold },

  historyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: 8, height: 30 },
  historyDot: { width: 8, borderRadius: 2 },
});
