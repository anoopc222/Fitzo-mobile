import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MOOD_EMOJIS  = ['', '😞', '😕', '😐', '🙂', '😄'];
const ENERGY_EMOJIS = ['', '🪫', '😴', '⚡', '🔋', '🚀'];
const MOOD_LABELS   = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Great'];
const ENERGY_LABELS = ['', 'Drained', 'Low', 'Moderate', 'High', 'Peak'];

async function fetchMoodLogs(userId) {
  const { data, error } = await supabase
    .from('mood_logs')
    .select('id, date, mood, energy, notes, logged_at')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

async function upsertMoodLog(userId, { date, mood, energy, notes }) {
  const { error } = await supabase
    .from('mood_logs')
    .upsert({ user_id: userId, date, mood, energy, notes: notes || null },
      { onConflict: 'user_id,date' });
  if (error) throw error;
}

export default function MoodLogScreen({ navigation }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const qc = useQueryClient();
  const s = useMemo(() => styles(colors), [colors]);

  const today = localDateStr(new Date());
  const [mood, setMood]     = useState(0);
  const [energy, setEnergy] = useState(0);
  const [notes, setNotes]   = useState('');

  const { data: logs = [], isLoading, refetch } = useQuery({
    queryKey: ['mood-logs', user?.id],
    queryFn: () => fetchMoodLogs(user?.id),
    enabled: !!user?.id,
    staleTime: 0, gcTime: 0,
  });

  const todayLog = useMemo(() => logs.find(l => l.date === today), [logs, today]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => upsertMoodLog(user.id, { date: today, mood, energy, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood-logs', user?.id] });
      setMood(0); setEnergy(0); setNotes('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const avgMood   = logs.length ? (logs.reduce((s, l) => s + l.mood, 0) / logs.length).toFixed(1) : null;
  const avgEnergy = logs.length ? (logs.reduce((s, l) => s + l.energy, 0) / logs.length).toFixed(1) : null;

  const last7 = logs.slice(0, 7).reverse();

  if (isLoading) return (
    <SafeAreaView style={s.safe}><ActivityIndicator color={colors.accent} style={{ flex: 1 }} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Mood & Energy" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} />}>

        {/* Today summary or log form */}
        {todayLog ? (
          <View style={s.todayCard}>
            <Text style={s.todayLabel}>TODAY'S LOG</Text>
            <View style={s.todayRow}>
              <View style={s.todayStat}>
                <Text style={s.todayEmoji}>{MOOD_EMOJIS[todayLog.mood]}</Text>
                <Text style={s.todayVal}>{MOOD_LABELS[todayLog.mood]}</Text>
                <Text style={s.todayStatLabel}>MOOD</Text>
              </View>
              <View style={s.todayDivider} />
              <View style={s.todayStat}>
                <Text style={s.todayEmoji}>{ENERGY_EMOJIS[todayLog.energy]}</Text>
                <Text style={s.todayVal}>{ENERGY_LABELS[todayLog.energy]}</Text>
                <Text style={s.todayStatLabel}>ENERGY</Text>
              </View>
            </View>
            {todayLog.notes ? <Text style={s.todayNotes}>"{todayLog.notes}"</Text> : null}
          </View>
        ) : (
          <View style={s.logCard}>
            <Text style={s.logTitle}>How are you feeling today?</Text>

            <Text style={s.pickerLabel}>Mood</Text>
            <View style={s.emojiRow}>
              {[1,2,3,4,5].map(v => (
                <TouchableOpacity key={v} style={[s.emojiBtn, mood === v && s.emojiBtnActive]} onPress={() => setMood(v)}>
                  <Text style={s.emoji}>{MOOD_EMOJIS[v]}</Text>
                  <Text style={[s.emojiLabel, mood === v && { color: colors.accent }]}>{MOOD_LABELS[v]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.pickerLabel}>Energy</Text>
            <View style={s.emojiRow}>
              {[1,2,3,4,5].map(v => (
                <TouchableOpacity key={v} style={[s.emojiBtn, energy === v && s.emojiBtnActive]} onPress={() => setEnergy(v)}>
                  <Text style={s.emoji}>{ENERGY_EMOJIS[v]}</Text>
                  <Text style={[s.emojiLabel, energy === v && { color: colors.accent }]}>{ENERGY_LABELS[v]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={s.notesInput}
              placeholder="Optional note..."
              placeholderTextColor={colors.textDim}
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={140}
            />

            <TouchableOpacity
              style={[s.saveBtn, (mood === 0 || energy === 0) && s.saveBtnDim]}
              onPress={() => save()}
              disabled={mood === 0 || energy === 0 || isPending}
            >
              {isPending
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.saveBtnText}>SAVE LOG</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* 7-day sparkline */}
        {last7.length > 1 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>LAST 7 DAYS</Text>
            <View style={s.chartRow}>
              {last7.map((l, i) => {
                const d = new Date(l.date + 'T00:00:00');
                const dow = ['Su','Mo','Tu','We','Th','Fr','Sa'][d.getDay()];
                return (
                  <View key={i} style={s.chartCol}>
                    <View style={s.chartBars}>
                      <View style={[s.chartBar, { height: l.mood * 10, backgroundColor: colors.accent }]} />
                      <View style={[s.chartBar, { height: l.energy * 10, backgroundColor: colors.purple ?? '#9d4edd' }]} />
                    </View>
                    <Text style={s.chartDow}>{dow}</Text>
                    <Text style={s.chartEmoji}>{MOOD_EMOJIS[l.mood]}</Text>
                  </View>
                );
              })}
            </View>
            <View style={s.legendRow}>
              <View style={[s.legendDot, { backgroundColor: colors.accent }]} />
              <Text style={s.legendText}>Mood</Text>
              <View style={[s.legendDot, { backgroundColor: colors.purple ?? '#9d4edd' }]} />
              <Text style={s.legendText}>Energy</Text>
            </View>
          </View>
        )}

        {/* Averages */}
        {logs.length > 0 && (
          <View style={s.avgRow}>
            <View style={s.avgCard}>
              <Text style={s.avgEmoji}>{avgMood ? MOOD_EMOJIS[Math.round(Number(avgMood))] : '—'}</Text>
              <Text style={[s.avgVal, { color: colors.accent }]}>{avgMood ?? '—'}</Text>
              <Text style={s.avgLabel}>AVG MOOD</Text>
              <Text style={s.avgSub}>last {logs.length} days</Text>
            </View>
            <View style={s.avgCard}>
              <Text style={s.avgEmoji}>{avgEnergy ? ENERGY_EMOJIS[Math.round(Number(avgEnergy))] : '—'}</Text>
              <Text style={[s.avgVal, { color: colors.purple ?? '#9d4edd' }]}>{avgEnergy ?? '—'}</Text>
              <Text style={s.avgLabel}>AVG ENERGY</Text>
              <Text style={s.avgSub}>last {logs.length} days</Text>
            </View>
          </View>
        )}

        {/* History list */}
        {logs.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>HISTORY</Text>
            {logs.map((l, i) => {
              const d = new Date(l.date + 'T00:00:00');
              const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              return (
                <View key={l.id} style={[s.histRow, i < logs.length - 1 && s.histRowBorder]}>
                  <Text style={s.histDate}>{label}</Text>
                  <View style={s.histRight}>
                    <Text style={s.histEmoji}>{MOOD_EMOJIS[l.mood]}</Text>
                    <Text style={s.histEmoji}>{ENERGY_EMOJIS[l.energy]}</Text>
                    <Text style={[s.histScore, { color: colors.accent }]}>{l.mood}/{l.energy}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {logs.length === 0 && !todayLog && (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>📊</Text>
            <Text style={s.emptyText}>Log your first mood above to start tracking trends</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 40, gap: 16 },
  todayCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1.5, borderColor: colors.accent + '60', padding: 20, gap: 12 },
  todayLabel: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  todayStat: { flex: 1, alignItems: 'center', gap: 4 },
  todayDivider: { width: 1, height: 60, backgroundColor: colors.border },
  todayEmoji: { fontSize: 32 },
  todayVal: { fontSize: 14, fontFamily: fontFamily.bodyBold, color: colors.text },
  todayStatLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 1 },
  todayNotes: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center' },
  logCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20, gap: 12 },
  logTitle: { fontSize: 16, fontFamily: fontFamily.bodyExtraBold, color: colors.text, textAlign: 'center' },
  pickerLabel: { fontSize: 11, fontFamily: fontFamily.bodyBold, color: colors.textMuted, letterSpacing: 1 },
  emojiRow: { flexDirection: 'row', gap: 6 },
  emojiBtn: { flex: 1, alignItems: 'center', padding: 8, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, gap: 4 },
  emojiBtnActive: { borderColor: colors.accent, backgroundColor: colors.accent + '18' },
  emoji: { fontSize: 22 },
  emojiLabel: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.3, textAlign: 'center' },
  notesInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, color: colors.text, fontFamily: fontFamily.body, fontSize: 13, minHeight: 44 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveBtnDim: { opacity: 0.4 },
  saveBtnText: { fontSize: 14, fontFamily: fontFamily.bodyExtraBold, color: '#000', letterSpacing: 1 },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
  cardTitle: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 80 },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  chartBars: { flexDirection: 'row', gap: 2, alignItems: 'flex-end', height: 50 },
  chartBar: { width: 6, borderRadius: 3, minHeight: 4 },
  chartDow: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim },
  chartEmoji: { fontSize: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.body },
  avgRow: { flexDirection: 'row', gap: 12 },
  avgCard: { flex: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, alignItems: 'center', gap: 4 },
  avgEmoji: { fontSize: 28 },
  avgVal: { fontSize: 28, fontFamily: fontFamily.monoBold },
  avgLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 1 },
  avgSub: { fontSize: 10, color: colors.textMuted, fontFamily: fontFamily.body },
  histRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  histRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  histDate: { fontSize: 13, color: colors.text, fontFamily: fontFamily.body },
  histRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  histEmoji: { fontSize: 18 },
  histScore: { fontSize: 13, fontFamily: fontFamily.monoBold, width: 36 },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
