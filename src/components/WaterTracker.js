import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { haptics } from '../lib/haptics';

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WaterTracker({ userId }) {
  const { colors } = useTheme();
  const [cups, setCups] = useState(0);
  const [goal, setGoal] = useState(8);
  const [loading, setLoading] = useState(true);
  const [logIds, setLogIds] = useState([]); // ordered list of today's log IDs

  const fetchToday = useCallback(async () => {
    if (!userId) return;
    const today = localDateStr(new Date());

    const [profileRes, logsRes] = await Promise.all([
      supabase.from('profiles').select('water_goal').eq('id', userId).single(),
      supabase
        .from('water_logs')
        .select('id, cups, logged_at')
        .eq('user_id', userId)
        .gte('logged_at', `${today}T00:00:00`)
        .lte('logged_at', `${today}T23:59:59`)
        .order('logged_at', { ascending: true }),
    ]);

    if (profileRes.data?.water_goal) {
      setGoal(profileRes.data.water_goal);
    }

    const rows = logsRes.data ?? [];
    const totalCups = rows.reduce((sum, r) => sum + (r.cups ?? 1), 0);
    setCups(totalCups);
    setLogIds(rows.map(r => r.id));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchToday();
  }, [fetchToday]);

  const addCup = async () => {
    if (!userId) return;
    haptics.light();
    // Optimistic update
    setCups(c => c + 1);
    const { data, error } = await supabase
      .from('water_logs')
      .insert({ user_id: userId, cups: 1 })
      .select('id')
      .single();
    if (error) {
      setCups(c => c - 1);
      return;
    }
    setLogIds(ids => [...ids, data.id]);
  };

  const removeCup = async () => {
    if (!userId || logIds.length === 0) return;
    haptics.light();
    const lastId = logIds[logIds.length - 1];
    // Optimistic update
    setCups(c => Math.max(0, c - 1));
    setLogIds(ids => ids.slice(0, -1));
    const { error } = await supabase.from('water_logs').delete().eq('id', lastId);
    if (error) {
      // Revert
      setCups(c => c + 1);
      setLogIds(ids => [...ids, lastId]);
    }
  };

  const goalReached = cups >= goal;
  const fillRatio = Math.min(1, goal > 0 ? cups / goal : 0);

  const styles = StyleSheet.create({
    card: {
      backgroundColor: colors.bgCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginHorizontal: 16,
      marginTop: 10,
      marginBottom: 10,
      padding: 14,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    title: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: 0.5,
      flex: 1,
    },
    badge: {
      backgroundColor: colors.bgElevated ?? colors.bg,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.accent,
    },
    progressTrack: {
      height: 6,
      backgroundColor: colors.border,
      borderRadius: 3,
      marginBottom: 12,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: '#38bdf8',
    },
    dropsRow: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 12,
      flexWrap: 'wrap',
    },
    dropBtn: {
      padding: 2,
    },
    dropText: {
      fontSize: 22,
    },
    bottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    addBtn: {
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 7,
    },
    addBtnText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.accentText ?? colors.bg ?? '#0c0c0f',
      letterSpacing: 0.3,
    },
    goalText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#34d399',
      flex: 1,
    },
  });

  if (loading) {
    return (
      <View style={[styles.card, { alignItems: 'center', paddingVertical: 20 }]}>
        <ActivityIndicator size="small" color={colors.accent} />
      </View>
    );
  }

  const drops = Array.from({ length: goal }, (_, i) => i < cups);

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>💧 Water</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{cups} / {goal} cups</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${fillRatio * 100}%` }]} />
      </View>

      {/* Drop icons */}
      <View style={styles.dropsRow}>
        {drops.map((filled, i) => (
          <TouchableOpacity
            key={i}
            style={styles.dropBtn}
            onPress={filled ? removeCup : addCup}
            activeOpacity={0.7}
          >
            <Text style={[styles.dropText, !filled && { opacity: 0.25 }]}>💧</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bottom row */}
      <View style={styles.bottomRow}>
        {goalReached ? (
          <Text style={styles.goalText}>Goal reached! 🎉</Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <TouchableOpacity style={styles.addBtn} onPress={addCup} activeOpacity={0.8}>
          <Text style={styles.addBtnText}>+ 1 cup</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
