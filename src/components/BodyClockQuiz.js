import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { upsertGameScore, recordGameHistory, GameLeaderboard } from './GameLeaderboard';

const QUESTIONS = [
  {
    q: 'When is the best time to eat your largest meal?',
    options: ['Breakfast', 'Lunch', 'Dinner', 'After midnight'],
    correct: 1,
    fact: 'Lunch aligns with peak insulin sensitivity mid-day.',
  },
  {
    q: 'How many hours before bed should you stop eating?',
    options: ['1 hour', '2–3 hours', '5 hours', 'No difference'],
    correct: 1,
    fact: 'Stopping 2–3 hours before sleep improves sleep quality and digestion.',
  },
  {
    q: 'When is cortisol naturally highest?',
    options: ['Late night', 'Morning (6–8am)', 'Afternoon', 'Just after lunch'],
    correct: 1,
    fact: 'The cortisol awakening response peaks 30–45 min after waking.',
  },
  {
    q: 'Best time to lift weights for strength gains?',
    options: ['Early morning (5am)', 'Late morning to afternoon', 'Just before bed', 'Noon exactly'],
    correct: 1,
    fact: 'Core body temperature and hormone levels peak in late morning to early afternoon.',
  },
  {
    q: 'How much protein should you eat post-workout?',
    options: ['5–10g', '20–40g', '60–80g', '100g+'],
    correct: 1,
    fact: '20–40g protein maximises muscle protein synthesis post-exercise.',
  },
  {
    q: 'What sleep duration is optimal for muscle recovery?',
    options: ['4–5 hours', '6 hours', '7–9 hours', '10+ hours'],
    correct: 2,
    fact: 'Most adults need 7–9 hours; growth hormone peaks during deep sleep.',
  },
  {
    q: 'When does the body primarily burn fat during sleep?',
    options: ['First 2 hours', 'In the morning after REM', 'All night equally', 'Only if you eat carbs'],
    correct: 1,
    fact: 'Fat oxidation increases in the second half of sleep, peaking near morning.',
  },
  {
    q: 'Intermittent fasting: what is the most studied window?',
    options: ['6:18', '16:8', '20:4', '12:12'],
    correct: 1,
    fact: 'The 16:8 window (16h fast, 8h eating) is the most researched IF protocol.',
  },
  {
    q: 'When is insulin sensitivity typically highest?',
    options: ['Night', 'Morning', 'Late afternoon', 'Midnight'],
    correct: 1,
    fact: 'Insulin sensitivity is highest in the morning and declines through the day.',
  },
  {
    q: 'Caffeine has a half-life of roughly:',
    options: ['1 hour', '3 hours', '5–6 hours', '12 hours'],
    correct: 2,
    fact: 'Caffeine\'s half-life is ~5–6 hours, so afternoon coffee disrupts sleep.',
  },
  {
    q: 'Protein synthesis rates are highest at what time?',
    options: ['Fasted morning', 'After resistance training', 'During sleep', 'Before bed only'],
    correct: 1,
    fact: 'Resistance training acutely raises muscle protein synthesis for 24–48h.',
  },
  {
    q: 'How soon after waking should you eat to stabilise blood sugar?',
    options: ['Immediately', 'Within 1–2 hours', 'After 4 hours', 'Blood sugar self-regulates'],
    correct: 1,
    fact: 'Eating within 1–2 hours helps stabilise cortisol and blood glucose.',
  },
];

const QUESTION_TIME = 12000;
const QUESTIONS_PER_GAME = 8;
const BEST_KEY = (uid) => `fitzo:bodyClockQuiz:${uid}:best`;

export default function BodyClockQuiz({ userId }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState('idle');
  const [qList, setQList] = useState([]);
  const [qIdx, setQIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
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
    const q = shuffle(QUESTIONS).slice(0, QUESTIONS_PER_GAME);
    setQList(q);
    setQIdx(0);
    scoreRef.current = 0;
    setScore(0);
    setSelected(null);
    setPhase('playing');
    startTimer();
  };

  const startTimer = () => {
    clearInterval(timerRef.current);
    setTimeLeft(QUESTION_TIME);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 100) {
          clearInterval(timerRef.current);
          handleAnswer(-1);
          return 0;
        }
        return prev - 100;
      });
    }, 100);
  };

  const handleAnswer = (idx) => {
    clearInterval(timerRef.current);
    if (selected !== null) return;
    setSelected(idx);
    const q = qList[qIdx];
    if (idx === q.correct) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      scoreRef.current += 1;
      setScore(scoreRef.current);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
    setTimeout(() => {
      const next = qIdx + 1;
      if (next >= qList.length) {
        endGame(scoreRef.current);
      } else {
        setQIdx(next);
        setSelected(null);
        startTimer();
      }
    }, 1600);
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  const endGame = async (finalScore) => {
    setPhase('over');
    if (userId) {
      if (finalScore > best) {
        setBest(finalScore);
        await AsyncStorage.setItem(BEST_KEY(userId), String(finalScore));
      }
      await upsertGameScore(userId, 'bodyClockQuiz', finalScore);
      await recordGameHistory(userId, 'bodyClockQuiz', finalScore);
    }
  };

  if (phase === 'idle') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>⏰</Text>
      <Text style={s.title}>Body Clock Quiz</Text>
      <Text style={s.sub}>8 questions on timing — sleep,{'\n'}nutrition & training science</Text>
      {best > 0 && <Text style={s.bestText}>🏆 Best: {best}/{QUESTIONS_PER_GAME}</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Ionicons name="play" size={16} color="#000" />
        <Text style={s.startBtnText}>START QUIZ</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="bodyClockQuiz" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  if (phase === 'over') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🏁</Text>
      <Text style={s.title}>Quiz Complete!</Text>
      <Text style={s.scoreDisplay}>{score}<Text style={s.scoreMax}>/{QUESTIONS_PER_GAME}</Text></Text>
      <Text style={s.scoreSub}>correct answers</Text>
      {score >= best && score > 0 && <Text style={s.newBest}>🎉 New Best!</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Text style={s.startBtnText}>PLAY AGAIN</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="bodyClockQuiz" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  const q = qList[qIdx];
  const timerPct = timeLeft / QUESTION_TIME;

  return (
    <View style={s.game}>
      <View style={s.hud}>
        <Text style={s.hudQ}>{qIdx + 1}/{qList.length}</Text>
        <Text style={s.hudScore}>⚡ {score}</Text>
      </View>
      <View style={s.timerBg}>
        <View style={[s.timerFill, {
          width: `${timerPct * 100}%`,
          backgroundColor: timerPct > 0.5 ? colors.accent : timerPct > 0.25 ? '#f59e0b' : '#ef4444',
        }]} />
      </View>
      <View style={s.qCard}>
        <Text style={s.qText}>{q.q}</Text>
      </View>
      <View style={s.options}>
        {q.options.map((opt, i) => {
          const isSelected = selected === i;
          const isCorrect = q.correct === i;
          const showResult = selected !== null;
          return (
            <TouchableOpacity
              key={i}
              style={[
                s.optBtn,
                showResult && isCorrect && s.optCorrect,
                showResult && isSelected && !isCorrect && s.optWrong,
              ]}
              onPress={() => handleAnswer(i)}
              disabled={selected !== null}
              activeOpacity={0.75}
            >
              <Text style={s.optText}>{opt}</Text>
              {showResult && isCorrect && <Ionicons name="checkmark-circle" size={16} color="#22c55e" />}
              {showResult && isSelected && !isCorrect && <Ionicons name="close-circle" size={16} color="#ef4444" />}
            </TouchableOpacity>
          );
        })}
      </View>
      {selected !== null && (
        <View style={s.factBox}>
          <Text style={s.factLabel}>💡 Did you know?</Text>
          <Text style={s.factText}>{q.fact}</Text>
        </View>
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
  scoreMax: { fontSize: 32, color: colors.textMuted },
  scoreSub: { fontSize: 14, color: colors.textMuted },
  newBest: { fontSize: 15, color: '#f59e0b', fontWeight: '800' },
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 40 },
  startBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
  lbBtn: { paddingVertical: 8 },
  lbBtnText: { fontSize: 13, color: colors.textMuted },
  hud: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  hudQ: { fontSize: 14, color: colors.textMuted, fontWeight: '700' },
  hudScore: { fontSize: 14, fontWeight: '900', color: colors.accent },
  timerBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginBottom: 16, overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: 3 },
  qCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, padding: 20, marginBottom: 14 },
  qText: { fontSize: 16, fontWeight: '700', color: colors.text, lineHeight: 24 },
  options: { gap: 10, marginBottom: 12 },
  optBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 14 },
  optCorrect: { borderColor: '#22c55e', backgroundColor: '#22c55e18' },
  optWrong: { borderColor: '#ef4444', backgroundColor: '#ef444418' },
  optText: { fontSize: 14, color: colors.text, flex: 1 },
  factBox: { backgroundColor: colors.accent + '15', borderRadius: 12, borderWidth: 1, borderColor: colors.accent + '40', padding: 14, gap: 4 },
  factLabel: { fontSize: 11, fontWeight: '800', color: colors.accent, letterSpacing: 0.5 },
  factText: { fontSize: 13, color: colors.text, lineHeight: 18 },
});
