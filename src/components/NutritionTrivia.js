import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import GameLeaderboard, { upsertGameScore, recordGameHistory } from './GameLeaderboard';
import { recordGamePlay } from './GameStreak';
import { haptics } from '../lib/haptics';

const QUESTIONS = [
  { q: 'Which has more protein per 100g?', a: 'Chicken breast', b: 'Greek yogurt', correct: 'a', fact: 'Chicken breast has ~31g vs Greek yogurt ~10g protein.' },
  { q: 'How many calories in 1 tablespoon of olive oil?', a: '60 kcal', b: '120 kcal', correct: 'b', fact: 'Olive oil is pure fat — 120 kcal per tbsp.' },
  { q: 'Which fruit has the least sugar?', a: 'Avocado', b: 'Banana', correct: 'a', fact: 'Avocado has only ~0.7g sugar. Banana has ~12g.' },
  { q: 'How much water should an adult drink daily?', a: '1–2 litres', b: '2–3 litres', correct: 'b', fact: 'Most guidelines suggest ~2–3L per day depending on activity.' },
  { q: 'Which is highest in fibre?', a: 'White bread', b: 'Lentils', correct: 'b', fact: 'Lentils have ~8g fibre per 100g vs white bread ~2g.' },
  { q: 'Which has more calories?', a: '100g almonds', b: '100g boiled rice', correct: 'a', fact: 'Almonds: ~579 kcal. Boiled rice: ~130 kcal.' },
  { q: 'What macronutrient builds and repairs muscle?', a: 'Carbohydrates', b: 'Protein', correct: 'b', fact: 'Protein provides amino acids essential for muscle repair.' },
  { q: 'Which oil is highest in omega-3?', a: 'Coconut oil', b: 'Flaxseed oil', correct: 'b', fact: 'Flaxseed oil is one of the richest plant sources of omega-3.' },
  { q: 'How many calories does 1g of fat contain?', a: '4 kcal', b: '9 kcal', correct: 'b', fact: 'Fat = 9 kcal/g. Protein and carbs = 4 kcal/g each.' },
  { q: 'Which vegetable is highest in iron?', a: 'Cucumber', b: 'Spinach', correct: 'b', fact: 'Spinach provides ~2.7mg iron per 100g.' },
  { q: 'Which food is a complete protein?', a: 'Brown rice', b: 'Eggs', correct: 'b', fact: 'Eggs contain all 9 essential amino acids.' },
  { q: 'Which has more calcium?', a: 'Milk', b: 'Orange juice', correct: 'a', fact: 'Milk has ~120mg calcium per 100ml vs ~11mg in OJ.' },
  { q: 'What is the primary fuel source during intense exercise?', a: 'Fat', b: 'Carbohydrates', correct: 'b', fact: 'High-intensity work uses glycogen (carbs) as the main fuel.' },
  { q: 'Which nut has the most calories per 100g?', a: 'Macadamia', b: 'Cashew', correct: 'a', fact: 'Macadamia nuts pack ~718 kcal per 100g!' },
  { q: 'How long does it take to digest a meal on average?', a: '2–3 hours', b: '4–6 hours', correct: 'b', fact: 'Full gastric emptying typically takes 4–6 hours.' },
  { q: 'Which food is highest in vitamin C?', a: 'Orange', b: 'Red bell pepper', correct: 'b', fact: 'Red bell peppers have ~190mg vitamin C vs orange ~53mg.' },
  { q: 'What percentage of the human body is water?', a: '45–55%', b: '55–65%', correct: 'b', fact: 'Adults are roughly 60% water by body weight.' },
  { q: 'Which has more potassium?', a: 'Banana', b: 'Potato', correct: 'b', fact: 'A medium potato has ~900mg potassium vs banana ~422mg.' },
  { q: 'How many steps per day is the common fitness goal?', a: '5,000', b: '10,000', correct: 'b', fact: '10,000 steps/day (~8km) is the widely recommended target.' },
  { q: 'Which has more sugar?', a: 'Apple', b: 'Strawberry (100g)', correct: 'a', fact: 'Apple has ~10g sugar per 100g vs strawberry ~5g.' },
];

function todayKey(userId) {
  const d = new Date();
  return `fitzo:trivia:${userId}:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function bestKey(userId) { return `fitzo:trivia:${userId}:allTimeBest`; }

function pickQuestions(seed) {
  // Deterministic daily pick of 3 using date as seed
  const idx = [];
  let s = seed;
  while (idx.length < 3) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const i = Math.abs(s) % QUESTIONS.length;
    if (!idx.includes(i)) idx.push(i);
  }
  return idx.map(i => QUESTIONS[i]);
}

export default function NutritionTrivia({ userId }) {
  const { colors } = useTheme();
  const s = styles(colors);

  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const questions = pickQuestions(seed);

  const [qIdx, setQIdx] = useState(0);
  const [answered, setAnswered] = useState([]); // array of 'correct'|'wrong'
  const [chosen, setChosen] = useState(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [bestScore, setBestScore] = useState(null);

  const feedbackAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!userId) return;
    // Load all-time best from its own key (survives day rollover)
    AsyncStorage.getItem(bestKey(userId)).then(v => v && setBestScore(Number(v)));
    // Load today's progress
    AsyncStorage.getItem(todayKey(userId)).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        setScore(saved.score);
        setAnswered(saved.answered);
        setQIdx(saved.answered.length < 3 ? saved.answered.length : 2);
        setDone(saved.done);
      } catch {}
    });
  }, [userId]);

  function pick(choice) {
    if (chosen) return;
    setChosen(choice);
    const q = questions[qIdx];
    const correct = choice === q.correct;
    if (correct) haptics.success(); else haptics.error();
    const newAnswered = [...answered, correct ? 'correct' : 'wrong'];
    const newScore = score + (correct ? 1 : 0);

    // Bounce animation
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 1.06, duration: 100, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, bounciness: 8 }),
    ]).start();

    // Fade in fact
    Animated.timing(feedbackAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    setTimeout(() => {
      feedbackAnim.setValue(0);
      setChosen(null);
      if (qIdx + 1 >= 3) {
        const newBest = bestScore === null || newScore > bestScore ? newScore : bestScore;
        setScore(newScore);
        setAnswered(newAnswered);
        setDone(true);
        AsyncStorage.setItem(todayKey(userId), JSON.stringify({ score: newScore, answered: newAnswered, done: true }));
        if (newBest !== bestScore) {
          setBestScore(newBest);
          AsyncStorage.setItem(bestKey(userId), String(newBest));
        }
        upsertGameScore(userId, 'nutritionTrivia', newScore);
        recordGameHistory(userId, 'nutritionTrivia', newScore);
        recordGamePlay(userId);
      } else {
        setScore(newScore);
        setAnswered(newAnswered);
        setQIdx(qIdx + 1);
        AsyncStorage.setItem(todayKey(userId), JSON.stringify({ score: newScore, answered: newAnswered, done: false }));
      }
    }, 1600);
  }

  const q = questions[Math.min(qIdx, 2)];

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.header} onPress={() => setCollapsed(v => !v)} activeOpacity={0.7}>
        <Text style={s.title}>🧠 Daily Trivia</Text>
        <View style={s.headerRight}>
          {bestScore !== null && <Text style={s.bestBadge}>🏅 Best: {bestScore}/3</Text>}
          <TouchableOpacity onPress={() => setShowBoard(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16 }}>🏆</Text>
          </TouchableOpacity>
          <View style={s.dotRow}>
            {[0,1,2].map(i => (
              <View key={i} style={[s.dot, answered[i] === 'correct' && s.dotCorrect, answered[i] === 'wrong' && s.dotWrong]} />
            ))}
          </View>
          <Text style={s.chevron}>{collapsed ? '▸' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {!collapsed && (
        done ? (
          <View style={s.doneBox}>
            <Text style={s.doneEmoji}>{score === 3 ? '🏆' : score >= 2 ? '🎉' : '📚'}</Text>
            <Text style={s.doneText}>
              {score === 3 ? 'Perfect score!' : score >= 2 ? 'Great job!' : 'Keep learning!'}
            </Text>
            <Text style={s.doneScore}>{score}/3 correct today</Text>
            <Text style={s.doneReturn}>Come back tomorrow for new questions</Text>
          </View>
        ) : (
          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Text style={s.progress}>Question {qIdx + 1} of 3</Text>
            <Text style={s.question}>{q.q}</Text>

            {(['a','b']).map(opt => {
              const label = q[opt];
              const isChosen = chosen === opt;
              const isCorrect = q.correct === opt;
              let bg = s.optBtn;
              if (isChosen && isCorrect) bg = s.optCorrect;
              else if (isChosen && !isCorrect) bg = s.optWrong;
              else if (chosen && isCorrect) bg = s.optCorrect;

              return (
                <TouchableOpacity key={opt} style={[s.optBtn, isChosen && isCorrect && s.optCorrect, isChosen && !isCorrect && s.optWrong, !isChosen && chosen && isCorrect && s.optCorrect]} onPress={() => pick(opt)} activeOpacity={0.75} disabled={!!chosen}>
                  <Text style={s.optLabel}>{opt.toUpperCase()}.</Text>
                  <Text style={s.optText}>{label}</Text>
                  {isChosen && <Text style={s.optIcon}>{isCorrect ? '✓' : '✗'}</Text>}
                  {!isChosen && chosen && isCorrect && <Text style={s.optIcon}>✓</Text>}
                </TouchableOpacity>
              );
            })}

            {chosen && (
              <Animated.View style={[s.factBox, { opacity: feedbackAnim }]}>
                <Text style={s.factText}>💡 {q.fact}</Text>
              </Animated.View>
            )}
          </Animated.View>
        )
      )}
      <GameLeaderboard game="nutritionTrivia" userId={userId} visible={showBoard} onClose={() => setShowBoard(false)} />
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: { backgroundColor: colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bestBadge: { fontSize: 10, color: colors.accent, fontWeight: weight.semibold },
  dotRow: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  dotCorrect: { backgroundColor: colors.success },
  dotWrong: { backgroundColor: colors.danger },
  chevron: { fontSize: 13, color: colors.textDim },

  progress: { fontSize: 10, color: colors.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 },
  question: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text, marginBottom: 12, lineHeight: 20 },

  optBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  optCorrect: { backgroundColor: colors.success + '20', borderColor: colors.success },
  optWrong: { backgroundColor: colors.danger + '18', borderColor: colors.danger },
  optLabel: { fontSize: 11, fontWeight: weight.bold, color: colors.textDim, width: 18 },
  optText: { flex: 1, fontSize: typography.sm, color: colors.text },
  optIcon: { fontSize: 14, fontWeight: weight.bold },

  factBox: { backgroundColor: colors.accent + '15', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.accent + '40', marginTop: 4 },
  factText: { fontSize: 11, color: colors.text, lineHeight: 16 },

  doneBox: { alignItems: 'center', paddingVertical: 12 },
  doneEmoji: { fontSize: 36, marginBottom: 6 },
  doneText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text, marginBottom: 2 },
  doneScore: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.semibold, marginBottom: 4 },
  doneReturn: { fontSize: 10, color: colors.textDim },
});
