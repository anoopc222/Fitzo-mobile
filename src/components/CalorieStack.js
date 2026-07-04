import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { upsertGameScore, recordGameHistory, GameLeaderboard } from './GameLeaderboard';

const FOODS = [
  { name: 'Apple', calories: 95, emoji: '🍎' },
  { name: 'Banana', calories: 105, emoji: '🍌' },
  { name: 'Pizza slice', calories: 285, emoji: '🍕' },
  { name: 'Burger', calories: 354, emoji: '🍔' },
  { name: 'Egg', calories: 78, emoji: '🥚' },
  { name: 'Avocado', calories: 234, emoji: '🥑' },
  { name: 'Donut', calories: 253, emoji: '🍩' },
  { name: 'Chicken breast', calories: 165, emoji: '🍗' },
  { name: 'Chocolate bar', calories: 235, emoji: '🍫' },
  { name: 'Greek yogurt', calories: 100, emoji: '🥛' },
  { name: 'French fries', calories: 365, emoji: '🍟' },
  { name: 'Salad', calories: 20, emoji: '🥗' },
  { name: 'Steak 100g', calories: 271, emoji: '🥩' },
  { name: 'Orange', calories: 62, emoji: '🍊' },
  { name: 'Ice cream', calories: 207, emoji: '🍦' },
  { name: 'Rice cup', calories: 206, emoji: '🍚' },
  { name: 'Milk 250ml', calories: 150, emoji: '🥛' },
  { name: 'Almonds 30g', calories: 173, emoji: '🌰' },
  { name: 'Bread slice', calories: 79, emoji: '🍞' },
  { name: 'Pasta bowl', calories: 220, emoji: '🍝' },
];

const TARGETS = [500, 600, 700, 800];
const BEST_KEY = (uid) => `fitzo:calorieStack:${uid}:best`;
const ROUNDS = 4;

export default function CalorieStack({ userId }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState('idle');
  const [round, setRound] = useState(0);
  const [target, setTarget] = useState(TARGETS[0]);
  const [pool, setPool] = useState([]);
  const [stack, setStack] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [roundResult, setRoundResult] = useState(null);
  const [best, setBest] = useState(0);
  const [lbVisible, setLbVisible] = useState(false);
  const s = styles(colors);

  useEffect(() => {
    if (userId) AsyncStorage.getItem(BEST_KEY(userId)).then(v => { if (v) setBest(Number(v)); });
  }, [userId]);

  const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

  const startGame = () => {
    setRound(0);
    setTotalScore(0);
    setPhase('playing');
    startRound(0, 0);
  };

  const startRound = (r, prevScore) => {
    const t = TARGETS[r];
    setTarget(t);
    setPool(shuffle(FOODS).slice(0, 8));
    setStack([]);
    setTotal(0);
    setRoundResult(null);
  };

  const addFood = (food) => {
    if (roundResult) return;
    const newTotal = total + food.calories;
    if (newTotal > target + 50) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const pts = 0;
      setRoundResult({ over: true, pts });
      finishRound(pts);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStack(prev => [...prev, food]);
    setTotal(newTotal);
    setPool(prev => prev.filter(f => f !== food));
  };

  const done = () => {
    if (roundResult) return;
    const diff = Math.abs(target - total);
    const pts = Math.max(0, 100 - diff);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRoundResult({ over: false, pts, diff });
    finishRound(pts);
  };

  const finishRound = (pts) => {
    const newTotal = totalScore + pts;
    setTotalScore(newTotal);
    if (round + 1 >= ROUNDS) {
      setTimeout(() => endGame(newTotal), 1200);
    } else {
      setTimeout(() => {
        setRound(r => r + 1);
        startRound(round + 1, newTotal);
      }, 1200);
    }
  };

  const endGame = async (finalScore) => {
    setPhase('over');
    if (userId) {
      if (finalScore > best) {
        setBest(finalScore);
        await AsyncStorage.setItem(BEST_KEY(userId), String(finalScore));
      }
      await upsertGameScore(userId, 'calorieStack', finalScore);
      await recordGameHistory(userId, 'calorieStack', finalScore);
    }
  };

  if (phase === 'idle') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🍔</Text>
      <Text style={s.title}>Calorie Stack</Text>
      <Text style={s.sub}>Add foods to hit the calorie target{'\n'}without going over!</Text>
      {best > 0 && <Text style={s.bestText}>🏆 Best: {best} pts</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Ionicons name="play" size={16} color="#000" />
        <Text style={s.startBtnText}>START GAME</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="calorieStack" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  if (phase === 'over') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🏁</Text>
      <Text style={s.title}>Game Over!</Text>
      <Text style={s.scoreDisplay}>{totalScore}</Text>
      <Text style={s.scoreSub}>total points across {ROUNDS} rounds</Text>
      {totalScore >= best && totalScore > 0 && <Text style={s.newBest}>🎉 New Best!</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Text style={s.startBtnText}>PLAY AGAIN</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="calorieStack" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  const pct = Math.min(1, total / target);

  return (
    <View style={s.game}>
      <View style={s.hud}>
        <Text style={s.hudRound}>Round {round + 1}/{ROUNDS}</Text>
        <Text style={s.hudScore}>{totalScore} pts</Text>
      </View>

      <View style={[s.targetCard, { borderColor: colors.accent + '60' }]}>
        <Text style={s.targetLabel}>Target</Text>
        <Text style={s.targetVal}>{target} kcal</Text>
        <View style={s.barBg}>
          <View style={[s.barFill, {
            width: `${pct * 100}%`,
            backgroundColor: pct > 0.95 ? '#ef4444' : pct > 0.8 ? '#f59e0b' : colors.accent,
          }]} />
        </View>
        <Text style={s.totalText}>{total} / {target} kcal</Text>
      </View>

      {roundResult && (
        <View style={[s.resultBanner, roundResult.over ? s.resultBad : s.resultGood]}>
          <Text style={s.resultText}>
            {roundResult.over ? '💥 Over limit! +0 pts' : `🎯 +${roundResult.pts} pts (off by ${roundResult.diff} kcal)`}
          </Text>
        </View>
      )}

      <View style={s.stackRow}>
        {stack.map((f, i) => (
          <View key={i} style={s.stackChip}>
            <Text style={s.chipEmoji}>{f.emoji}</Text>
            <Text style={s.chipCal}>{f.calories}</Text>
          </View>
        ))}
      </View>

      <View style={s.foodGrid}>
        {pool.map((f, i) => (
          <TouchableOpacity key={i} style={s.foodBtn} onPress={() => addFood(f)} activeOpacity={0.75}>
            <Text style={s.foodEmoji}>{f.emoji}</Text>
            <Text style={s.foodName}>{f.name}</Text>
            <Text style={s.foodCal}>{f.calories} kcal</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!roundResult && (
        <TouchableOpacity style={s.doneBtn} onPress={done}>
          <Ionicons name="checkmark-circle" size={18} color="#000" />
          <Text style={s.doneBtnText}>DONE</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  game: { paddingVertical: 8 },
  bigEmoji: { fontSize: 52 },
  title: { fontSize: 22, fontWeight: '900', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  bestText: { fontSize: 13, color: colors.accent, fontWeight: '700' },
  scoreDisplay: { fontSize: 64, fontWeight: '900', color: colors.accent },
  scoreSub: { fontSize: 14, color: colors.textMuted },
  newBest: { fontSize: 15, color: '#f59e0b', fontWeight: '800' },
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 40 },
  startBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
  lbBtn: { paddingVertical: 8 },
  lbBtnText: { fontSize: 13, color: colors.textMuted },
  hud: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  hudRound: { fontSize: 14, color: colors.textMuted, fontWeight: '700' },
  hudScore: { fontSize: 14, fontWeight: '900', color: colors.accent },
  targetCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 12, alignItems: 'center', gap: 6 },
  targetLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '700', letterSpacing: 1 },
  targetVal: { fontSize: 26, fontWeight: '900', color: colors.text },
  barBg: { width: '100%', height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  totalText: { fontSize: 13, color: colors.textMuted },
  resultBanner: { borderRadius: 12, padding: 12, marginBottom: 10, alignItems: 'center', borderWidth: 1 },
  resultGood: { backgroundColor: '#22c55e15', borderColor: '#22c55e40' },
  resultBad: { backgroundColor: '#ef444415', borderColor: '#ef444440' },
  resultText: { fontSize: 14, fontWeight: '700', color: colors.text },
  stackRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  stackChip: { backgroundColor: colors.card, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center' },
  chipEmoji: { fontSize: 16 },
  chipCal: { fontSize: 10, color: colors.textMuted, fontWeight: '700' },
  foodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  foodBtn: { width: '47%', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center', gap: 4 },
  foodEmoji: { fontSize: 28 },
  foodName: { fontSize: 11, color: colors.text, fontWeight: '600', textAlign: 'center' },
  foodCal: { fontSize: 12, color: colors.accent, fontWeight: '800' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 14, alignSelf: 'center', paddingHorizontal: 48 },
  doneBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
});
