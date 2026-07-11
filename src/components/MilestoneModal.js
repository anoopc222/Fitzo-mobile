import React, { useEffect, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

export const MILESTONES = [
  { id: 'workout_1',      label: 'First Workout!',          icon: '🏋️',  desc: 'You logged your very first session.' },
  { id: 'workout_10',     label: '10 Workouts',             icon: '🔥',  desc: 'Double digits — consistency building!' },
  { id: 'workout_25',     label: '25 Workouts',             icon: '💪',  desc: 'One quarter century of sessions.' },
  { id: 'workout_50',     label: '50 Workouts',             icon: '⚡',  desc: 'Fifty sessions strong.' },
  { id: 'workout_100',    label: '100 Workouts',            icon: '🏆',  desc: 'Century club — elite consistency.' },
  { id: 'volume_10k',     label: '10,000 kg Lifted',        icon: '🦾',  desc: 'Total volume milestone: 10k kg.' },
  { id: 'volume_100k',    label: '100,000 kg Lifted',       icon: '🚀',  desc: 'Legendary — 100 thousand kilograms!' },
  { id: 'volume_1m',      label: '1,000,000 kg Lifted',     icon: '🌟',  desc: 'One million kg. Absolutely elite.' },
  { id: 'streak_7',       label: '7-Day Streak',            icon: '📅',  desc: 'Seven days logged in a row.' },
  { id: 'streak_30',      label: '30-Day Streak',           icon: '🗓️',  desc: 'A full month of daily logging.' },
  { id: 'food_50',        label: '50 Meals Logged',         icon: '🥗',  desc: 'Nutrition tracking hero.' },
  { id: 'food_100',       label: '100 Meals Logged',        icon: '🥑',  desc: 'Consistent nutrition logging.' },
  { id: 'sleep_30',       label: '30 Sleep Logs',           icon: '😴',  desc: 'A month of sleep tracking.' },
];

export function checkMilestones({ workoutCount, totalVolume, streak, foodCount, sleepCount }) {
  const triggered = [];
  if (workoutCount >= 1)   triggered.push('workout_1');
  if (workoutCount >= 10)  triggered.push('workout_10');
  if (workoutCount >= 25)  triggered.push('workout_25');
  if (workoutCount >= 50)  triggered.push('workout_50');
  if (workoutCount >= 100) triggered.push('workout_100');
  if (totalVolume >= 10000)    triggered.push('volume_10k');
  if (totalVolume >= 100000)   triggered.push('volume_100k');
  if (totalVolume >= 1000000)  triggered.push('volume_1m');
  if (streak >= 7)   triggered.push('streak_7');
  if (streak >= 30)  triggered.push('streak_30');
  if (foodCount >= 50)  triggered.push('food_50');
  if (foodCount >= 100) triggered.push('food_100');
  if (sleepCount >= 30) triggered.push('sleep_30');
  return triggered;
}

export default function MilestoneModal({ milestone, visible, onDismiss }) {
  const { colors } = useTheme();
  const scaleAnim = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, bounciness: 14, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      scaleAnim.setValue(0.6);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  const info = MILESTONES.find(m => m.id === milestone);
  if (!info) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View style={[s.overlay, { opacity: opacityAnim }]}>
        <Animated.View style={[s.card, { backgroundColor: colors.bgCard, borderColor: colors.accent + '55', transform: [{ scale: scaleAnim }] }]}>
          <View style={s.burst}>
            <Text style={s.emoji}>{info.icon}</Text>
          </View>
          <Text style={[s.label, { color: colors.accent }]}>MILESTONE UNLOCKED</Text>
          <Text style={[s.title, { color: colors.text }]}>{info.label}</Text>
          <Text style={[s.desc, { color: colors.textMuted }]}>{info.desc}</Text>
          <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={[s.btnText, { color: colors.bg }]}>Let's Go!</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 360, borderRadius: 24, borderWidth: 1,
    padding: 28, alignItems: 'center',
    shadowColor: '#d4ff00', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 16,
  },
  burst: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(212,255,0,0.12)', alignItems: 'center',
    justifyContent: 'center', marginBottom: 16,
  },
  emoji: { fontSize: 40 },
  label: {
    fontSize: 10, fontWeight: '800', letterSpacing: 2,
    marginBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  desc: { fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 24 },
  btn: {
    borderRadius: 14, paddingHorizontal: 32, paddingVertical: 12,
    alignSelf: 'stretch', alignItems: 'center',
  },
  btnText: { fontWeight: '800', fontSize: 15 },
});
