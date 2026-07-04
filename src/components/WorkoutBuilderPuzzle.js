import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import GameLeaderboard, { upsertGameScore, recordGameHistory } from './GameLeaderboard';

const ROUNDS_DATA = [
  {
    group: 'Chest',
    correct: ['Bench Press', 'Push-up', 'Cable Fly'],
    wrong: ['Squat', 'Deadlift', 'Pull-up'],
  },
  {
    group: 'Back',
    correct: ['Pull-up', 'Bent-over Row', 'Lat Pulldown'],
    wrong: ['Bench Press', 'Leg Press', 'Crunch'],
  },
  {
    group: 'Legs',
    correct: ['Squat', 'Leg Press', 'Romanian Deadlift'],
    wrong: ['Pull-up', 'Dumbbell Curl', 'Push-up'],
  },
  {
    group: 'Shoulders',
    correct: ['Overhead Press', 'Lateral Raise', 'Face Pull'],
    wrong: ['Squat', 'Leg Curl', 'Chest Fly'],
  },
  {
    group: 'Biceps',
    correct: ['Barbell Curl', 'Hammer Curl', 'Incline Curl'],
    wrong: ['Tricep Dip', 'Squat', 'Leg Extension'],
  },
  {
    group: 'Core',
    correct: ['Plank', 'Crunch', 'Hanging Leg Raise'],
    wrong: ['Bench Press', 'Squat', 'Lat Pulldown'],
  },
];

const ROUND_TIME = 15000;
const BEST_KEY = (uid) => `fitzo:workoutBuilder:${uid}:best`;

export default function WorkoutBuilderPuzzle({ userId }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState('idle');
  const [roundIdx, setRoundIdx] = useState(0);
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState([]);
  const [timeLeft, setTimeLeft] = useState(ROUND_TIME);
  const [score, setScore] = useState(0);
  const [revealed, setRevealed] = useState(false);
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
    scoreRef.current = 0;
    setScore(0);
    setPhase('playing');
    loadRound(0);
  };

  const loadRound = (idx) => {
    const rd = ROUNDS_DATA[idx];
    setOptions(shuffle([...rd.correct, ...rd.wrong]));
    setSelected([]);
    setRevealed(false);
    setTimeLeft(ROUND_TIME);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 100) {
          clearInterval(timerRef.current);
          revealAndAdvance(idx);
          return 0;
        }
        return prev - 100;
      });
    }, 100);
  };

  const toggleSelect = (opt) => {
    if (revealed) return;
    setSelected(prev =>
      prev.includes(opt) ? prev.filter(x => x !== opt) : prev.length < 3 ? [...prev, opt] : prev
    );
  };

  const confirm = () => {
    if (revealed || selected.length < 3) return;
    clearInterval(timerRef.current);
    revealAndAdvance(roundIdx);
  };

  const revealAndAdvance = (idx) => {
    const rd = ROUNDS_DATA[idx];
    const correct = selected.filter(s => rd.correct.includes(s)).length;
    Haptics.impactAsync(correct === 3 ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    scoreRef.current += correct;
    setScore(scoreRef.current);
    setRevealed(true);

    setTimeout(() => {
      const next = idx + 1;
      if (next >= ROUNDS_DATA.length) {
        endGame(scoreRef.current);
      } else {
        setRoundIdx(next);
        loadRound(next);
      }
    }, 1200);
  };

  useEffect(() => () => clearInterval(timerRef.current), []);

  const endGame = async (finalScore) => {
    setPhase('over');
    if (userId) {
      if (finalScore > best) {
        setBest(finalScore);
        await AsyncStorage.setItem(BEST_KEY(userId), String(finalScore));
      }
      await upsertGameScore(userId, 'workoutBuilder', finalScore);
      await recordGameHistory(userId, 'workoutBuilder', finalScore);
    }
  };

  const rd = ROUNDS_DATA[roundIdx];

  if (phase === 'idle') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🏋️</Text>
      <Text style={s.title}>Workout Builder</Text>
      <Text style={s.sub}>Pick 3 exercises that target{'\n'}the shown muscle group</Text>
      {best > 0 && <Text style={s.bestText}>🏆 Best: {best}/18</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Ionicons name="play" size={16} color="#000" />
        <Text style={s.startBtnText}>START GAME</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="workoutBuilder" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  if (phase === 'over') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🏁</Text>
      <Text style={s.title}>Done!</Text>
      <Text style={s.scoreDisplay}>{score}<Text style={s.scoreMax}>/18</Text></Text>
      <Text style={s.scoreSub}>exercises correctly matched</Text>
      {score >= best && score > 0 && <Text style={s.newBest}>🎉 New Best!</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Text style={s.startBtnText}>PLAY AGAIN</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="workoutBuilder" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  const timerPct = timeLeft / ROUND_TIME;

  return (
    <View style={s.game}>
      <View style={s.hud}>
        <Text style={s.hudRound}>Round {roundIdx + 1}/{ROUNDS_DATA.length}</Text>
        <Text style={s.hudScore}>⚡ {score}</Text>
      </View>
      <View style={s.timerBg}>
        <View style={[s.timerFill, {
          width: `${timerPct * 100}%`,
          backgroundColor: timerPct > 0.5 ? colors.accent : timerPct > 0.25 ? '#f59e0b' : '#ef4444',
        }]} />
      </View>
      <View style={s.groupCard}>
        <Text style={s.groupLabel}>Target Muscle</Text>
        <Text style={s.groupName}>{rd.group}</Text>
        <Text style={s.groupSub}>Pick 3 exercises ({selected.length}/3)</Text>
      </View>
      <View style={s.optGrid}>
        {options.map((opt, i) => {
          const isSel = selected.includes(opt);
          const isCorrect = rd.correct.includes(opt);
          const showResult = revealed;
          return (
            <TouchableOpacity
              key={i}
              style={[
                s.optBtn,
                isSel && !showResult && { borderColor: colors.accent, backgroundColor: colors.accent + '20' },
                showResult && isCorrect && { borderColor: '#22c55e', backgroundColor: '#22c55e20' },
                showResult && !isCorrect && isSel && { borderColor: '#ef4444', backgroundColor: '#ef444420' },
              ]}
              onPress={() => toggleSelect(opt)}
              activeOpacity={0.75}
            >
              <Text style={s.optText}>{opt}</Text>
              {showResult && isCorrect && <Ionicons name="checkmark-circle" size={14} color="#22c55e" />}
              {showResult && !isCorrect && isSel && <Ionicons name="close-circle" size={14} color="#ef4444" />}
            </TouchableOpacity>
          );
        })}
      </View>
      {!revealed && (
        <TouchableOpacity
          style={[s.confirmBtn, selected.length < 3 && s.confirmBtnDim]}
          onPress={confirm}
          disabled={selected.length < 3}
        >
          <Text style={s.confirmBtnText}>CONFIRM ({selected.length}/3)</Text>
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
  scoreMax: { fontSize: 32, color: colors.textMuted },
  scoreSub: { fontSize: 14, color: colors.textMuted },
  newBest: { fontSize: 15, color: '#f59e0b', fontWeight: '800' },
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 40 },
  startBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
  lbBtn: { paddingVertical: 8 },
  lbBtnText: { fontSize: 13, color: colors.textMuted },
  hud: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  hudRound: { fontSize: 14, color: colors.textMuted, fontWeight: '700' },
  hudScore: { fontSize: 14, fontWeight: '900', color: colors.accent },
  timerBg: { height: 6, backgroundColor: colors.border, borderRadius: 3, marginBottom: 16, overflow: 'hidden' },
  timerFill: { height: '100%', borderRadius: 3 },
  groupCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, padding: 16, marginBottom: 16, alignItems: 'center', gap: 4 },
  groupLabel: { fontSize: 10, color: colors.textMuted, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  groupName: { fontSize: 28, fontWeight: '900', color: colors.text },
  groupSub: { fontSize: 12, color: colors.textMuted },
  optGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  optBtn: { width: '47%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, padding: 12 },
  optText: { fontSize: 13, color: colors.text, fontWeight: '600', flex: 1 },
  confirmBtn: { backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  confirmBtnDim: { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontWeight: '900', color: '#000', letterSpacing: 1 },
});
