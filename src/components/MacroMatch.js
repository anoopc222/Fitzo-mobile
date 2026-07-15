import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import GameLeaderboard, { upsertGameScore, recordGameHistory } from './GameLeaderboard';
import { recordGamePlay } from './GameStreak';
import { haptics } from '../lib/haptics';

const MACRO_DATA = [
  { name: 'Chicken breast', emoji: '🍗', protein: 31, carbs: 0, fat: 3.6, cal: 165 },
  { name: 'Salmon', emoji: '🐟', protein: 20, carbs: 0, fat: 13, cal: 208 },
  { name: 'Eggs', emoji: '🥚', protein: 13, carbs: 1, fat: 11, cal: 155 },
  { name: 'Greek yogurt', emoji: '🥛', protein: 10, carbs: 4, fat: 0.4, cal: 59 },
  { name: 'Almonds', emoji: '🥜', protein: 21, carbs: 22, fat: 50, cal: 579 },
  { name: 'Avocado', emoji: '🥑', protein: 2, carbs: 9, fat: 15, cal: 160 },
  { name: 'Oats', emoji: '🌾', protein: 13, carbs: 66, fat: 7, cal: 389 },
  { name: 'Broccoli', emoji: '🥦', protein: 3, carbs: 7, fat: 0.4, cal: 34 },
  { name: 'Peanut butter', emoji: '🥜', protein: 25, carbs: 20, fat: 50, cal: 588 },
  { name: 'Lentils', emoji: '🫘', protein: 9, carbs: 20, fat: 0.4, cal: 116 },
  { name: 'Tofu', emoji: '🍱', protein: 8, carbs: 2, fat: 5, cal: 76 },
  { name: 'Cheddar cheese', emoji: '🧀', protein: 25, carbs: 1, fat: 33, cal: 402 },
];

const QUESTION_TYPES = [
  { key: 'protein', label: 'most protein', unit: 'g protein', compare: (a, b) => b.protein - a.protein },
  { key: 'fat', label: 'most fat', unit: 'g fat', compare: (a, b) => b.fat - a.fat },
  { key: 'carbs', label: 'most carbs', unit: 'g carbs', compare: (a, b) => b.carbs - a.carbs },
  { key: 'cal', label: 'most calories', unit: 'kcal', compare: (a, b) => b.cal - a.cal },
  { key: 'protein', label: 'least protein', unit: 'g protein', compare: (a, b) => a.protein - b.protein },
  { key: 'fat', label: 'least fat', unit: 'g fat', compare: (a, b) => a.fat - b.fat },
];

const TOTAL_ROUNDS = 5;
const BEST_KEY = (userId) => `fitzo:macroMatch:${userId}:best`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRound() {
  const foods = shuffle(MACRO_DATA).slice(0, 4);
  const qType = QUESTION_TYPES[Math.floor(Math.random() * QUESTION_TYPES.length)];
  const sorted = [...foods].sort(qType.compare);
  const correctFood = sorted[0];
  return { foods, qType, correctFood };
}

export default function MacroMatch({ userId }) {
  const { colors } = useTheme();
  const s = styles(colors);

  const [round, setRound] = useState(1);
  const [totalScore, setTotalScore] = useState(0);
  const [best, setBest] = useState(0);
  const [gameData, setGameData] = useState(() => buildRound());
  const [selected, setSelected] = useState(null); // name of tapped food
  const [feedback, setFeedback] = useState(null); // 'correct' | 'wrong'
  const [gameOver, setGameOver] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showBoard, setShowBoard] = useState(false);

  const roundStartRef = useRef(Date.now());

  useEffect(() => {
    AsyncStorage.getItem(BEST_KEY(userId)).then(v => v && setBest(Number(v)));
  }, [userId]);

  useEffect(() => {
    roundStartRef.current = Date.now();
  }, [round]);

  function handleTap(food) {
    if (feedback) return;
    const elapsed = (Date.now() - roundStartRef.current) / 1000;
    const isCorrect = food.name === gameData.correctFood.name;
    setSelected(food.name);
    setFeedback(isCorrect ? 'correct' : 'wrong');

    if (isCorrect) {
      haptics.success();
      const bonus = Math.max(0, Math.floor(100 - elapsed * 2));
      const pts = bonus;
      const newTotal = totalScore + pts;
      setTotalScore(newTotal);

      setTimeout(() => {
        if (round >= TOTAL_ROUNDS) {
          finishGame(newTotal);
        } else {
          setRound(r => r + 1);
          setGameData(buildRound());
          setSelected(null);
          setFeedback(null);
        }
      }, 1000);
    } else {
      haptics.error();
      setTimeout(() => {
        if (round >= TOTAL_ROUNDS) {
          finishGame(totalScore);
        } else {
          setRound(r => r + 1);
          setGameData(buildRound());
          setSelected(null);
          setFeedback(null);
        }
      }, 1000);
    }
  }

  async function finishGame(finalScore) {
    setGameOver(true);
    recordGameHistory(userId, 'macroMatch', finalScore);
    recordGamePlay(userId);
    if (finalScore > best) {
      setBest(finalScore);
      await AsyncStorage.setItem(BEST_KEY(userId), String(finalScore));
      upsertGameScore(userId, 'macroMatch', finalScore);
    }
  }

  function restart() {
    setRound(1);
    setTotalScore(0);
    setGameData(buildRound());
    setSelected(null);
    setFeedback(null);
    setGameOver(false);
    roundStartRef.current = Date.now();
  }

  const { foods, qType, correctFood } = gameData;

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.header} onPress={() => setCollapsed(v => !v)} activeOpacity={0.7}>
        <Text style={s.title}>🥗 Macro Match</Text>
        <View style={s.headerRight}>
          {best > 0 && <Text style={s.bestText}>Best: {best}</Text>}
          <Text style={s.roundText}>Round {round}/{TOTAL_ROUNDS}</Text>
          <TouchableOpacity onPress={() => setShowBoard(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16 }}>🏆</Text>
          </TouchableOpacity>
          <Text style={s.chevron}>{collapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        gameOver ? (
          <View style={s.overBox}>
            <Text style={s.overEmoji}>{totalScore >= 400 ? '🏆' : totalScore >= 250 ? '🎉' : '😅'}</Text>
            <Text style={s.overTitle}>Score: {totalScore} pts</Text>
            <Text style={s.overSub}>Best: {best} pts</Text>
            <TouchableOpacity style={s.restartBtn} onPress={restart}>
              <Text style={s.restartText}>↺ Play Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={s.questionBox}>
              <Text style={s.questionText}>
                Which has the <Text style={{ color: colors.accent, fontWeight: weight.bold }}>{qType.label}</Text> per 100g?
              </Text>
              <Text style={s.scoreText}>+{totalScore} pts</Text>
            </View>

            <View style={s.foodGrid}>
              {foods.map(food => {
                let btnStyle = s.foodBtn;
                if (feedback && food.name === correctFood.name) btnStyle = [s.foodBtn, s.foodBtnCorrect];
                else if (feedback && food.name === selected) btnStyle = [s.foodBtn, s.foodBtnWrong];

                return (
                  <TouchableOpacity
                    key={food.name}
                    style={btnStyle}
                    onPress={() => handleTap(food)}
                    disabled={!!feedback}
                    activeOpacity={0.75}
                  >
                    <Text style={s.foodEmoji}>{food.emoji}</Text>
                    <Text style={s.foodName}>{food.name}</Text>
                    {feedback && food.name === correctFood.name && (
                      <Text style={s.macroHint}>{food[qType.key]} {qType.unit}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )
      )}

      <GameLeaderboard game="macroMatch" userId={userId} visible={showBoard} onClose={() => setShowBoard(false)} />
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bestText: { fontSize: 10, color: colors.textDim },
  roundText: { fontSize: 10, color: colors.textDim },
  chevron: { fontSize: 13, color: colors.textDim },

  questionBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, marginBottom: 12 },
  questionText: { flex: 1, fontSize: typography.sm, color: colors.text, lineHeight: 20 },
  scoreText: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.bold, marginLeft: 8 },

  foodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  foodBtn: {
    width: '47%', alignItems: 'center', borderRadius: 12, padding: 14,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  foodBtnCorrect: { backgroundColor: colors.success + '20', borderColor: colors.success },
  foodBtnWrong: { backgroundColor: colors.danger + '18', borderColor: colors.danger },
  foodEmoji: { fontSize: 28, marginBottom: 6 },
  foodName: { fontSize: 11, color: colors.text, fontWeight: weight.semibold, textAlign: 'center' },
  macroHint: { fontSize: 10, color: colors.accent, fontWeight: weight.bold, marginTop: 4 },

  overBox: { alignItems: 'center', paddingVertical: 10, gap: 6 },
  overEmoji: { fontSize: 36 },
  overTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  overSub: { fontSize: 11, color: colors.textDim },
  restartBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 8, marginTop: 4 },
  restartText: { fontSize: typography.xs, color: colors.bg, fontWeight: weight.bold },
});
