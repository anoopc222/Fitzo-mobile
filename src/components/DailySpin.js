import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import { haptics } from '../lib/haptics';
import GameLeaderboard, { upsertGameScore } from './GameLeaderboard';

const DARES = [
  { emoji: '💪', text: 'Do 10 squats right now' },
  { emoji: '💧', text: 'Drink a full glass of water' },
  { emoji: '🚶', text: 'Take a 5-minute walk outside' },
  { emoji: '⚡', text: 'Do 15 jumping jacks' },
  { emoji: '📝', text: 'Log your next meal before eating it' },
  { emoji: '🧘', text: 'Hold a 30-second plank' },
  { emoji: '🤸', text: 'Stretch for 3 minutes' },
  { emoji: '🏃', text: 'Skip the elevator all day' },
  { emoji: '🦵', text: '20 calf raises at your desk' },
  { emoji: '😮‍💨', text: 'Take 5 deep breaths right now' },
  { emoji: '🥗', text: 'Swap one snack for a fruit today' },
  { emoji: '🛌', text: 'Set a sleep alarm for tonight' },
];

const CONFETTI_COLORS = ['#d4ff00', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7'];

function todayKey(userId) {
  const d = new Date();
  return `fitzo:dailySpin:${userId}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export default function DailySpin({ userId }) {
  const { colors } = useTheme();
  const s = styles(colors);

  const [dareIndex, setDareIndex] = useState(null);
  const [done, setDone] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [displayIdx, setDisplayIdx] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  const confetti = useRef(
    Array.from({ length: 6 }, () => ({
      scale: new Animated.Value(0),
      opacity: new Animated.Value(1),
      x: new Animated.Value(0),
      y: new Animated.Value(0),
    }))
  ).current;

  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(todayKey(userId)).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        setDareIndex(saved.dare);
        setDone(saved.done ?? false);
        setDisplayIdx(saved.dare);
      } catch {}
    });
  }, [userId]);

  function spin() {
    if (spinning || dareIndex !== null) return;
    haptics.medium();
    setSpinning(true);
    let count = 0;
    const total = 22;
    const interval = setInterval(() => {
      setDisplayIdx(i => (i + 1) % DARES.length);
      count++;
      if (count >= total) {
        clearInterval(interval);
        const final = Math.floor(Math.random() * DARES.length);
        setDisplayIdx(final);
        setDareIndex(final);
        setSpinning(false);
        AsyncStorage.setItem(todayKey(userId), JSON.stringify({ dare: final, done: false }));
      }
    }, 70);
  }

  function markDone() {
    if (done) return;
    haptics.success();
    setDone(true);
    AsyncStorage.setItem(todayKey(userId), JSON.stringify({ dare: dareIndex, done: true }));
    upsertGameScore(userId, 'dailySpin', 1);
    burst();
  }

  function burst() {
    setShowConfetti(true);
    confetti.forEach(c => {
      c.scale.setValue(0);
      c.opacity.setValue(1);
      c.x.setValue(0);
      c.y.setValue(0);
    });
    Animated.parallel(
      confetti.map((c, i) => {
        const angle = (i / confetti.length) * 2 * Math.PI;
        return Animated.parallel([
          Animated.spring(c.scale, { toValue: 1, useNativeDriver: true }),
          Animated.timing(c.x, { toValue: Math.cos(angle) * 55, duration: 550, useNativeDriver: true }),
          Animated.timing(c.y, { toValue: Math.sin(angle) * 55 - 10, duration: 550, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(380),
            Animated.timing(c.opacity, { toValue: 0, duration: 280, useNativeDriver: true }),
          ]),
        ]);
      })
    ).start(() => setShowConfetti(false));
  }

  const current = DARES[dareIndex ?? displayIdx];

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.title}>🎯 Daily Challenge</Text>
        {done && <Text style={s.doneLabel}>✅ Completed!</Text>}
      </View>

      {dareIndex === null ? (
        <TouchableOpacity style={[s.spinBtn, spinning && s.spinBtnActive]} onPress={spin} disabled={spinning} activeOpacity={0.8}>
          <Text style={s.spinEmoji}>{spinning ? current.emoji : '🎰'}</Text>
          <View style={s.spinTextCol}>
            <Text style={s.spinMain}>{spinning ? current.text : "Spin for today's dare"}</Text>
            {!spinning && <Text style={s.spinSub}>Tap to reveal your challenge</Text>}
          </View>
        </TouchableOpacity>
      ) : (
        <View style={[s.dareRow, done && s.dareRowDone]}>
          <Text style={s.dareEmoji}>{DARES[dareIndex].emoji}</Text>
          <Text style={s.dareText}>{DARES[dareIndex].text}</Text>
          {!done ? (
            <TouchableOpacity style={s.doneBtn} onPress={markDone} activeOpacity={0.8}>
              <Text style={s.doneBtnText}>Done!</Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.xpText}>+10 XP</Text>
          )}
        </View>
      )}

      {showConfetti && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={s.confettiOrigin}>
            {confetti.map((c, i) => (
              <Animated.View
                key={i}
                style={[
                  s.dot,
                  { backgroundColor: CONFETTI_COLORS[i] },
                  { transform: [{ scale: c.scale }, { translateX: c.x }, { translateY: c.y }], opacity: c.opacity },
                ]}
              />
            ))}
          </View>
        </View>
      )}
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
  doneLabel: { fontSize: typography.xs, color: colors.success, fontWeight: weight.bold },

  spinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.accent + '15', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: colors.accent + '40',
  },
  spinBtnActive: { backgroundColor: colors.accent + '25' },
  spinEmoji: { fontSize: 26 },
  spinTextCol: { flex: 1 },
  spinMain: { fontSize: typography.sm, color: colors.accent, fontWeight: weight.semibold },
  spinSub: { fontSize: typography.xs, color: colors.textDim, marginTop: 2 },

  dareRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12,
  },
  dareRowDone: { backgroundColor: colors.success + '12' },
  dareEmoji: { fontSize: 22 },
  dareText: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  doneBtn: {
    backgroundColor: colors.accent, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  doneBtnText: { fontSize: typography.xs, color: colors.bg, fontWeight: weight.bold },
  xpText: { fontSize: typography.xs, color: colors.success, fontWeight: weight.bold },

  confettiOrigin: { position: 'absolute', top: '50%', left: '50%', width: 0, height: 0 },
  dot: { position: 'absolute', width: 9, height: 9, borderRadius: 5 },
});
