import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  StatusBar, Dimensions, Modal, SafeAreaView as RNSafeAreaView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { ThemeContext } from '../context/ThemeContext';
import { darkColors } from '../theme/colors';

import NutritionTrivia from '../components/NutritionTrivia';
import MemoryMatch from '../components/MemoryMatch';
import CalorieGuesser from '../components/CalorieGuesser';
import HigherOrLower from '../components/HigherOrLower';
import MacroMatch from '../components/MacroMatch';
import MacroSniper from '../components/MacroSniper';
import FoodSortingRush from '../components/FoodSortingRush';
import CalorieStack from '../components/CalorieStack';
import WorkoutBuilderPuzzle from '../components/WorkoutBuilderPuzzle';
import BodyClockQuiz from '../components/BodyClockQuiz';
import { useGameStreak } from '../components/GameStreak';
import { useTranslation } from 'react-i18next';

const { width: W } = Dimensions.get('window');
const CARD_W = (W - 32 - 10) / 2;

// Ordered most addictive first
const GAMES = [
  {
    key: 'sniper',
    emoji: '🎯',
    name: 'Macro\nSniper',
    desc: 'Tap the right macro',
    color: '#ef4444',
    glow: '#ef444430',
    bg: '#1a0202',
    hot: true,
  },
  {
    key: 'sorting',
    emoji: '🍽️',
    name: 'Food\nSorting Rush',
    desc: 'Sort before time runs out',
    color: '#f97316',
    glow: '#f9731630',
    bg: '#1a0800',
    hot: true,
  },
  {
    key: 'memory',
    emoji: '🃏',
    name: 'Memory\nMatch',
    desc: 'Flip & match pairs',
    color: '#06b6d4',
    glow: '#06b6d430',
    bg: '#041620',
  },
  {
    key: 'higher',
    emoji: '⬆️',
    name: 'Higher or\nLower',
    desc: 'Compare calories',
    color: '#f59e0b',
    glow: '#f59e0b30',
    bg: '#1a1002',
  },
  {
    key: 'cstack',
    emoji: '🍔',
    name: 'Calorie\nStack',
    desc: 'Hit the calorie target',
    color: '#fb923c',
    glow: '#fb923c30',
    bg: '#180a00',
  },
  {
    key: 'workout',
    emoji: '🏋️',
    name: 'Workout\nBuilder',
    desc: 'Pick the right exercises',
    color: '#8b5cf6',
    glow: '#8b5cf630',
    bg: '#0e0620',
  },
  {
    key: 'calorie',
    emoji: '🍎',
    name: 'Calorie\nGuesser',
    desc: 'Guess the calories',
    color: '#22c55e',
    glow: '#22c55e30',
    bg: '#041610',
  },
  {
    key: 'macro',
    emoji: '🥗',
    name: 'Macro\nMatch',
    desc: 'Pick the right macro',
    color: '#34d399',
    glow: '#34d39930',
    bg: '#041610',
  },
  {
    key: 'bodyclock',
    emoji: '⏰',
    name: 'Body Clock\nQuiz',
    desc: 'Timing science quiz',
    color: '#a3e635',
    glow: '#a3e63530',
    bg: '#0a1200',
  },
  {
    key: 'trivia',
    emoji: '🧠',
    name: 'Nutrition\nTrivia',
    desc: 'Test your knowledge',
    color: '#a855f7',
    glow: '#a855f730',
    bg: '#120820',
  },
];

const GAME_COMPONENTS = {
  trivia: NutritionTrivia,
  memory: MemoryMatch,
  calorie: CalorieGuesser,
  higher: HigherOrLower,
  macro: MacroMatch,
  sniper: MacroSniper,
  sorting: FoodSortingRush,
  cstack: CalorieStack,
  workout: WorkoutBuilderPuzzle,
  bodyclock: BodyClockQuiz,
};

function makeGameTheme(g) {
  return {
    ...darkColors,
    bg: g.bg,
    bgCard: g.color + '14',
    bgElevated: g.color + '0e',
    surface: g.color + '10',
    card: g.color + '14',
    border: g.color + '35',
    border2: g.color + '50',
    accent: g.color,
    accentDim: g.color,
    accentText: '#000000',
    dim: g.color + '12',
    text: '#ffffff',
    textMuted: 'rgba(255,255,255,0.65)',
    textDim: 'rgba(255,255,255,0.35)',
    success: g.color,
    good: g.color,
  };
}

const BG = '#06060f';

export default function GameZoneScreen({ navigation }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { streak } = useGameStreak(user?.id);
  const [activeGame, setActiveGame] = useState(null);

  const game = GAMES.find(g => g.key === activeGame);
  const GameComponent = activeGame ? GAME_COMPONENTS[activeGame] : null;
  const gameTheme = game ? makeGameTheme(game) : null;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>{t('gameZone.title')}</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Hero */}
          <View style={s.hero}>
            <View style={s.heroBadge}>
              <Text style={s.heroBadgeText}>{t('gameZone.heroBadge')}</Text>
            </View>
            <Text style={s.heroHeading}>{t('gameZone.heroHeading')}</Text>
            <Text style={s.heroSub}>10 mini-games · XP · Leaderboards</Text>
            {streak > 0 && (
              <View style={s.streakBadge}>
                <Text style={s.streakText}>🔥 {streak}-day streak</Text>
              </View>
            )}
          </View>

          {/* Game grid */}
          <Text style={s.sectionLabel}>{t('gameZone.chooseGame')}</Text>
          <View style={s.grid}>
            {GAMES.map((g, i) => {
              const isLast = i === GAMES.length - 1;
              const fullWidth = isLast && GAMES.length % 2 !== 0;
              return (
                <TouchableOpacity
                  key={g.key}
                  style={[
                    s.gameCard,
                    { backgroundColor: g.bg, borderColor: g.color + '50' },
                    fullWidth && s.gameCardFull,
                  ]}
                  onPress={() => setActiveGame(g.key)}
                  activeOpacity={0.8}
                >
                  <View style={[s.glowBlob, { backgroundColor: g.glow }]} />
                  <View style={s.cardTop}>
                    <View style={[s.emojiWrap, { backgroundColor: g.color + '20', borderColor: g.color + '40' }]}>
                      <Text style={s.cardEmoji}>{g.emoji}</Text>
                    </View>
                    {g.hot && (
                      <View style={s.hotBadge}>
                        <Text style={s.hotBadgeText}>{t('gameZone.hot')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.cardName}>{g.name}</Text>
                  <Text style={[s.cardDesc, { color: g.color + 'bb' }]}>{g.desc}</Text>
                  <View style={s.cardFooter}>
                    <TouchableOpacity
                      style={[s.playBtn, { backgroundColor: g.color }]}
                      onPress={() => setActiveGame(g.key)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="play" size={12} color="#000" />
                      <Text style={s.playBtnText}>{t('gameZone.play')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={[s.bottomLine, { backgroundColor: g.color }]} />
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Full-screen game modal with blended theme */}
      <Modal
        visible={!!activeGame}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setActiveGame(null)}
      >
        {game && gameTheme && (
          <ThemeContext.Provider value={{ colors: gameTheme, isDark: true, ready: true, toggleTheme: () => {}, setIsDark: () => {} }}>
            <View style={[s.modalRoot, { backgroundColor: game.bg }]}>
              <StatusBar barStyle="light-content" backgroundColor={game.bg} />
              <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
                {/* Modal header */}
                <View style={[s.modalHeader, { borderBottomColor: game.color + '25' }]}>
                  <TouchableOpacity
                    onPress={() => setActiveGame(null)}
                    style={[s.closeBtn, { backgroundColor: game.color + '18', borderColor: game.color + '40' }]}
                  >
                    <Ionicons name="chevron-down" size={20} color={game.color} />
                  </TouchableOpacity>
                  <View style={s.modalTitleRow}>
                    <Text style={s.modalEmoji}>{game.emoji}</Text>
                    <Text style={[s.modalTitle, { color: game.color }]}>
                      {game.name.replace('\n', ' ')}
                    </Text>
                  </View>
                  <View style={{ width: 36 }} />
                </View>

                {/* Game content — inherits blended theme via context */}
                <ScrollView
                  contentContainerStyle={s.modalScroll}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {GameComponent && <GameComponent userId={user?.id} />}
                  <View style={{ height: 40 }} />
                </ScrollView>
              </SafeAreaView>
            </View>
          </ThemeContext.Provider>
        )}
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#ffffff12', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#ffffff18',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  scroll: { paddingHorizontal: 16, paddingTop: 4 },

  hero: { alignItems: 'center', paddingVertical: 28 },
  heroBadge: {
    backgroundColor: '#d4ff0015', borderRadius: 20, borderWidth: 1,
    borderColor: '#d4ff0040', paddingHorizontal: 14, paddingVertical: 5, marginBottom: 16,
  },
  heroBadgeText: { fontSize: 11, fontWeight: '800', color: '#d4ff00', letterSpacing: 2 },
  heroHeading: {
    fontSize: 30, fontWeight: '900', color: '#fff',
    textAlign: 'center', lineHeight: 36, letterSpacing: 0.3,
  },
  heroSub: { fontSize: 13, color: '#ffffff45', marginTop: 10, letterSpacing: 0.3 },
  streakBadge: {
    marginTop: 14, paddingHorizontal: 16, paddingVertical: 6,
    backgroundColor: '#ff6b3518', borderRadius: 20, borderWidth: 1, borderColor: '#ff6b3540',
  },
  streakText: { fontSize: 13, color: '#ff9944', fontWeight: '800' },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: '#ffffff30',
    letterSpacing: 3, marginBottom: 14,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

  gameCard: {
    width: CARD_W, borderRadius: 18, borderWidth: 1,
    padding: 16, overflow: 'hidden', minHeight: 170,
  },
  gameCardFull: { width: '100%' },

  glowBlob: {
    position: 'absolute', width: 110, height: 110,
    borderRadius: 55, top: -25, right: -25,
  },

  cardTop: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', marginBottom: 14,
  },
  emojiWrap: {
    width: 50, height: 50, borderRadius: 14, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  cardEmoji: { fontSize: 26 },

  hotBadge: {
    backgroundColor: '#ff4d0018', borderRadius: 8, borderWidth: 1,
    borderColor: '#ff4d0050', paddingHorizontal: 7, paddingVertical: 3,
  },
  hotBadgeText: { fontSize: 9, fontWeight: '900', color: '#ff6a00', letterSpacing: 1 },

  cardName: { fontSize: 16, fontWeight: '800', lineHeight: 20, marginBottom: 6, color: '#fff', letterSpacing: 0.2 },
  cardDesc: { fontSize: 11, fontWeight: '500', lineHeight: 15, marginBottom: 10 },

  cardFooter: { alignItems: 'flex-start' },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  playBtnText: { fontSize: 11, fontWeight: '900', color: '#000', letterSpacing: 1 },

  bottomLine: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },

  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalEmoji: { fontSize: 20 },
  modalTitle: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  modalScroll: { paddingHorizontal: 16, paddingTop: 12 },
});
