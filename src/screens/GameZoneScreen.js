import React, { useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

import DailySpin from '../components/DailySpin';
import NutritionTrivia from '../components/NutritionTrivia';
import MemoryMatch from '../components/MemoryMatch';
import ReactionTap from '../components/ReactionTap';
import CalorieGuesser from '../components/CalorieGuesser';
import HigherOrLower from '../components/HigherOrLower';

const { width: W } = Dimensions.get('window');

const GAMES = [
  { key: 'spin',    emoji: '🎯', name: 'Daily\nChallenge', color: '#ff6b35', glow: '#ff6b3540' },
  { key: 'trivia',  emoji: '🧠', name: 'Nutrition\nTrivia',   color: '#a855f7', glow: '#a855f740' },
  { key: 'memory',  emoji: '🃏', name: 'Memory\nMatch',      color: '#06b6d4', glow: '#06b6d440' },
  { key: 'calorie', emoji: '🍎', name: 'Calorie\nGuesser',   color: '#22c55e', glow: '#22c55e40' },
  { key: 'higher',  emoji: '⬆️', name: 'Higher or\nLower',   color: '#f59e0b', glow: '#f59e0b40' },
  { key: 'reaction',emoji: '⚡', name: 'Reaction\nTap',      color: '#d4ff00', glow: '#d4ff0040' },
];

export default function GameZoneScreen({ navigation }) {
  const { user } = useAuth();
  const scrollRef = useRef(null);
  const gameRefs = useRef({});

  function scrollToGame(key) {
    const ref = gameRefs.current[key];
    if (ref && scrollRef.current) {
      ref.measureLayout(
        scrollRef.current,
        (_x, y) => scrollRef.current.scrollTo({ y: y - 12, animated: true }),
        () => {}
      );
    }
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#08081a" />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* ── Header ─────────────────────────────────────────── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerEmoji}>🎮</Text>
            <Text style={s.headerTitle}>GAME ZONE</Text>
            <Text style={s.headerSub}>6 fitness mini-games</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Game Grid ──────────────────────────────────────── */}
          <Text style={s.sectionLabel}>CHOOSE A GAME</Text>
          <View style={s.grid}>
            {GAMES.map((g) => (
              <TouchableOpacity
                key={g.key}
                style={[s.gridCard, { borderColor: g.color + '50', shadowColor: g.color }]}
                onPress={() => scrollToGame(g.key)}
                activeOpacity={0.75}
              >
                <View style={[s.gridGlow, { backgroundColor: g.glow }]} />
                <View style={[s.gridIconWrap, { backgroundColor: g.color + '20' }]}>
                  <Text style={s.gridEmoji}>{g.emoji}</Text>
                </View>
                <Text style={[s.gridName, { color: g.color }]} numberOfLines={2}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Divider ──────────────────────────────────────── */}
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>▼ PLAY</Text>
            <View style={s.dividerLine} />
          </View>

          {/* ── Games ──────────────────────────────────────────── */}
          <View ref={r => gameRefs.current['spin'] = r}>
            <DailySpin userId={user?.id} />
          </View>
          <View ref={r => gameRefs.current['trivia'] = r}>
            <NutritionTrivia userId={user?.id} />
          </View>
          <View ref={r => gameRefs.current['memory'] = r}>
            <MemoryMatch userId={user?.id} />
          </View>
          <View ref={r => gameRefs.current['calorie'] = r}>
            <CalorieGuesser userId={user?.id} />
          </View>
          <View ref={r => gameRefs.current['higher'] = r}>
            <HigherOrLower userId={user?.id} />
          </View>
          <View ref={r => gameRefs.current['reaction'] = r}>
            <ReactionTap userId={user?.id} />
          </View>

          <View style={{ height: 30 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#08081a' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#ffffff12',
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#ffffff12', alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { alignItems: 'center' },
  headerEmoji: { fontSize: 22 },
  headerTitle: {
    fontSize: 20, fontWeight: '900', color: '#d4ff00',
    letterSpacing: 4,
    textShadowColor: '#d4ff00', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  headerSub: { fontSize: 10, color: '#ffffff60', letterSpacing: 2, marginTop: 1 },

  scroll: { paddingHorizontal: 14, paddingTop: 18 },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: '#ffffff40',
    letterSpacing: 3, marginBottom: 12,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 },
  gridCard: {
    width: (W - 28 - 18) / 4,
    backgroundColor: '#12122a',
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 10,
    alignItems: 'center', gap: 6,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  gridGlow: {
    position: 'absolute', top: -12, right: -12,
    width: 40, height: 40, borderRadius: 20,
  },
  gridIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  gridEmoji: { fontSize: 18 },
  gridName: { fontSize: 10, fontWeight: '800', letterSpacing: 0.1, textAlign: 'center' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#ffffff15' },
  dividerText: { fontSize: 10, color: '#ffffff30', letterSpacing: 2, fontWeight: '700' },
});
