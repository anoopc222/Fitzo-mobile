import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GameLeaderboard, { upsertGameScore, recordGameHistory } from './GameLeaderboard';
import { recordGamePlay } from './GameStreak';
import { useSound } from '../lib/useSound';
import { haptics } from '../lib/haptics';

// [name, calories per 100g, emoji]
const FOODS = [
  ['Almonds', 579, '🥜'], ['Avocado', 160, '🥑'], ['Banana', 89, '🍌'],
  ['White rice (cooked)', 130, '🍚'], ['Chicken breast', 165, '🍗'], ['Egg', 155, '🥚'],
  ['Salmon', 208, '🐟'], ['Broccoli', 34, '🥦'], ['Cheddar cheese', 402, '🧀'],
  ['Greek yogurt', 59, '🥛'], ['Oats', 389, '🌾'], ['Peanut butter', 588, '🥜'],
  ['Sweet potato', 86, '🍠'], ['Lentils (cooked)', 116, '🫘'], ['Dark chocolate', 598, '🍫'],
  ['Blueberries', 57, '🫐'], ['Whole milk', 61, '🥛'], ['Butter', 717, '🧈'],
  ['White bread', 265, '🍞'], ['Pasta (cooked)', 131, '🍝'], ['Apple', 52, '🍎'],
  ['Orange', 47, '🍊'], ['Tofu', 76, '🍱'], ['Beef mince (lean)', 215, '🥩'],
  ['Cashews', 553, '🥜'], ['Hummus', 166, '🫙'], ['Spinach', 23, '🥬'],
  ['Olive oil', 884, '🫒'], ['Corn', 86, '🌽'], ['Mango', 60, '🥭'],
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickPair(used) {
  const pool = FOODS.filter((_, i) => !used.has(i));
  if (pool.length < 2) return null;
  const s = shuffle(pool);
  return [s[0], s[1]];
}

const BEST_KEY = (userId) => `fitzo:higherLower:${userId}:best`;

export default function HigherOrLower({ userId }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const { play } = useSound();

  const [pair, setPair] = useState(() => {
    const s2 = shuffle(FOODS);
    return [s2[0], s2[1]];
  });
  const [used] = useState(new Set());
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [result, setResult] = useState(null); // 'correct'|'wrong'
  const [collapsed, setCollapsed] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const resultAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY(userId)).then(v => v && setBest(Number(v)));
  }, [userId]);

  function guess(higherIdx) {
    if (result) return;
    const [a, b] = pair;
    const actualHigherIdx = a[1] >= b[1] ? 0 : 1;
    const correct = higherIdx === actualHigherIdx;

    setResult(correct ? 'correct' : 'wrong');
    if (correct) haptics.success(); else haptics.error();
    play(correct ? 'correct' : 'wrong');
    Animated.timing(resultAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();

    if (correct) {
      const newStreak = streak + 1;
      setStreak(newStreak);
      if (newStreak > best) {
        setBest(newStreak);
        AsyncStorage.setItem(BEST_KEY(userId), String(newStreak));
        upsertGameScore(userId, 'higherOrLower', newStreak);
        recordGameHistory(userId, 'higherOrLower', newStreak);
        recordGamePlay(userId);
        if (newStreak >= 5) play('win');
      }
      setTimeout(() => {
        resultAnim.setValue(0);
        setResult(null);
        // Pick new pair avoiding recent
        used.add(FOODS.indexOf(pair[0]));
        used.add(FOODS.indexOf(pair[1]));
        if (used.size >= FOODS.length - 2) used.clear();
        const next = pickPair(used);
        if (next) setPair(next);
      }, 900);
    } else {
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
      setTimeout(() => {
        resultAnim.setValue(0);
        setResult(null);
        setStreak(0);
        setGameOver(true);
      }, 1200);
    }
  }

  function restart() {
    const s2 = shuffle(FOODS);
    setPair([s2[0], s2[1]]);
    used.clear();
    setStreak(0);
    setResult(null);
    setGameOver(false);
    resultAnim.setValue(0);
  }

  const [a, b] = pair;

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.header} onPress={() => setCollapsed(v => !v)} activeOpacity={0.7}>
        <Text style={s.title}>⬆️ Higher or Lower</Text>
        <View style={s.headerRight}>
          <Text style={s.streakText}>🔥 {streak}</Text>
          {best > 0 && <Text style={s.bestText}>Best: {best}</Text>}
          <TouchableOpacity onPress={() => setShowBoard(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16 }}>🏆</Text>
          </TouchableOpacity>
          <Text style={s.chevron}>{collapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        gameOver ? (
          <View style={s.overBox}>
            <Text style={s.overEmoji}>{streak >= 5 ? '🏆' : streak >= 3 ? '🎉' : '😅'}</Text>
            <Text style={s.overTitle}>Chain of {streak}</Text>
            <Text style={s.overSub}>Best: {best} | Tap to play again</Text>
            <TouchableOpacity style={s.restartBtn} onPress={restart}>
              <Text style={s.restartText}>↺ Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={s.sub}>Which has more calories per 100g?</Text>
            <Animated.View style={[s.pairRow, { transform: [{ translateX: shakeAnim }] }]}>
              {[a, b].map((food, idx) => {
                const higherIdx = a[1] >= b[1] ? 0 : 1;
                const isHigher = idx === higherIdx;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      s.foodBtn,
                      result === 'correct' && s.foodBtnCorrect,
                      result === 'wrong' && isHigher && s.foodBtnCorrect,
                      result === 'wrong' && !isHigher && s.foodBtnWrong,
                    ]}
                    onPress={() => guess(idx)}
                    activeOpacity={0.75}
                    disabled={!!result}
                  >
                    <Text style={s.foodEmoji}>{food[2]}</Text>
                    <Text style={s.foodName}>{food[0]}</Text>
                    {result && (
                      <Animated.Text style={[s.revealCal, { opacity: resultAnim }]}>
                        {food[1]} kcal
                      </Animated.Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </Animated.View>
            <Text style={s.streakLine}>Current chain: <Text style={{ color: colors.accent, fontWeight: weight.bold }}>{streak}</Text></Text>
          </>
        )
      )}
      <GameLeaderboard game="higherOrLower" userId={userId} visible={showBoard} onClose={() => setShowBoard(false)} />
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  streakText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent },
  bestText: { fontSize: 10, color: colors.textDim },
  chevron: { fontSize: 13, color: colors.textDim },

  sub: { fontSize: 11, color: colors.textDim, marginBottom: 10 },
  pairRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  foodBtn: {
    flex: 1, alignItems: 'center', borderRadius: 12, padding: 14,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  foodBtnCorrect: { backgroundColor: colors.success + '20', borderColor: colors.success },
  foodBtnWrong: { backgroundColor: colors.danger + '18', borderColor: colors.danger },
  foodEmoji: { fontSize: 28, marginBottom: 6 },
  foodName: { fontSize: 11, color: colors.text, fontWeight: weight.semibold, textAlign: 'center' },
  revealCal: { fontSize: 12, color: colors.accent, fontWeight: weight.bold, marginTop: 4 },
  streakLine: { fontSize: 11, color: colors.textDim, textAlign: 'center', marginTop: 4 },

  overBox: { alignItems: 'center', paddingVertical: 10 },
  overEmoji: { fontSize: 36, marginBottom: 6 },
  overTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  overSub: { fontSize: 11, color: colors.textDim, marginBottom: 10 },
  restartBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 8 },
  restartText: { fontSize: typography.xs, color: colors.bg, fontWeight: weight.bold },
});
