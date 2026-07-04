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

const GAMES = [
  {
    key: 'trivia',
    emoji: '🧠',
    name: 'Nutrition Trivia',
    desc: 'Test your food & nutrition knowledge',
    color: '#a855f7',
  },
  {
    key: 'memory',
    emoji: '🃏',
    name: 'Memory Match',
    desc: 'Flip cards and match fitness pairs',
    color: '#06b6d4',
  },
  {
    key: 'calorie',
    emoji: '🍎',
    name: 'Calorie Guesser',
    desc: 'Guess how many calories are in each food',
    color: '#22c55e',
  },
  {
    key: 'higher',
    emoji: '⬆️',
    name: 'Higher or Lower',
    desc: 'Is the next food higher or lower in calories?',
    color: '#f59e0b',
  },
  {
    key: 'macro',
    emoji: '🥗',
    name: 'Macro Match',
    desc: 'Pick the food with the most (or least) of a macro',
    color: '#34d399',
  },
];

const BG = '#080812';
const CARD_BG = '#0f0f1e';
const BORDER = '#ffffff0e';

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
      <StatusBar barStyle="light-content" backgroundColor={BG} />
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
            <Text style={s.heroEmoji}>🎮</Text>
            <Text style={s.heroHeading}>Play & Earn</Text>
            <Text style={s.heroSub}>5 fitness mini-games · win XP & badges</Text>
            {streak > 0 && (
              <View style={s.streakBadge}>
                <Text style={s.streakText}>🔥 {streak} day streak</Text>
              </View>
            )}
          </View>

          {/* Game picker cards */}
          <Text style={s.sectionLabel}>CHOOSE A GAME</Text>
          <View style={s.list}>
            {GAMES.map((g, i) => (
              <TouchableOpacity
                key={g.key}
                style={s.gameCard}
                onPress={() => scrollToGame(g.key)}
                activeOpacity={0.7}
              >
                {/* left accent bar */}
                <View style={[s.accentBar, { backgroundColor: g.color }]} />

                {/* icon */}
                <View style={[s.iconWrap, { backgroundColor: g.color + '18' }]}>
                  <Text style={s.iconEmoji}>{g.emoji}</Text>
                </View>

                {/* text */}
                <View style={s.cardText}>
                  <Text style={s.cardName}>{g.name}</Text>
                  <Text style={s.cardDesc}>{g.desc}</Text>
                </View>

                {/* play arrow */}
                <View style={[s.playBtn, { backgroundColor: g.color + '18' }]}>
                  <Ionicons name="play" size={13} color={g.color} />
                </View>
              </TouchableOpacity>
            ))}
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
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#ffffff10', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: 0.3,
  },

  scroll: { paddingHorizontal: 16, paddingTop: 4 },

  hero: {
    alignItems: 'center', paddingVertical: 28,
  },
  heroEmoji: { fontSize: 44, marginBottom: 10 },
  heroHeading: {
    fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: 0.5,
  },
  heroSub: {
    fontSize: 13, color: '#ffffff55', marginTop: 4, letterSpacing: 0.2,
  },
  streakBadge: {
    marginTop: 10, paddingHorizontal: 14, paddingVertical: 5,
    backgroundColor: '#ff6b3520', borderRadius: 20, borderWidth: 1, borderColor: '#ff6b3540',
  },
  streakText: { fontSize: 13, color: '#ff9944', fontWeight: '700' },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: '#ffffff30',
    letterSpacing: 3, marginBottom: 12,
  },

  list: { gap: 10, marginBottom: 28 },

  gameCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_BG,
    borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    overflow: 'hidden', gap: 12, paddingRight: 14,
  },

  accentBar: { width: 4, alignSelf: 'stretch' },

  iconWrap: {
    width: 46, height: 46, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    marginVertical: 14,
  },
  iconEmoji: { fontSize: 22 },

  cardText: { flex: 1, paddingVertical: 14 },
  cardName: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 3 },
  cardDesc: { fontSize: 12, color: '#ffffff50', lineHeight: 16 },

  playBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  divider: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20,
  },
  divLine: { flex: 1, height: 1, backgroundColor: '#ffffff0e' },
  divText: {
    fontSize: 10, color: '#ffffff25', letterSpacing: 2, fontWeight: '700',
  },
});
