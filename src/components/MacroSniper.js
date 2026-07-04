import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { upsertGameScore, recordGameHistory, GameLeaderboard } from './GameLeaderboard';

const { width: SW } = Dimensions.get('window');
const LANE_COUNT = 3;
const FOOD_SIZE = 64;
const GAME_WIDTH = SW - 32;
const LANE_W = GAME_WIDTH / LANE_COUNT;

const FOODS = [
  { name: 'Chicken', macro: 'protein', emoji: '🍗' },
  { name: 'Rice', macro: 'carbs', emoji: '🍚' },
  { name: 'Avocado', macro: 'fat', emoji: '🥑' },
  { name: 'Egg', macro: 'protein', emoji: '🥚' },
  { name: 'Bread', macro: 'carbs', emoji: '🍞' },
  { name: 'Cheese', macro: 'fat', emoji: '🧀' },
  { name: 'Tuna', macro: 'protein', emoji: '🐟' },
  { name: 'Pasta', macro: 'carbs', emoji: '🍝' },
  { name: 'Butter', macro: 'fat', emoji: '🧈' },
  { name: 'Yogurt', macro: 'protein', emoji: '🥛' },
  { name: 'Banana', macro: 'carbs', emoji: '🍌' },
  { name: 'Almonds', macro: 'fat', emoji: '🌰' },
];

const MACROS = ['protein', 'carbs', 'fat'];
const MACRO_COLORS = { protein: '#a855f7', carbs: '#f59e0b', fat: '#22c55e' };
const MACRO_EMOJI = { protein: '💪', carbs: '⚡', fat: '🫀' };

const BEST_KEY = (uid) => `fitzo:macroSniper:${uid}:best`;
const BASE_SPAWN = 2200;
const MIN_SPAWN = 700;
const FOOD_SPEED = 3500;

let nextId = 1;

export default function MacroSniper({ userId }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState('idle');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [target, setTarget] = useState('protein');
  const [foods, setFoods] = useState([]);
  const [best, setBest] = useState(0);
  const [lbVisible, setLbVisible] = useState(false);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const targetRef = useRef('protein');
  const spawnRef = useRef(null);
  const moveRef = useRef(null);
  const s = styles(colors);

  useEffect(() => {
    if (userId) AsyncStorage.getItem(BEST_KEY(userId)).then(v => { if (v) setBest(Number(v)); });
  }, [userId]);

  const startGame = () => {
    scoreRef.current = 0;
    livesRef.current = 3;
    setScore(0);
    setLives(3);
    setFoods([]);
    const t = MACROS[Math.floor(Math.random() * MACROS.length)];
    targetRef.current = t;
    setTarget(t);
    setPhase('playing');
  };

  useEffect(() => {
    if (phase !== 'playing') return;
    const spawnInterval = () => Math.max(MIN_SPAWN, BASE_SPAWN - scoreRef.current * 30);

    const spawnFood = () => {
      const lane = Math.floor(Math.random() * LANE_COUNT);
      const food = FOODS[Math.floor(Math.random() * FOODS.length)];
      const id = nextId++;
      setFoods(prev => [...prev, { ...food, id, lane, y: -FOOD_SIZE }]);
      spawnRef.current = setTimeout(spawnFood, spawnInterval());
    };
    spawnRef.current = setTimeout(spawnFood, 400);

    moveRef.current = setInterval(() => {
      setFoods(prev => {
        const updated = prev.map(f => ({ ...f, y: f.y + 6 }));
        const escaped = updated.filter(f => f.y > 320);
        escaped.forEach(f => {
          if (f.macro === targetRef.current) {
            livesRef.current = Math.max(0, livesRef.current - 1);
            setLives(livesRef.current);
            if (livesRef.current <= 0) {
              clearTimeout(spawnRef.current);
              clearInterval(moveRef.current);
              endGame(scoreRef.current);
            }
          }
        });
        return updated.filter(f => f.y <= 320);
      });
    }, 50);

    return () => {
      clearTimeout(spawnRef.current);
      clearInterval(moveRef.current);
    };
  }, [phase]);

  const tapFood = (food) => {
    if (phase !== 'playing') return;
    setFoods(prev => prev.filter(f => f.id !== food.id));
    if (food.macro === targetRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      scoreRef.current += 1;
      setScore(scoreRef.current);
      if (scoreRef.current % 10 === 0) {
        const newTarget = MACROS[Math.floor(Math.random() * MACROS.length)];
        targetRef.current = newTarget;
        setTarget(newTarget);
      }
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      livesRef.current = Math.max(0, livesRef.current - 1);
      setLives(livesRef.current);
      if (livesRef.current <= 0) {
        clearTimeout(spawnRef.current);
        clearInterval(moveRef.current);
        endGame(scoreRef.current);
      }
    }
  };

  const endGame = async (finalScore) => {
    setPhase('over');
    setFoods([]);
    if (userId) {
      if (finalScore > best) {
        setBest(finalScore);
        await AsyncStorage.setItem(BEST_KEY(userId), String(finalScore));
      }
      await upsertGameScore(userId, 'macroSniper', finalScore);
      await recordGameHistory(userId, 'macroSniper', finalScore);
    }
  };

  if (phase === 'idle') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🎯</Text>
      <Text style={s.title}>Macro Sniper</Text>
      <Text style={s.sub}>Tap foods that match the target macro{'\n'}before they escape!</Text>
      {best > 0 && <Text style={s.bestText}>🏆 Best: {best} hits</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Ionicons name="play" size={16} color="#000" />
        <Text style={s.startBtnText}>START GAME</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="macroSniper" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  if (phase === 'over') return (
    <View style={s.center}>
      <Text style={s.bigEmoji}>🏁</Text>
      <Text style={s.title}>Game Over!</Text>
      <Text style={s.scoreDisplay}>{score}</Text>
      <Text style={s.scoreSub}>correct hits</Text>
      {score >= best && score > 0 && <Text style={s.newBest}>🎉 New Best!</Text>}
      <TouchableOpacity style={s.startBtn} onPress={startGame}>
        <Text style={s.startBtnText}>PLAY AGAIN</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.lbBtn} onPress={() => setLbVisible(true)}>
        <Text style={s.lbBtnText}>🏅 Leaderboard</Text>
      </TouchableOpacity>
      <GameLeaderboard game="macroSniper" userId={userId} visible={lbVisible} onClose={() => setLbVisible(false)} />
    </View>
  );

  const tc = MACRO_COLORS[target];

  return (
    <View style={s.game}>
      <View style={s.hud}>
        <Text style={s.hudScore}>⚡ {score}</Text>
        <View style={[s.targetPill, { backgroundColor: tc + '20', borderColor: tc + '60' }]}>
          <Text style={s.targetPillText}>{MACRO_EMOJI[target]} TAP {target.toUpperCase()}</Text>
        </View>
        <Text style={s.hudLives}>{'❤️'.repeat(lives)}{'🖤'.repeat(3 - lives)}</Text>
      </View>
      <View style={s.arena}>
        {foods.map(food => (
          <TouchableOpacity
            key={food.id}
            style={[s.foodItem, {
              left: food.lane * LANE_W + (LANE_W - FOOD_SIZE) / 2,
              top: food.y,
              borderColor: MACRO_COLORS[food.macro] + '60',
              backgroundColor: MACRO_COLORS[food.macro] + '20',
            }]}
            onPress={() => tapFood(food)}
            activeOpacity={0.7}
          >
            <Text style={s.foodEmoji}>{food.emoji}</Text>
          </TouchableOpacity>
        ))}
        <View style={s.laneLines}>
          {[1, 2].map(i => (
            <View key={i} style={[s.laneLine, { left: i * LANE_W }]} />
          ))}
        </View>
      </View>
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
  hud: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  hudScore: { fontSize: 18, fontWeight: '900', color: colors.text },
  hudLives: { fontSize: 14 },
  targetPill: { borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 5 },
  targetPillText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#fff' },
  arena: { height: 320, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', position: 'relative' },
  foodItem: { position: 'absolute', width: FOOD_SIZE, height: FOOD_SIZE, borderRadius: FOOD_SIZE / 2, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  foodEmoji: { fontSize: 30 },
  laneLines: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  laneLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
});
