import React, { useState, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, RefreshControl, ActivityIndicator, Alert, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import ScreenHeader from '../components/ScreenHeader';
import PaywallModal from '../components/ui/PaywallModal';

// ── Constants ─────────────────────────────────────────────────────────────────
const MOOD_EMOJIS   = ['', '😞', '😕', '😐', '🙂', '😄'];
const ENERGY_EMOJIS = ['', '🪫', '😴', '⚡', '🔋', '🚀'];
const MOOD_LABELS   = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Great'];
const ENERGY_LABELS = ['', 'Drained', 'Low', 'Moderate', 'High', 'Peak'];
const MOOD_COLORS   = ['', '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399'];
const DOW_SHORT     = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Pure helpers ──────────────────────────────────────────────────────────────
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calcStreak(logs) {
  if (!logs || logs.length === 0) return 0;
  const today = localDateStr(new Date());
  const loggedDates = new Set(logs.map(l => l.date));
  let streak = 0;
  const cursor = new Date();
  // If today not logged, start from yesterday
  if (!loggedDates.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (true) {
    const ds = localDateStr(cursor);
    if (!loggedDates.has(ds)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function moodSleepCorr(logs, sleep) {
  if (!logs.length || !sleep.length) return null;
  // Map sleep by date (YYYY-MM-DD)
  const sleepByDate = {};
  sleep.forEach(s => {
    const ds = localDateStr(new Date(s.logged_at));
    sleepByDate[ds] = s.hours;
  });
  const buckets = {
    poor: { sum: 0, n: 0, label: '< 6h' },
    ok:   { sum: 0, n: 0, label: '6–7h' },
    good: { sum: 0, n: 0, label: '7h+' },
  };
  logs.forEach(l => {
    const h = sleepByDate[l.date];
    if (h == null) return;
    if (h < 6)      { buckets.poor.sum += l.mood; buckets.poor.n++; }
    else if (h < 7) { buckets.ok.sum   += l.mood; buckets.ok.n++;   }
    else            { buckets.good.sum += l.mood; buckets.good.n++; }
  });
  const fmt = b => ({ avg: b.n ? (b.sum / b.n).toFixed(1) : null, n: b.n, label: b.label });
  return { poor: fmt(buckets.poor), ok: fmt(buckets.ok), good: fmt(buckets.good) };
}

function moodWorkoutCorr(logs, workouts) {
  if (!logs.length) return null;
  const workoutDates = new Set((workouts || []).map(w => w.date));
  let gymSum = 0, gymN = 0, restSum = 0, restN = 0;
  logs.forEach(l => {
    if (workoutDates.has(l.date)) { gymSum += l.mood; gymN++; }
    else { restSum += l.mood; restN++; }
  });
  return {
    gym:  { avg: gymN  ? (gymSum  / gymN).toFixed(1)  : null, n: gymN  },
    rest: { avg: restN ? (restSum / restN).toFixed(1) : null, n: restN },
  };
}

function moodStepsCorr(logs, steps) {
  if (!logs.length || !steps.length) return null;
  const stepsByDate = {};
  steps.forEach(s => {
    const ds = localDateStr(new Date(s.logged_at));
    stepsByDate[ds] = { steps: s.steps, goal: s.goal };
  });
  let highSum = 0, highN = 0, lowSum = 0, lowN = 0;
  logs.forEach(l => {
    const entry = stepsByDate[l.date];
    if (!entry) return;
    if (entry.steps >= (entry.goal || 10000)) { highSum += l.mood; highN++; }
    else { lowSum += l.mood; lowN++; }
  });
  return {
    high: { avg: highN ? (highSum / highN).toFixed(1) : null, n: highN, label: 'Goal hit' },
    low:  { avg: lowN  ? (lowSum  / lowN).toFixed(1)  : null, n: lowN,  label: 'Below goal' },
  };
}

function dowPattern(logs) {
  const buckets = Array.from({ length: 7 }, (_, i) => ({ dow: i, sum: 0, n: 0 }));
  logs.forEach(l => {
    const d = new Date(l.date + 'T00:00:00');
    const dow = d.getDay();
    buckets[dow].sum += l.mood;
    buckets[dow].n++;
  });
  return buckets.map(b => ({ dow: b.dow, avg: b.n ? b.sum / b.n : null, n: b.n }));
}

// ── Data fetcher ──────────────────────────────────────────────────────────────
async function fetchMoodData(userId) {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = localDateStr(since);

  const [moodRes, sleepRes, workoutRes, stepRes] = await Promise.all([
    supabase
      .from('mood_logs')
      .select('id, date, mood, energy, notes, logged_at')
      .eq('user_id', userId)
      .gte('date', sinceStr)
      .order('date', { ascending: false }),
    supabase
      .from('sleep_logs')
      .select('hours, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', since.toISOString())
      .order('logged_at', { ascending: false }),
    supabase
      .from('workout_sessions')
      .select('date')
      .eq('user_id', userId)
      .gte('date', sinceStr),
    supabase
      .from('step_logs')
      .select('steps, goal, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', since.toISOString())
      .order('logged_at', { ascending: false }),
  ]);

  if (moodRes.error)    throw moodRes.error;
  if (sleepRes.error)   throw sleepRes.error;
  if (workoutRes.error) throw workoutRes.error;
  if (stepRes.error)    throw stepRes.error;

  return {
    logs:     moodRes.data    ?? [],
    sleep:    sleepRes.data   ?? [],
    workouts: workoutRes.data ?? [],
    steps:    stepRes.data    ?? [],
  };
}

async function upsertMoodLog(userId, { date, mood, energy, notes }) {
  const { error } = await supabase
    .from('mood_logs')
    .upsert({ user_id: userId, date, mood, energy, notes: notes || null },
      { onConflict: 'user_id,date' });
  if (error) throw error;
}


// ── EditModal ─────────────────────────────────────────────────────────────────
function EditModal({ visible, log, colors, onClose, onSave, isPending }) {
  const s = useMemo(() => styles(colors), [colors]);
  const [mood, setMood]     = useState(log?.mood ?? 0);
  const [energy, setEnergy] = useState(log?.energy ?? 0);
  const [notes, setNotes]   = useState(log?.notes ?? '');

  React.useEffect(() => {
    if (log) { setMood(log.mood); setEnergy(log.energy); setNotes(log.notes ?? ''); }
  }, [log?.id]);

  if (!log) return null;

  const d = new Date(log.date + 'T00:00:00');
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalBox}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Edit · {label}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={s.pickerLabel}>Mood</Text>
          <View style={s.emojiRow}>
            {[1,2,3,4,5].map(v => (
              <TouchableOpacity key={v} style={[s.emojiBtn, mood === v && s.emojiBtnActive]} onPress={() => setMood(v)}>
                <Text style={s.emoji}>{MOOD_EMOJIS[v]}</Text>
                <Text style={[s.emojiLabel, mood === v && { color: colors.accent }]}>{MOOD_LABELS[v]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[s.pickerLabel, { marginTop: 4 }]}>Energy</Text>
          <View style={s.emojiRow}>
            {[1,2,3,4,5].map(v => (
              <TouchableOpacity key={v} style={[s.emojiBtn, energy === v && s.emojiBtnActive]} onPress={() => setEnergy(v)}>
                <Text style={s.emoji}>{ENERGY_EMOJIS[v]}</Text>
                <Text style={[s.emojiLabel, energy === v && { color: colors.accent }]}>{ENERGY_LABELS[v]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            style={[s.notesInput, { marginTop: 8 }]}
            placeholder="Optional note..."
            placeholderTextColor={colors.textDim}
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={140}
          />

          <TouchableOpacity
            style={[s.saveBtn, { marginTop: 14 }, (mood === 0 || energy === 0) && s.saveBtnDim]}
            onPress={() => onSave({ date: log.date, mood, energy, notes })}
            disabled={mood === 0 || energy === 0 || isPending}
          >
            {isPending
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={s.saveBtnText}>SAVE CHANGES</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function MoodLogScreen({ navigation }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { hasAccess } = useSubscription();
  const qc = useQueryClient();
  const s = useMemo(() => styles(colors), [colors]);

  const today = localDateStr(new Date());
  const [mood, setMood]         = useState(0);
  const [energy, setEnergy]     = useState(0);
  const [notes, setNotes]       = useState('');
  const [editLog, setEditLog]   = useState(null);
  const [search, setSearch]     = useState('');
  const scrollRef = useRef(null);
  const [paywallVisible, setPaywallVisible] = useState(false);

  const { data = { logs: [], sleep: [], workouts: [], steps: [] }, isLoading, refetch } = useQuery({
    queryKey: ['mood-data', user?.id],
    queryFn: () => fetchMoodData(user?.id),
    enabled: !!user?.id,
    staleTime: 0, gcTime: 0,
  });

  const { logs, sleep, workouts, steps } = data;

  const todayLog = useMemo(() => logs.find(l => l.date === today), [logs, today]);

  const { mutate: save, isPending: savePending } = useMutation({
    mutationFn: () => upsertMoodLog(user.id, { date: today, mood, energy, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood-data', user?.id] });
      setMood(0); setEnergy(0); setNotes('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const { mutate: editSave, isPending: editPending } = useMutation({
    mutationFn: (payload) => upsertMoodLog(user.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood-data', user?.id] });
      setEditLog(null);
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  // ── Derived data ─────────────────────────────────────────────────────────────
  const streak   = useMemo(() => calcStreak(logs), [logs]);
  const avgMood   = logs.length ? (logs.reduce((acc, l) => acc + l.mood,   0) / logs.length).toFixed(1) : null;
  const avgEnergy = logs.length ? (logs.reduce((acc, l) => acc + l.energy, 0) / logs.length).toFixed(1) : null;

  const last7 = useMemo(() => logs.slice(0, 7).reverse(), [logs]);

  // Low mood alert: last 3 logs all mood ≤ 3
  const lowMoodAlert = useMemo(() => {
    if (logs.length < 3) return false;
    return logs.slice(0, 3).every(l => l.mood <= 3);
  }, [logs]);

  // Energy prediction from last sleep
  const energyPrediction = useMemo(() => {
    if (todayLog || !sleep.length) return null;
    const lastH = sleep[0].hours;
    if (lastH >= 7.5)      return { label: '🚀 Peak Energy',     color: '#34d399' };
    else if (lastH >= 6.5) return { label: '⚡ Moderate Energy', color: '#a3e635' };
    else if (lastH >= 5.5) return { label: '🔋 Low Energy',      color: '#fbbf24' };
    else                   return { label: '🪫 Very Low',         color: '#f87171' };
  }, [todayLog, sleep]);

  // Weekly summary (this week Mon-today)
  const weeklySummary = useMemo(() => {
    if (!logs.length) return null;
    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - ((dow + 6) % 7)); // Monday
    const weekStartStr = localDateStr(weekStart);
    const thisWeekLogs = logs.filter(l => l.date >= weekStartStr && l.date <= today);
    if (!thisWeekLogs.length) return null;
    const avg = (thisWeekLogs.reduce((a, l) => a + l.mood, 0) / thisWeekLogs.length).toFixed(1);
    const best  = thisWeekLogs.reduce((a, b) => b.mood  >= a.mood  ? b : a, thisWeekLogs[0]);
    const worst = thisWeekLogs.reduce((a, b) => b.mood  <= a.mood  ? b : a, thisWeekLogs[0]);
    const bestDow  = DOW_SHORT[new Date(best.date  + 'T00:00:00').getDay()];
    const worstDow = DOW_SHORT[new Date(worst.date + 'T00:00:00').getDay()];
    return { avg, daysLogged: thisWeekLogs.length, best, bestDow, worst, worstDow };
  }, [logs, today]);

  // 28-day heatmap
  const heatmapDays = useMemo(() => {
    const logByDate = {};
    logs.forEach(l => { logByDate[l.date] = l; });
    const days = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = localDateStr(d);
      days.push({ date: ds, log: logByDate[ds] ?? null, isToday: ds === today });
    }
    return days;
  }, [logs, today]);

  // Day-of-week pattern
  const dowData = useMemo(() => dowPattern(logs), [logs]);

  // Correlations
  const sleepCorr   = useMemo(() => moodSleepCorr(logs, sleep),       [logs, sleep]);
  const workoutCorr = useMemo(() => moodWorkoutCorr(logs, workouts),   [logs, workouts]);
  const stepsCorr   = useMemo(() => moodStepsCorr(logs, steps),        [logs, steps]);

  // Filtered history
  const filteredLogs = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter(l => {
      if (l.notes?.toLowerCase().includes(q)) return true;
      if (MOOD_LABELS[l.mood]?.toLowerCase().includes(q))   return true;
      if (ENERGY_LABELS[l.energy]?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [logs, search]);

  // ── Correlation insight text ──────────────────────────────────────────────────
  function sleepInsight(corr) {
    if (!corr) return '';
    const good = parseFloat(corr.good.avg);
    const poor = parseFloat(corr.poor.avg);
    if (isNaN(good) || isNaN(poor)) return 'Log more data to see insights.';
    const diff = (good - poor).toFixed(1);
    if (diff > 0) return `Mood is ${diff} pts higher on 7h+ sleep nights.`;
    return 'Sleep duration shows minimal impact on mood in your data.';
  }

  function workoutInsight(corr) {
    if (!corr) return '';
    const gym  = parseFloat(corr.gym.avg);
    const rest = parseFloat(corr.rest.avg);
    if (isNaN(gym) || isNaN(rest)) return 'Log more data to see insights.';
    const diff = (gym - rest).toFixed(1);
    if (diff > 0) return `Mood is ${diff} pts higher on workout days.`;
    if (diff < 0) return `Rest days show ${Math.abs(diff)} pts higher mood.`;
    return 'No significant mood difference between workout and rest days.';
  }

  function stepsInsight(corr) {
    if (!corr) return '';
    const high = parseFloat(corr.high.avg);
    const low  = parseFloat(corr.low.avg);
    if (isNaN(high) || isNaN(low)) return 'Log more data to see insights.';
    const diff = (high - low).toFixed(1);
    if (diff > 0) return `Hitting your step goal correlates with ${diff} pts higher mood.`;
    return 'Step goal completion shows minimal mood impact in your data.';
  }

  if (isLoading) return (
    <SafeAreaView style={s.safe}><ActivityIndicator color={colors.accent} style={{ flex: 1 }} /></SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScreenHeader title="Mood & Energy" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} />}
        keyboardShouldPersistTaps="handled"
      >

        {/* 1. Low mood alert */}
        {lowMoodAlert && (
          <View style={s.alertBanner}>
            <Ionicons name="warning" size={16} color="#f87171" />
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={s.alertTitle}>Low mood detected · 3+ days</Text>
              <Text style={s.alertSub}>Consider rest or talking to someone.</Text>
            </View>
          </View>
        )}

        {/* 2. Energy prediction */}
        {energyPrediction && (
          <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
            <Ionicons name="bed-outline" size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>TODAY'S PREDICTED ENERGY</Text>
              <Text style={[s.energyPredText, { color: energyPrediction.color }]}>{energyPrediction.label}</Text>
            </View>
            <Text style={s.energyPredSub}>Based on last night's sleep</Text>
          </View>
        )}

        {/* 3. Today card / Log form */}
        {todayLog ? (
          <View style={s.todayCard}>
            <View style={s.todayTopRow}>
              <Text style={s.todayLabel}>TODAY'S LOG</Text>
              <TouchableOpacity
                style={s.editBtn}
                onPress={() => setEditLog(todayLog)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil" size={13} color={colors.accent} />
                <Text style={s.editBtnText}>Edit</Text>
              </TouchableOpacity>
            </View>
            <View style={s.todayRow}>
              <View style={s.todayStat}>
                <Text style={s.todayEmoji}>{MOOD_EMOJIS[todayLog.mood]}</Text>
                <View style={s.todayStatRight}>
                  <Text style={s.todayVal}>{MOOD_LABELS[todayLog.mood]}</Text>
                  <Text style={s.todayStatLabel}>MOOD</Text>
                </View>
              </View>
              <View style={s.todayDivider} />
              <View style={s.todayStat}>
                <Text style={s.todayEmoji}>{ENERGY_EMOJIS[todayLog.energy]}</Text>
                <View style={s.todayStatRight}>
                  <Text style={s.todayVal}>{ENERGY_LABELS[todayLog.energy]}</Text>
                  <Text style={s.todayStatLabel}>ENERGY</Text>
                </View>
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
              disabled={mood === 0 || energy === 0 || savePending}
            >
              {savePending
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={s.saveBtnText}>SAVE LOG</Text>
              }
            </TouchableOpacity>
          </View>
        )}

        {/* 4. Stats row */}
        {logs.length > 0 && (
          <View style={s.statsRow}>
            <View style={s.statTile}>
              <Text style={s.statTileEmoji}>🔥</Text>
              <Text style={[s.statTileVal, { color: colors.accent }]}>{streak}</Text>
              <Text style={s.statTileLabel}>Streak</Text>
            </View>
            <View style={s.statTile}>
              <Text style={s.statTileEmoji}>{avgMood ? MOOD_EMOJIS[Math.round(Number(avgMood))] : '—'}</Text>
              <Text style={[s.statTileVal, { color: colors.accent }]}>{avgMood ?? '—'}</Text>
              <Text style={s.statTileLabel}>Avg Mood</Text>
            </View>
            <View style={s.statTile}>
              <Text style={s.statTileEmoji}>{avgEnergy ? ENERGY_EMOJIS[Math.round(Number(avgEnergy))] : '—'}</Text>
              <Text style={[s.statTileVal, { color: colors.purple ?? '#9d4edd' }]}>{avgEnergy ?? '—'}</Text>
              <Text style={s.statTileLabel}>Avg Energy</Text>
            </View>
            <View style={s.statTile}>
              <Text style={s.statTileEmoji}>📋</Text>
              <Text style={[s.statTileVal, { color: colors.text }]}>{logs.length}</Text>
              <Text style={s.statTileLabel}>Logged</Text>
            </View>
          </View>
        )}

        {/* 5. [PRO] Weekly mood summary */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>THIS WEEK</Text>
            <View style={{ backgroundColor: colors.accent, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 8, fontWeight: '800', color: '#000', letterSpacing: 1 }}>PRO</Text>
            </View>
          </View>
          {hasAccess && weeklySummary ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <View style={s.weekSummaryTile}>
                <Text style={s.weekSummaryVal}>{weeklySummary.avg}</Text>
                <Text style={s.weekSummaryLabel}>Avg mood</Text>
              </View>
              <View style={s.weekSummaryTile}>
                <Text style={s.weekSummaryEmoji}>{MOOD_EMOJIS[weeklySummary.best.mood]}</Text>
                <Text style={s.weekSummaryLabel}>Best · {weeklySummary.bestDow}</Text>
              </View>
              <View style={s.weekSummaryTile}>
                <Text style={s.weekSummaryEmoji}>{MOOD_EMOJIS[weeklySummary.worst.mood]}</Text>
                <Text style={s.weekSummaryLabel}>Worst · {weeklySummary.worstDow}</Text>
              </View>
              <View style={s.weekSummaryTile}>
                <Text style={s.weekSummaryVal}>{weeklySummary.daysLogged}/7</Text>
                <Text style={s.weekSummaryLabel}>Days logged</Text>
              </View>
            </View>
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setPaywallVisible(true)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <View style={s.weekSummaryTile}>
                  <Text style={s.weekSummaryVal}>●.●</Text>
                  <Text style={s.weekSummaryLabel}>Avg mood</Text>
                </View>
                <View style={s.weekSummaryTile}>
                  <Text style={s.weekSummaryEmoji}>😐</Text>
                  <Text style={s.weekSummaryLabel}>Best · ●●●</Text>
                </View>
                <View style={s.weekSummaryTile}>
                  <Text style={s.weekSummaryEmoji}>😐</Text>
                  <Text style={s.weekSummaryLabel}>Worst · ●●●</Text>
                </View>
                <View style={s.weekSummaryTile}>
                  <Text style={s.weekSummaryVal}>●/7</Text>
                  <Text style={s.weekSummaryLabel}>Days logged</Text>
                </View>
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock weekly summary with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 6. 28-day mood heatmap */}
        {logs.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>28-DAY MOOD HEATMAP</Text>
            <View style={s.heatmapGrid}>
              {heatmapDays.map((item, idx) => (
                <View
                  key={idx}
                  style={[
                    s.heatCell,
                    item.log
                      ? { backgroundColor: MOOD_COLORS[item.log.mood] + 'cc' }
                      : { backgroundColor: colors.dim ?? colors.border + '60' },
                    item.isToday && { borderWidth: 2, borderColor: colors.accent },
                  ]}
                >
                  {item.log ? (
                    <Text style={s.heatEmoji}>{MOOD_EMOJIS[item.log.mood]}</Text>
                  ) : null}
                </View>
              ))}
            </View>
            {/* Legend */}
            <View style={s.heatLegend}>
              {[1,2,3,4,5].map(v => (
                <View key={v} style={s.heatLegendItem}>
                  <View style={[s.heatLegendDot, { backgroundColor: MOOD_COLORS[v] }]} />
                  <Text style={s.heatLegendText}>{MOOD_LABELS[v]}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 7. 7-day bar chart */}
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

        {/* 8. Day-of-week pattern */}
        {logs.length >= 7 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>DAY-OF-WEEK PATTERN</Text>
            <View style={s.dowChartRow}>
              {dowData.map((item, idx) => {
                const barH = item.avg ? (item.avg / 5) * 56 : 0;
                const colorIdx = item.avg ? Math.round(item.avg) : 0;
                const barColor = colorIdx ? MOOD_COLORS[colorIdx] : (colors.dim ?? colors.border);
                return (
                  <View key={idx} style={s.dowChartCol}>
                    {item.avg !== null ? (
                      <Text style={[s.dowAvgLabel, { color: barColor }]}>{item.avg.toFixed(1)}</Text>
                    ) : (
                      <Text style={s.dowAvgLabel}> </Text>
                    )}
                    <View style={s.dowBarTrack}>
                      <View style={[s.dowBar, { height: barH, backgroundColor: barColor }]} />
                    </View>
                    <Text style={s.dowDayLabel}>{DOW_SHORT[item.dow]}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* 9. [PRO] Mood × Sleep correlation */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>MOOD × SLEEP</Text>
            <View style={{ backgroundColor: colors.accent, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 8, fontWeight: '800', color: '#000', letterSpacing: 1 }}>PRO</Text>
            </View>
          </View>
          {hasAccess && sleepCorr ? (
            <>
              <View style={s.corrTileRow}>
                {[sleepCorr.poor, sleepCorr.ok, sleepCorr.good].map((bucket, i) => {
                  const val = bucket.avg ? parseFloat(bucket.avg) : null;
                  const c = val ? MOOD_COLORS[Math.round(val)] : colors.textDim;
                  return (
                    <View key={i} style={s.corrTile}>
                      <Text style={s.corrTileLabel}>{bucket.label}</Text>
                      <Text style={[s.corrTileVal, { color: c }]}>{bucket.avg ?? '—'}</Text>
                      <Text style={s.corrTileN}>{bucket.n} days</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={s.corrInsight}>{sleepInsight(sleepCorr)}</Text>
            </>
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setPaywallVisible(true)}>
              <View style={s.corrTileRow}>
                {['Poor sleep', 'OK sleep', 'Good sleep'].map((label, i) => (
                  <View key={i} style={s.corrTile}>
                    <Text style={s.corrTileLabel}>{label}</Text>
                    <Text style={[s.corrTileVal, { color: colors.textDim }]}>●.●</Text>
                    <Text style={s.corrTileN}>●● days</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock mood × sleep correlation with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 10. [PRO] Mood × Workout correlation */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>MOOD × WORKOUT</Text>
            <View style={{ backgroundColor: colors.accent, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 8, fontWeight: '800', color: '#000', letterSpacing: 1 }}>PRO</Text>
            </View>
          </View>
          {hasAccess && workoutCorr ? (
            <>
              <View style={s.corrTileRow}>
                {[
                  { ...workoutCorr.gym,  label: 'Workout days' },
                  { ...workoutCorr.rest, label: 'Rest days'    },
                ].map((bucket, i) => {
                  const val = bucket.avg ? parseFloat(bucket.avg) : null;
                  const c = val ? MOOD_COLORS[Math.round(val)] : colors.textDim;
                  return (
                    <View key={i} style={[s.corrTile, { flex: 1 }]}>
                      <Text style={s.corrTileLabel}>{bucket.label}</Text>
                      <Text style={[s.corrTileVal, { color: c }]}>{bucket.avg ?? '—'}</Text>
                      <Text style={s.corrTileN}>{bucket.n} days</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={s.corrInsight}>{workoutInsight(workoutCorr)}</Text>
            </>
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setPaywallVisible(true)}>
              <View style={s.corrTileRow}>
                {['Workout days', 'Rest days'].map((label, i) => (
                  <View key={i} style={[s.corrTile, { flex: 1 }]}>
                    <Text style={s.corrTileLabel}>{label}</Text>
                    <Text style={[s.corrTileVal, { color: colors.textDim }]}>●.●</Text>
                    <Text style={s.corrTileN}>●● days</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock mood × workout correlation with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 11. [PRO] Mood × Steps correlation */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={s.cardTitle}>MOOD × STEPS</Text>
            <View style={{ backgroundColor: colors.accent, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 8, fontWeight: '800', color: '#000', letterSpacing: 1 }}>PRO</Text>
            </View>
          </View>
          {hasAccess && stepsCorr ? (
            <>
              <View style={s.corrTileRow}>
                {[stepsCorr.high, stepsCorr.low].map((bucket, i) => {
                  const val = bucket.avg ? parseFloat(bucket.avg) : null;
                  const c = val ? MOOD_COLORS[Math.round(val)] : colors.textDim;
                  return (
                    <View key={i} style={[s.corrTile, { flex: 1 }]}>
                      <Text style={s.corrTileLabel}>{bucket.label}</Text>
                      <Text style={[s.corrTileVal, { color: c }]}>{bucket.avg ?? '—'}</Text>
                      <Text style={s.corrTileN}>{bucket.n} days</Text>
                    </View>
                  );
                })}
              </View>
              <Text style={s.corrInsight}>{stepsInsight(stepsCorr)}</Text>
            </>
          ) : (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setPaywallVisible(true)}>
              <View style={s.corrTileRow}>
                {['High steps', 'Low steps'].map((label, i) => (
                  <View key={i} style={[s.corrTile, { flex: 1 }]}>
                    <Text style={s.corrTileLabel}>{label}</Text>
                    <Text style={[s.corrTileVal, { color: colors.textDim }]}>●.●</Text>
                    <Text style={s.corrTileN}>●● days</Text>
                  </View>
                ))}
              </View>
              <Text style={[s.emptyText, { paddingTop: 8, paddingBottom: 0 }]}>🔒 Unlock mood × steps correlation with Pro.</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 12. History with search */}
        {logs.length > 0 && (
          <View style={s.card}>
            <Text style={s.cardTitle}>HISTORY · TAP TO EDIT</Text>
            <TextInput
              style={s.searchInput}
              placeholder="Search by mood, energy, notes..."
              placeholderTextColor={colors.textDim}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150)}
            />
            {filteredLogs.length === 0 ? (
              <Text style={s.noResults}>No entries match your search.</Text>
            ) : (
              filteredLogs.map((l, i) => {
                const d = new Date(l.date + 'T00:00:00');
                const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={[s.histRow, i < filteredLogs.length - 1 && s.histRowBorder]}
                    onPress={() => setEditLog(l)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={s.histDate}>{label}</Text>
                      {l.notes ? (
                        <Text style={s.histNotes} numberOfLines={1}>{l.notes}</Text>
                      ) : null}
                    </View>
                    <View style={s.histRight}>
                      <Text style={s.histEmoji}>{MOOD_EMOJIS[l.mood]}</Text>
                      <Text style={s.histEmoji}>{ENERGY_EMOJIS[l.energy]}</Text>
                      <Text style={[s.histScore, { color: colors.accent }]}>{l.mood}/{l.energy}</Text>
                      <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {logs.length === 0 && !todayLog && (
          <View style={s.emptyBox}>
            <Text style={s.emptyIcon}>📊</Text>
            <Text style={s.emptyText}>Log your first mood above to start tracking trends</Text>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      <EditModal
        visible={!!editLog}
        log={editLog}
        colors={colors}
        onClose={() => setEditLog(null)}
        onSave={editSave}
        isPending={editPending}
      />

      <PaywallModal
        visible={paywallVisible}
        onClose={() => setPaywallVisible(false)}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 14, paddingBottom: 40, gap: 12 },

  // Alert banner
  alertBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#f8717120', borderRadius: 12,
    borderWidth: 1, borderColor: '#f87171',
    padding: 12,
  },
  alertTitle: { fontSize: 13, fontFamily: fontFamily.bodyBold, color: '#f87171' },
  alertSub:   { fontSize: 11, fontFamily: fontFamily.body, color: colors.textMuted },

  // Energy prediction
  energyPredText: { fontSize: 16, fontFamily: fontFamily.bodyBold, marginTop: 2 },
  energyPredSub:  { fontSize: 10, fontFamily: fontFamily.body, color: colors.textMuted, flexShrink: 1, textAlign: 'right' },

  // Today card
  todayCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1.5, borderColor: colors.accent + '60', padding: 14, gap: 10 },
  todayTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  todayLabel: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accent + '18', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  editBtnText: { fontSize: 11, fontFamily: fontFamily.bodyBold, color: colors.accent },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  todayStat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayStatRight: { gap: 2 },
  todayDivider: { width: 1, height: 44, backgroundColor: colors.border },
  todayEmoji: { fontSize: 26 },
  todayVal: { fontSize: 14, fontFamily: fontFamily.bodyBold, color: colors.text },
  todayStatLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 1 },
  todayNotes: { fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.body, fontStyle: 'italic' },

  // Log form card
  logCard: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  logTitle: { fontSize: 15, fontFamily: fontFamily.bodyExtraBold, color: colors.text, textAlign: 'center' },
  pickerLabel: { fontSize: 11, fontFamily: fontFamily.bodyBold, color: colors.textMuted, letterSpacing: 1 },
  emojiRow: { flexDirection: 'row', gap: 5 },
  emojiBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, gap: 3 },
  emojiBtnActive: { borderColor: colors.accent, backgroundColor: colors.accent + '18' },
  emoji: { fontSize: 20 },
  emojiLabel: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.3, textAlign: 'center' },
  notesInput: { backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 9, color: colors.text, fontFamily: fontFamily.body, fontSize: 13, minHeight: 40 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  saveBtnDim: { opacity: 0.4 },
  saveBtnText: { fontSize: 14, fontFamily: fontFamily.bodyExtraBold, color: '#000', letterSpacing: 1 },

  // Stats row
  statsRow: { flexDirection: 'row', gap: 8 },
  statTile: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10, alignItems: 'center', gap: 3 },
  statTileEmoji: { fontSize: 18 },
  statTileVal: { fontSize: 16, fontFamily: fontFamily.monoBold },
  statTileLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.5, textAlign: 'center' },

  // Weekly summary
  weekSummaryTile: { flex: 1, backgroundColor: colors.dim ?? colors.border + '40', borderRadius: 10, padding: 10, alignItems: 'center', gap: 2, minWidth: 60 },
  weekSummaryVal: { fontSize: 18, fontFamily: fontFamily.monoBold, color: colors.text },
  weekSummaryEmoji: { fontSize: 22 },
  weekSummaryLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.4, textAlign: 'center' },

  // Generic card
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 10 },
  cardTitle: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.accent, letterSpacing: 1.5 },

  // Heatmap
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  heatCell: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  heatEmoji: { fontSize: 16 },
  heatLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heatLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heatLegendDot: { width: 10, height: 10, borderRadius: 3 },
  heatLegendText: { fontSize: 10, fontFamily: fontFamily.body, color: colors.textMuted },

  // 7-day bar chart
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 80 },
  chartCol: { flex: 1, alignItems: 'center', gap: 4 },
  chartBars: { flexDirection: 'row', gap: 2, alignItems: 'flex-end', height: 50 },
  chartBar: { width: 6, borderRadius: 3, minHeight: 4 },
  chartDow: { fontSize: 8, fontFamily: fontFamily.bodyBold, color: colors.textDim },
  chartEmoji: { fontSize: 12 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.body },

  // Day-of-week pattern
  dowChartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  dowChartCol: { flex: 1, alignItems: 'center', gap: 4 },
  dowAvgLabel: { fontSize: 9, fontFamily: fontFamily.monoBold, color: colors.textDim },
  dowBarTrack: { height: 60, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  dowBar: { width: '70%', borderRadius: 4, minHeight: 3 },
  dowDayLabel: { fontSize: 9, fontFamily: fontFamily.bodyBold, color: colors.textMuted },

  // Correlation tiles
  corrTileRow: { flexDirection: 'row', gap: 8 },
  corrTile: { flex: 1, backgroundColor: colors.dim ?? colors.border + '40', borderRadius: 10, padding: 10, alignItems: 'center', gap: 3 },
  corrTileLabel: { fontSize: 10, fontFamily: fontFamily.bodyBold, color: colors.textDim, letterSpacing: 0.3, textAlign: 'center' },
  corrTileVal: { fontSize: 20, fontFamily: fontFamily.monoBold },
  corrTileN: { fontSize: 9, fontFamily: fontFamily.body, color: colors.textMuted },
  corrInsight: { fontSize: 11, fontFamily: fontFamily.body, color: colors.textMuted, lineHeight: 16 },

  // Search
  searchInput: {
    backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, padding: 9, color: colors.text,
    fontFamily: fontFamily.body, fontSize: 13,
  },
  noResults: { fontSize: 12, color: colors.textMuted, fontFamily: fontFamily.body, textAlign: 'center', paddingVertical: 8 },

  // History
  histRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 8 },
  histRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  histDate: { fontSize: 13, color: colors.text, fontFamily: fontFamily.bodyBold },
  histNotes: { fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.body },
  histRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  histEmoji: { fontSize: 18 },
  histScore: { fontSize: 13, fontFamily: fontFamily.monoBold, width: 36 },

  // Empty state
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 32 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: fontFamily.body, textAlign: 'center', lineHeight: 20 },

  // Edit modal
  modalOverlay: { flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, gap: 12 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { fontSize: 14, fontFamily: fontFamily.bodyExtraBold, color: colors.text },
});
