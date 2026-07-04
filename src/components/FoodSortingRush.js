import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import GameLeaderboard, { upsertGameScore, recordGameHistory } from './GameLeaderboard';

const FOODS = [
  { name: 'Chicken Breast', macro: 'protein', emoji: '🍗' },
  { name: 'White Rice', macro: 'carbs', emoji: '🍚' },
  { name: 'Avocado', macro: 'fat', emoji: '🥑' },
  { name: 'Egg', macro: 'protein', emoji: '🥚' },
  { name: 'Bread', macro: 'carbs', emoji: '🍞' },
  { name: 'Olive Oil', macro: 'fat', emoji: '🫒' },
  { name: 'Tuna', macro: 'protein', emoji: '🐟' },
  { name: 'Banana', macro: 'carbs', emoji: '🍌' },
  { name: 'Almonds', macro: 'fat', emoji: '🌰' },
  { name: 'Greek Yogurt', macro: 'protein', emoji: '🥛' },
  { name: 'Oats', macro: 'carbs', emoji: '🌾' },
  { name: 'Cheese', macro: 'fat', emoji: '🧀' },
  { name: 'Salmon', macro: 'protein', emoji: '🐠' },
  { name: 'Sweet Potato', macro: 'carbs', emoji: '🍠' },
  { name: 'Butter', macro: 'fat', emoji: '🧈' },
  { name: 'Lentils', macro: 'protein', emoji: '🫘' },
  { name: 'Pasta', macro: 'carbs', emoji: '🍝' },
  { name: 'Peanut Butter', macro: 'fat', emoji: '🥜' },
  { name: 'Turkey', macro: 'protein', emoji: '🦃' },
  { name: 'Corn', macro: 'carbs', emoji: '🌽' },
];

const BUCKETS = [
  { key: 'protein', label: 'Protein', color: '#a855f7', emoji: '💪' },
  { key: 'carbs', label: 'Carbs', color: '#f59e0b', emoji: '⚡' },
  { key: 'fat', label: 'Fat', color: '#22c55e', emoji: '🫀' },
];

const BASE_TIME = 5000;
const MIN_TIME = 1500;
const BEST_KEY = (uid) => `fitzo:foodSortingRush:${uid}:best`;

export default function FoodSortingRush({ userId }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState('idle'); // idle | playing | over
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [foodIdx, setFoodIdx] = useState(0);
  const [queue, setQueue] = useState([]);
  const [timeLeft, setTimeLeft] = useState(BASE_TIME);
  const [feedback, setFeedback] = useState(null); // 'correct' | 'wrong'
  const [best, setBest] = useState(0);
  const [lbVisible, setLbVisible] = useState(false);
  const timerRef = useRef(null);
  const scoreRef = useRef(0);
  const s = styles(colors);

  useEffect(() => {
    if (userId) AsyncStorage.getItem(BEST_KEY(userId)).then(v => { if (v) setBest(Number(v)); });
  }, [userId]);

  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

  const startGame = () => {
    const q = shuffle(FOODS);
    setQueue(q);
    setFoodIdx(0);
    scoreRef.current = 0;
    setScore(0);
    setLives(3);
    setPhase('playing');
    setFeedback(null);
  };

  const currentFood = phase === 'playing' ? queue[foodIdx] : null;

  const getTimeLimit = useCallback((sc) => {
    return Math.max(MIN_TIME, BASE_TIME - sc * 80);
  }, []);

  useEffect(() => {
    if (phase !== 'playing' || !currentFood) return;
    const limit = getTimeLimit(scoreRef.current);
    setTimeLeft(limit);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 100) {
          clearInterval(timerRef.current);
          handleWrong();
          return 0;
        }
        return prev - 100;
      });
    }, 100);
    return () => clearInterval(timerRef.current);
  }, [foodIdx, phase]);

  const handleWrong = () => {
    clearInterval(timerRef.current);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setFeedback('wrong');
    setLives(prev => {
      const next = prev - 1;
      if (next <= 0) {
        setTimeout(() => endGame(), 600);
      } else {
        setTimeout(() => nextFood(), 600);
      }
      return next;
    });
  };

  const handleTap = (bucketKey) => {
    if (phase !== 'playing' || feedback) return;
    clearInterval(timerRef.current);
    if (bucketKey === currentFood.macro) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFeedback('correct');
      scoreRef.current += 1;
      setScore(scoreRef.current);
      setTimeout(() => nextFood(), 400);
    } else {
      handleWrong();
    }
  };

  const nextFood = () => {
    setFeedback(null);
    setFoodIdx(prev => {
      const next = prev + 1;
      if (next >= queue.length) {
        endGame();
        return prev;
      }
      return next;
    });
  };

  const endGame = async () => {
    setPhase('over');
    const finalScore = scoreRef.current;
    if (userId) {
      if (finalScore > best) {
        setBest(finalScore);
        await AsyncStorage.setItem(BEST_KEY(userId), String(finalScore));
      }
      await upsertGameScore(userId, 'foodSortingRush', finalScore);
      await recordGameHistory(userId, 'foodSortingRush', finalScore);
    }
  };

  const timerPercent = currentFood ? timeLeft / getTimeLimit(scoreRef.current) : 1;

  if (phase === 'idle') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🍽️</Text>
      <Text style={s.title}>Food Sorting Rush</Text>
      <Text style={s.sub}>Sort foods into Protein / Carbs / Fat{'\n'}before the timer runs out!</Text>
      {best > 0 && <Text style={s.bestText}>🏆 Best: {best} correct</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Ionicons name="play" size={16} color="#000" />
        <Text style={s.startBtnText}>START GAME</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="foodSortingRush" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  if (phase === 'over') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🏁</Text>
      <Text style={s.title}>Game Over!</Text>
      <Text style={s.scoreDisplay}>{score}</Text>
      <Text style={s.scoreSub}>foods sorted correctly</Text>
      {score >= best && score > 0 && <Text style={s.newBest}>🎉 New Best!</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Text style={s.startBtnText}>PLAY AGAIN</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="foodSortingRush" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  return (
    <View style={s.game}>
      {/* HUD */}
      <View style={s.hud}>
        <Text style={s.hudScore}>⚡ {score}</Text>
        <Text style={s.hudLives}>{'❤️'.repeat(lives)}{'🖤'.repeat(3 - lives)}</Text>
      </View>

      {/* Timer bar */}
      <View style={s.timerBg}>
        <View style={[s.timerFill, {
          width: `${timerPercent * 100}%`,
          backgroundColor: timerPercent > 0.5 ? colors.accent : timerPercent > 0.25 ? '#f59e0b' : '#ef4444',
        }]} />
      </View>

      {/* Food card */}
      <View style={[s.foodCard, feedback === 'correct' && s.cardCorrect, feedback === 'wrong' && s.cardWrong]}>
        <Text style={s.foodEmoji}>{currentFood?.emoji}</Text>
        <Text style={s.foodName}>{currentFood?.name}</Text>
        {feedback === 'correct' && <Text style={s.feedbackLabel}>✓ Correct!</Text>}
        {feedback === 'wrong' && <Text style={[s.feedbackLabel, { color: '#ef4444' }]}>✗ Wrong!</Text>}
      </View>

      {/* Buckets */}
      <View style={s.buckets}>
        {BUCKETS.map(b => (
          <TouchableOpacity
            key={b.key}
            style={[s.bucket, { borderColor: b.color + '60', backgroundColor: b.color + '15' }]}
            onPress={() => handleTap(b.key)}
            activeOpacity={0.75}
          >
            <Text style={s.bucketEmoji}>{b.emoji}</Text>
            <Text style={[s.bucketLabel, { color: b.color }]}>{b.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  game: { paddingVertical: 8 },
  bigEmoji: { fontSize: 52 },
  title: { fontSize: 22, fontWeight: '900', color: colors.text, letterSpacing: 0.3 },
  sub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  bestText: { fontSize: 13, color: colors.accent, fontWeight: '700' },
  scoreDisplay: { fontSize: 64, fontWeight: '900', color: colors.accent },
  scoreSub: { fontSize: 14, color: colors.textMuted },
  newBest: { fontSize: 15, color: '#f59e0b', fontWeight: '800' },
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 40 },
  startBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
  lbBtn: { paddingVertical: 8 },
  lbBtnText: { fontSize: 13, color: colors.textMuted },
  hud: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  hudScore: { fontSize: 18, fontWeight: '900', color: colors.text },
  hudLives: { fontSize: 16 },
  timerBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginBottom: 20, overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: 3 },
  foodCard: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderRadius: 20, borderWidth: 1.5,
    borderColor: colors.border, paddingVertical: 32, marginBottom: 24, gap: 8,
  },
  cardCorrect: { borderColor: '#22c55e', backgroundColor: '#22c55e15' },
  cardWrong: { borderColor: '#ef4444', backgroundColor: '#ef444415' },
  foodEmoji: { fontSize: 56 },
  foodName: { fontSize: 20, fontWeight: '800', color: colors.text },
  feedbackLabel: { fontSize: 14, fontWeight: '700', color: '#22c55e' },
  buckets: { flexDirection: 'row', gap: 10 },
  bucket: { flex: 1, alignItems: 'center', borderRadius: 16, borderWidth: 1.5, paddingVertical: 20, gap: 6 },
  bucketEmoji: { fontSize: 28 },
  bucketLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
});
