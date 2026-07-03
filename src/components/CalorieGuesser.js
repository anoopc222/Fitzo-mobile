import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  PanResponder, Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import GameLeaderboard, { upsertGameScore } from './GameLeaderboard';

// [name, emoji, calories per 100g, hint]
const FOODS = [
  ['Almonds', '🥜', 579, 'per 100g'],
  ['Avocado', '🥑', 160, 'per 100g'],
  ['Banana', '🍌', 89, 'per 100g'],
  ['Chicken breast', '🍗', 165, 'cooked, per 100g'],
  ['Cheddar cheese', '🧀', 402, 'per 100g'],
  ['Dark chocolate', '🍫', 598, 'per 100g'],
  ['Greek yogurt', '🥛', 59, 'per 100g'],
  ['Oats (dry)', '🌾', 389, 'per 100g'],
  ['Peanut butter', '🥜', 588, 'per 100g'],
  ['Salmon', '🐟', 208, 'per 100g'],
  ['White rice (cooked)', '🍚', 130, 'per 100g'],
  ['Eggs', '🥚', 155, 'per 100g'],
  ['Broccoli', '🥦', 34, 'per 100g'],
  ['Sweet potato', '🍠', 86, 'per 100g'],
  ['Butter', '🧈', 717, 'per 100g'],
  ['Lentils (cooked)', '🫘', 116, 'per 100g'],
  ['Olive oil', '🫒', 884, 'per 100g'],
  ['Blueberries', '🫐', 57, 'per 100g'],
  ['Beef mince (lean)', '🥩', 215, 'per 100g'],
  ['Tofu', '🍱', 76, 'per 100g'],
];

const SLIDER_MIN = 0;
const SLIDER_MAX = 900;
const BEST_KEY = (userId) => `fitzo:calorieGuesser:${userId}:best`;

function scoreLabel(diff) {
  if (diff <= 10) return { label: '🎯 Perfect!', color: '#d4ff00' };
  if (diff <= 30) return { label: '🔥 Excellent!', color: '#4ecdc4' };
  if (diff <= 60) return { label: '👍 Good!', color: '#45b7d1' };
  if (diff <= 120) return { label: '😅 Close-ish', color: '#f59e0b' };
  return { label: '📚 Keep learning', color: '#ff6b6b' };
}

function scorePoints(diff) {
  if (diff <= 10) return 100;
  if (diff <= 30) return 75;
  if (diff <= 60) return 50;
  if (diff <= 120) return 25;
  return 10;
}

export default function CalorieGuesser({ userId }) {
  const { colors } = useTheme();
  const s = styles(colors);
  const TRACK_W = Dimensions.get('window').width - 64;

  const [foodIdx, setFoodIdx] = useState(() => Math.floor(Math.random() * FOODS.length));
  const [guess, setGuess] = useState(SLIDER_MAX / 2);
  const [revealed, setRevealed] = useState(false);
  const [totalScore, setTotalScore] = useState(0);
  const [round, setRound] = useState(1);
  const [best, setBest] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [seen, setSeen] = useState(new Set());

  const sliderX = useRef(new Animated.Value((guess / SLIDER_MAX) * TRACK_W)).current;
  const revealAnim = useRef(new Animated.Value(0)).current;
  const needleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY(userId)).then(v => v && setBest(Number(v)));
  }, [userId]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gs) => {
        sliderX.stopAnimation();
      },
      onPanResponderMove: (_, gs) => {
        const raw = Math.max(0, Math.min(TRACK_W, gs.moveX - 32));
        sliderX.setValue(raw);
        const val = Math.round((raw / TRACK_W) * SLIDER_MAX);
        setGuess(val);
      },
    })
  ).current;

  function reveal() {
    if (revealed) return;
    const food = FOODS[foodIdx];
    const diff = Math.abs(guess - food[2]);
    const pts = scorePoints(diff);

    setRevealed(true);
    const newScore = totalScore + pts;
    setTotalScore(newScore);

    // Animate needle to correct position
    Animated.timing(needleAnim, {
      toValue: (food[2] / SLIDER_MAX) * TRACK_W,
      duration: 700,
      useNativeDriver: false,
    }).start();
    Animated.timing(revealAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }

  function nextRound() {
    if (round >= 5) {
      // Game over — save best
      if (totalScore > best) {
        setBest(totalScore);
        AsyncStorage.setItem(BEST_KEY(userId), String(totalScore));
        upsertGameScore(userId, 'calorieGuesser', totalScore);
      }
      // Reset
      setRound(1);
      setTotalScore(0);
      seen.clear();
    } else {
      setRound(r => r + 1);
    }

    // Pick new food
    const available = FOODS.map((_, i) => i).filter(i => !seen.has(i) && i !== foodIdx);
    const nextIdx = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : Math.floor(Math.random() * FOODS.length);
    seen.add(foodIdx);
    setSeen(new Set(seen));
    setFoodIdx(nextIdx);

    const mid = TRACK_W / 2;
    sliderX.setValue(mid);
    setGuess(Math.round(SLIDER_MAX / 2));
    setRevealed(false);
    revealAnim.setValue(0);
    needleAnim.setValue(mid);
  }

  const food = FOODS[foodIdx];
  const diff = Math.abs(guess - food[2]);
  const { label: scoreLabel2, color: scoreColor } = scoreLabel(diff);

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.header} onPress={() => setCollapsed(v => !v)} activeOpacity={0.7}>
        <Text style={s.title}>🍎 Calorie Guesser</Text>
        <View style={s.headerRight}>
          {best > 0 && <Text style={s.bestBadge}>🏅 Best: {best}</Text>}
          <Text style={s.roundBadge}>Round {round}/5</Text>
          <TouchableOpacity onPress={() => setShowBoard(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16 }}>🏆</Text>
          </TouchableOpacity>
          <Text style={s.chevron}>{collapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <>
          {/* Food card */}
          <View style={s.foodCard}>
            <Text style={s.foodEmoji}>{food[1]}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.foodName}>{food[0]}</Text>
              <Text style={s.foodHint}>{food[3]}</Text>
            </View>
            <Text style={s.scoreChip}>+{totalScore} pts</Text>
          </View>

          {/* Guess label */}
          <Text style={s.guessLabel}>Your guess: <Text style={{ color: colors.accent, fontWeight: weight.bold }}>{guess} kcal</Text></Text>

          {/* Custom slider track */}
          <View style={[s.trackWrap, { width: TRACK_W }]}>
            {/* Filled portion */}
            <Animated.View style={[s.trackFill, { width: sliderX }]} />

            {/* Correct answer needle (shown after reveal) */}
            {revealed && (
              <Animated.View style={[s.needle, { left: needleAnim }]} />
            )}

            {/* Thumb */}
            <Animated.View
              style={[s.thumb, { left: Animated.subtract(sliderX, 11) }]}
              {...(revealed ? {} : panResponder.panHandlers)}
            />

            {/* Scale labels */}
            <View style={s.scaleRow}>
              <Text style={s.scaleLabel}>0</Text>
              <Text style={s.scaleLabel}>450</Text>
              <Text style={s.scaleLabel}>900</Text>
            </View>
          </View>

          {!revealed ? (
            <TouchableOpacity style={s.submitBtn} onPress={reveal} activeOpacity={0.8}>
              <Text style={s.submitText}>Reveal Answer</Text>
            </TouchableOpacity>
          ) : (
            <Animated.View style={[s.resultBox, { opacity: revealAnim }]}>
              <Text style={[s.resultLabel, { color: scoreColor }]}>{scoreLabel2}</Text>
              <Text style={s.resultDetail}>
                Actual: <Text style={{ color: colors.accent, fontWeight: weight.bold }}>{food[2]} kcal</Text>
                {'  '}|{'  '}Off by: <Text style={{ fontWeight: weight.bold }}>{diff} kcal</Text>
                {'  '}|{'  '}<Text style={{ color: scoreColor }}>+{scorePoints(diff)} pts</Text>
              </Text>
              <TouchableOpacity style={s.nextBtn} onPress={nextRound}>
                <Text style={s.nextText}>{round >= 5 ? '🏆 Finish' : 'Next Food →'}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
        </>
      )}
      <GameLeaderboard game="calorieGuesser" userId={userId} visible={showBoard} onClose={() => setShowBoard(false)} />
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bestBadge: { fontSize: 10, color: colors.accent, fontWeight: weight.semibold },
  roundBadge: { fontSize: 10, color: colors.textDim },
  chevron: { fontSize: 13, color: colors.textDim },

  foodCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, marginBottom: 14 },
  foodEmoji: { fontSize: 30 },
  foodName: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  foodHint: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  scoreChip: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.bold },

  guessLabel: { fontSize: typography.xs, color: colors.textDim, marginBottom: 10 },

  trackWrap: { height: 36, justifyContent: 'center', marginBottom: 6, position: 'relative' },
  trackFill: { height: 6, backgroundColor: colors.accent, borderRadius: 3, position: 'absolute', top: 15 },
  needle: { position: 'absolute', top: 8, width: 3, height: 20, backgroundColor: colors.success, borderRadius: 2 },
  thumb: {
    position: 'absolute', top: 8, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.accent, borderWidth: 3, borderColor: colors.bg,
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 4,
  },
  scaleRow: { flexDirection: 'row', justifyContent: 'space-between', position: 'absolute', bottom: 0, left: 0, right: 0 },
  scaleLabel: { fontSize: 9, color: colors.textDim },

  submitBtn: { backgroundColor: colors.accent, borderRadius: 12, padding: 13, alignItems: 'center', marginTop: 4 },
  submitText: { fontSize: typography.sm, color: colors.bg, fontWeight: weight.bold },

  resultBox: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, alignItems: 'center', gap: 6 },
  resultLabel: { fontSize: typography.sm, fontWeight: weight.bold },
  resultDetail: { fontSize: 11, color: colors.textDim, textAlign: 'center' },
  nextBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 8, marginTop: 4 },
  nextText: { fontSize: typography.xs, color: colors.bg, fontWeight: weight.bold },
});
