import React, { useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  StatusBar, Dimensions, findNodeHandle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

import NutritionTrivia from '../components/NutritionTrivia';
import MemoryMatch from '../components/MemoryMatch';
import CalorieGuesser from '../components/CalorieGuesser';
import HigherOrLower from '../components/HigherOrLower';
import MacroMatch from '../components/MacroMatch';
import { useGameStreak } from '../components/GameStreak';

const { width: W } = Dimensions.get('window');
const CARD_W = (W - 32 - 10) / 2; // 2 columns, 16px side padding, 10px gap

const GAMES = [
  {
    key: 'trivia',
    emoji: '🧠',
    name: 'Nutrition\nTrivia',
    desc: 'Test your knowledge',
    color: '#a855f7',
    glow: '#a855f730',
    bg: '#1a0d2e',
  },
  {
    key: 'memory',
    emoji: '🃏',
    name: 'Memory\nMatch',
    desc: 'Flip & match pairs',
    color: '#06b6d4',
    glow: '#06b6d430',
    bg: '#061e24',
  },
  {
    key: 'calorie',
    emoji: '🍎',
    name: 'Calorie\nGuesser',
    desc: 'Guess the calories',
    color: '#22c55e',
    glow: '#22c55e30',
    bg: '#061a0e',
  },
  {
    key: 'higher',
    emoji: '⬆️',
    name: 'Higher or\nLower',
    desc: 'Compare calories',
    color: '#f59e0b',
    glow: '#f59e0b30',
    bg: '#1e1400',
  },
  {
    key: 'macro',
    emoji: '🥗',
    name: 'Macro\nMatch',
    desc: 'Pick the right macro',
    color: '#34d399',
    glow: '#34d39930',
    bg: '#061a12',
  },
];

// Always dark — never changes with theme
const BG = '#06060f';
const HEADER_BG = '#06060f';

export default function GameZoneScreen({ navigation }) {
  const { user } = useAuth();
  const scrollRef = useRef(null);
  const gameRefs = useRef({});
  const { streak } = useGameStreak(user?.id);

  function scrollToGame(key) {
    const ref = gameRefs.current[key];
    const scrollNode = findNodeHandle(scrollRef.current);
    if (ref && scrollNode) {
      ref.measureLayout(
        scrollNode,
        (_x, y) => scrollRef.current.scrollTo({ y: y - 16, animated: true }),
        () => {}
      );
    }
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={HEADER_BG} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Game Zone</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={s.hero}>
            <View style={s.heroBadge}>
              <Text style={s.heroBadgeText}>🎮  PLAY & EARN</Text>
            </View>
            <Text style={s.heroHeading}>Level Up Your{'\n'}Fitness IQ</Text>
            <Text style={s.heroSub}>5 mini-games · XP · Leaderboards</Text>
            {streak > 0 && (
              <View style={s.streakBadge}>
                <Text style={s.streakText}>🔥 {streak}-day streak</Text>
              </View>
            )}
          </View>

          {/* Game grid */}
          <Text style={s.sectionLabel}>CHOOSE A GAME</Text>
          <View style={s.grid}>
            {GAMES.map((g, i) => {
              const isLast = i === GAMES.length - 1;
              const isOdd = GAMES.length % 2 !== 0;
              const fullWidth = isLast && isOdd;
              return (
                <TouchableOpacity
                  key={g.key}
                  style={[
                    s.gameCard,
                    { backgroundColor: g.bg, borderColor: g.color + '40' },
                    fullWidth && { width: '100%' },
                  ]}
                  onPress={() => scrollToGame(g.key)}
                  activeOpacity={0.75}
                >
                  {/* glow blob */}
                  <View style={[s.glowBlob, { backgroundColor: g.glow }]} />

                  {/* top row: emoji + play btn */}
                  <View style={s.cardTop}>
                    <View style={[s.emojiWrap, { backgroundColor: g.color + '20', borderColor: g.color + '40' }]}>
                      <Text style={s.cardEmoji}>{g.emoji}</Text>
                    </View>
                    <View style={[s.playChip, { backgroundColor: g.color }]}>
                      <Ionicons name="play" size={10} color="#000" />
                      <Text style={s.playChipText}>PLAY</Text>
                    </View>
                  </View>

                  {/* name */}
                  <Text style={[s.cardName, { color: '#fff' }]}>{g.name}</Text>

                  {/* desc */}
                  <Text style={[s.cardDesc, { color: g.color + 'cc' }]}>{g.desc}</Text>

                  {/* bottom accent line */}
                  <View style={[s.bottomLine, { backgroundColor: g.color }]} />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Divider */}
          <View style={s.divider}>
            <View style={s.divLine} />
            <Text style={s.divText}>PLAY BELOW</Text>
            <View style={s.divLine} />
          </View>

          {/* Game components */}
          <View ref={r => { gameRefs.current['trivia'] = r; }}>
            <NutritionTrivia userId={user?.id} />
          </View>
          <View ref={r => { gameRefs.current['memory'] = r; }}>
            <MemoryMatch userId={user?.id} />
          </View>
          <View ref={r => { gameRefs.current['calorie'] = r; }}>
            <CalorieGuesser userId={user?.id} />
          </View>
          <View ref={r => { gameRefs.current['higher'] = r; }}>
            <HigherOrLower userId={user?.id} />
          </View>
          <View ref={r => { gameRefs.current['macro'] = r; }}>
            <MacroMatch userId={user?.id} />
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, backgroundColor: HEADER_BG,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#ffffff12', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#ffffff18',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  scroll: { paddingHorizontal: 16, paddingTop: 4 },

  /* Hero */
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

  /* 2-column game grid */
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28,
  },

  gameCard: {
    width: CARD_W,
    borderRadius: 18, borderWidth: 1,
    padding: 16, overflow: 'hidden',
    minHeight: 160,
  },

  glowBlob: {
    position: 'absolute', width: 100, height: 100,
    borderRadius: 50, top: -20, right: -20,
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

  playChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
  },
  playChipText: { fontSize: 9, fontWeight: '900', color: '#000', letterSpacing: 1 },

  cardName: {
    fontSize: 16, fontWeight: '800', lineHeight: 20, marginBottom: 6, letterSpacing: 0.2,
  },
  cardDesc: { fontSize: 11, fontWeight: '500', lineHeight: 15 },

  bottomLine: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: 2,
  },

  /* Divider */
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: '#ffffff0e' },
  divText: { fontSize: 10, color: '#ffffff25', letterSpacing: 2, fontWeight: '700' },
});
