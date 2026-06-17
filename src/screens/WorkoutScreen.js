import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable,
  TextInput, Alert, ActivityIndicator, RefreshControl,
  Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { typography, weight } from '../theme/typography';

// ─── Data Layer ───────────────────────────────────────────────────────────────
async function fetchSessions(userId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`
      id, date, notes, total_volume, duration_min, calories_burned,
      workout_exercises (
        id, exercise_name, order_index,
        sets ( id, set_number, weight_kg, reps, rpe )
      )
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(150);
  if (error) throw error;
  return data ?? [];
}

async function saveSession(userId, { sessionId, date, name, exercises }) {
  let sid = sessionId;
  if (!sid) {
    const { data, error } = await supabase
      .from('workout_sessions')
      .insert({ user_id: userId, date, notes: name || 'Workout' })
      .select().single();
    if (error) throw error;
    sid = data.id;
  } else {
    const { error } = await supabase
      .from('workout_sessions')
      .update({ date, notes: name || 'Workout' })
      .eq('id', sid);
    if (error) throw error;
  }

  // Delete old exercises + sets
  const { data: existingEx } = await supabase
    .from('workout_exercises').select('id').eq('session_id', sid);
  const exIds = (existingEx ?? []).map(e => e.id);
  if (exIds.length > 0) {
    await supabase.from('sets').delete().in('exercise_id', exIds);
    await supabase.from('workout_exercises').delete().eq('session_id', sid);
  }

  // Insert new exercises + sets
  let totalVol = 0;
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    if (!ex.name.trim()) continue;
    const { data: newEx, error: exErr } = await supabase
      .from('workout_exercises')
      .insert({ session_id: sid, exercise_name: ex.name.trim(), order_index: i })
      .select().single();
    if (exErr) throw exErr;

    for (let j = 0; j < (ex.sets ?? []).length; j++) {
      const s = ex.sets[j];
      const w = parseFloat(s.weight_kg);
      const r = parseInt(s.reps, 10);
      const wVal = isNaN(w) ? null : w;
      const rVal = isNaN(r) ? null : r;
      if (wVal !== null || rVal !== null) {
        if (wVal && rVal) totalVol += wVal * rVal;
        await supabase.from('sets').insert({
          exercise_id: newEx.id, set_number: j + 1,
          weight_kg: wVal, reps: rVal, rpe: null,
        });
      }
    }
  }
  await supabase.from('workout_sessions')
    .update({ total_volume: Math.round(totalVol) }).eq('id', sid);
}

async function deleteFullSession(sessionId) {
  const { data: exs } = await supabase
    .from('workout_exercises').select('id').eq('session_id', sessionId);
  const exIds = (exs ?? []).map(e => e.id);
  if (exIds.length > 0) {
    await supabase.from('sets').delete().in('exercise_id', exIds);
    await supabase.from('workout_exercises').delete().eq('session_id', sessionId);
  }
  const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Returns { icon, cardBg, cardBorder, iconBg, titleColor }
function getWorkoutStyle(name) {
  if (!name) return { icon: '🏋️', cardBg: colors.bgCard, cardBorder: '#404020', iconBg: '#1a1a00', titleColor: colors.text };
  const n = name.toLowerCase().trim();

  if (n === 'rest' || n === 'rest day' || n.startsWith('rest'))
    return { icon: '😴', cardBg: '#001a14', cardBorder: '#006650', iconBg: '#002a1e', titleColor: '#00cc99' };

  if (n.includes('cardio') || n.includes('run') || n.includes('treadmill') ||
      n.includes('cycling') || n.includes('hiit') || n.includes('swim'))
    return { icon: '🏃', cardBg: '#080d1f', cardBorder: '#1e3a8a', iconBg: '#0a1230', titleColor: '#60a5fa' };

  if (n.includes('stair') || n.includes('air bike') || n.includes('elliptical') || n.includes('row machine'))
    return { icon: '🏃', cardBg: '#080d1f', cardBorder: '#1e3a8a', iconBg: '#0a1230', titleColor: '#60a5fa' };

  if (n.includes('leg') || n.includes('squat') || n.includes('glute') || n.includes('hamstring') || n.includes('quad'))
    return { icon: '🦵', cardBg: colors.bgCard, cardBorder: '#7a4500', iconBg: '#1c0e00', titleColor: colors.text };

  if (n.includes('chest') || n.includes('bench') || n.includes('push'))
    return { icon: '🫁', cardBg: colors.bgCard, cardBorder: '#5c1800', iconBg: '#1a0500', titleColor: colors.text };

  if (n.includes('back') || n.includes('pull') || n.includes('deadlift') || n.includes('row'))
    return { icon: '🦾', cardBg: colors.bgCard, cardBorder: '#003366', iconBg: '#000d1a', titleColor: colors.text };

  if (n.includes('shoulder') || n.includes('delt') || n.includes('overhead') || n.includes('press'))
    return { icon: '💪', cardBg: colors.bgCard, cardBorder: '#3d0066', iconBg: '#0a001a', titleColor: colors.text };

  if (n.includes('arm') || n.includes('bicep') || n.includes('tricep') || n.includes('curl'))
    return { icon: '💪', cardBg: colors.bgCard, cardBorder: '#3d0066', iconBg: '#0a001a', titleColor: colors.text };

  if (n.includes('full') || n.includes('body'))
    return { icon: '🏋️', cardBg: colors.bgCard, cardBorder: '#00592d', iconBg: '#001a0d', titleColor: colors.text };

  return { icon: '🏋️', cardBg: colors.bgCard, cardBorder: '#404020', iconBg: '#1a1a00', titleColor: colors.text };
}

function calcSessionVol(session) {
  return Math.round(
    (session.workout_exercises ?? []).reduce((s, ex) =>
      s + (ex.sets ?? []).reduce((ss, st) => ss + (st.weight_kg ?? 0) * (st.reps ?? 0), 0), 0)
  );
}

function getBestSetIndex(sets) {
  if (!sets || sets.length === 0) return -1;
  let best = -1, bestV = -1;
  sets.forEach((s, i) => {
    const v = (s.weight_kg ?? 0) * (s.reps ?? 0);
    if (v > bestV) { bestV = v; best = i; }
  });
  return best;
}

function computePBMap(sessions) {
  const bestByEx = {};
  const pbMap = {};
  const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const session of sorted) {
    const pbs = new Set();
    for (const ex of (session.workout_exercises ?? [])) {
      const key = (ex.exercise_name ?? '').toLowerCase();
      const best = (ex.sets ?? []).reduce((b, s) => Math.max(b, s.weight_kg ?? 0), 0);
      if (best > 0 && best > (bestByEx[key] ?? 0)) { pbs.add(key); bestByEx[key] = best; }
    }
    pbMap[session.id] = pbs;
  }
  return pbMap;
}

function getVolumeDelta(session, allSessions) {
  const name = (session.notes ?? '').toLowerCase().trim();
  if (!name) return null;
  const curVol = session.total_volume ?? calcSessionVol(session);
  const prev = allSessions.find(s =>
    s.id !== session.id &&
    (s.notes ?? '').toLowerCase().trim() === name &&
    new Date(s.date) < new Date(session.date)
  );
  if (!prev) return null;
  const prevVol = prev.total_volume ?? calcSessionVol(prev);
  const delta = Math.round(curVol - prevVol);
  const pct = prevVol > 0 ? Math.abs(Math.round((delta / prevVol) * 100)) : 0;
  return { delta, pct, prevDate: prev.date };
}

function fmtDate(d) {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}
function fmtDateShort(d) {
  const dt = new Date(d);
  return `${dt.getDate()} ${MONTH_NAMES[dt.getMonth()]}`;
}

const MUSCLE_KW = [
  { keys: ['incline', 'upper chest'], m: ['Upper Chest', 'Front Delts'] },
  { keys: ['bench press', 'chest press'], m: ['Chest', 'Front Delts', 'Triceps'] },
  { keys: ['pec fly', 'cable fly', 'chest fly', ' fly', 'pec deck'], m: ['Chest'] },
  { keys: ['dip'], m: ['Chest', 'Triceps'] },
  { keys: ['lat pull', 'pull down', 'pulldown', 'pull-down'], m: ['Lats', 'Biceps'] },
  { keys: ['seated row', 'cable row', 'chest supported row', 'bent over row'], m: ['Mid Back', 'Rhomboids', 'Biceps'] },
  { keys: ['row'], m: ['Mid Back', 'Rhomboids'] },
  { keys: ['deadlift'], m: ['Lower Back', 'Glutes', 'Hamstrings'] },
  { keys: ['shoulder press', 'overhead press', 'ohp', 'military press'], m: ['Shoulders', 'Triceps'] },
  { keys: ['lateral raise', 'side raise'], m: ['Side Delts'] },
  { keys: ['front raise'], m: ['Front Delts'] },
  { keys: ['leg press'], m: ['Quads', 'Glutes'] },
  { keys: ['leg extension'], m: ['Quads'] },
  { keys: ['leg curl', 'hamstring curl', 'lying curl'], m: ['Hamstrings'] },
  { keys: ['squat'], m: ['Quads', 'Glutes', 'Hamstrings'] },
  { keys: ['calf raise', 'calf press'], m: ['Calves'] },
  { keys: ['hip thrust', 'glute bridge'], m: ['Glutes'] },
  { keys: ['bicep curl', 'barbell curl', 'dumbbell curl', ' curl'], m: ['Biceps'] },
  { keys: ['tricep', 'skull crusher', 'pushdown', 'extension'], m: ['Triceps'] },
  { keys: ['stairmaster', 'air bike', 'treadmill', 'cycling', 'running', 'elliptical'], m: ['Cardiovascular'] },
];

function getExerciseMuscles(exerciseName) {
  const name = (exerciseName ?? '').toLowerCase();
  for (const { keys, m } of MUSCLE_KW) {
    if (keys.some(k => name.includes(k))) return m.slice(0, 3);
  }
  return [];
}

function getMuscleGroups(exercises) {
  const groups = new Set();
  for (const ex of (exercises ?? [])) {
    getExerciseMuscles(ex.exercise_name).forEach(g => groups.add(g));
  }
  return [...groups].slice(0, 7);
}

function generateDayList(sessions, year, month, hasSearch) {
  const today = new Date(); today.setHours(23, 59, 59, 999);
  const daysInMonth = new Date(year, month, 0).getDate();
  const result = [];
  for (let d = daysInMonth; d >= 1; d--) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (new Date(dateStr) > today) continue;
    const session = sessions.find(s => s.date === dateStr);
    if (session) result.push({ type: 'session', session, date: dateStr });
    else if (!hasSearch) result.push({ type: 'rest', date: dateStr });
  }
  return result;
}

function getRecentTypes(sessions) {
  const seen = new Set(); const result = [];
  for (const s of sessions) {
    const n = (s.notes ?? '').trim();
    if (n && !seen.has(n.toLowerCase())) { seen.add(n.toLowerCase()); result.push(n); if (result.length >= 8) break; }
  }
  return result;
}

let _tid = 0;
function tid() { return `_t${++_tid}`; }
function blankEx() { return { _key: tid(), name: '', sets: [{ _key: tid(), weight_kg: '', reps: '' }] }; }

// ─── Session Detail Modal ─────────────────────────────────────────────────────
function SessionDetailModal({ session, pbMap, allSessions, visible, onClose, onEdit, onRepeat, onDelete }) {
  const [expandedIds, setExpandedIds] = useState(new Set());

  useEffect(() => {
    if (visible && session) {
      const allIds = new Set((session.workout_exercises ?? []).map(ex => ex.id));
      setExpandedIds(allIds);
    }
  }, [visible, session]);

  if (!session) return null;

  const ws = getWorkoutStyle(session.notes);
  const exercises = (session.workout_exercises ?? []).slice().sort((a, b) => a.order_index - b.order_index);
  const totalSets = exercises.reduce((s, ex) => s + (ex.sets?.length ?? 0), 0);
  const vol = session.total_volume ?? calcSessionVol(session);
  const kcal = session.calories_burned ?? 0;
  const pbSet = pbMap[session.id] ?? new Set();
  const muscleGroups = getMuscleGroups(exercises);
  const delta = getVolumeDelta(session, allSessions);
  const allExpanded = exercises.every(ex => expandedIds.has(ex.id));

  const toggleEx = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleAll = () => {
    if (allExpanded) setExpandedIds(new Set());
    else setExpandedIds(new Set(exercises.map(ex => ex.id)));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={dS.container}>
        <View style={dS.handle} />

        {/* Header */}
        <View style={dS.header}>
          <View style={[dS.typeIconBox, { backgroundColor: ws.iconBg, borderColor: ws.cardBorder }]}>
            <Text style={{ fontSize: 24 }}>{ws.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dS.headerName}>{session.notes || 'Workout'}</Text>
            <Text style={dS.headerDate}>{fmtDate(session.date)}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={dS.closeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Stats row */}
        <View style={dS.statsRow}>
          {[
            { label: 'EXR',    icon: '🏋️', value: exercises.length },
            { label: 'SETS',   icon: '🔄', value: totalSets },
            { label: 'KG VOL', icon: '⚡', value: vol > 0 ? vol.toLocaleString() : '—' },
            { label: 'KCAL',   icon: '🔥', value: kcal > 0 ? kcal : '—' },
          ].map(({ label, icon, value }, i) => (
            <View key={label} style={[dS.statCell, i < 3 && dS.statCellBorder]}>
              <Text style={{ fontSize: 18 }}>{icon}</Text>
              <Text style={dS.statValue}>{value}</Text>
              <Text style={dS.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Volume comparison */}
        {delta && (
          <View style={[dS.compBanner, {
            backgroundColor: delta.delta >= 0 ? '#001a00' : '#1a0000',
            borderColor: delta.delta >= 0 ? '#006600' : '#660000',
          }]}>
            <Text style={{ fontSize: 15 }}>📊</Text>
            <Text style={[dS.compText, { color: delta.delta >= 0 ? colors.success : colors.danger }]}>
              {' '}vs last {session.notes} ({fmtDateShort(delta.prevDate)}): {delta.delta >= 0 ? '+' : ''}{delta.delta.toLocaleString()}kg ({delta.pct}% {delta.delta >= 0 ? 'more' : 'less'})
            </Text>
          </View>
        )}

        {/* Session muscle tags */}
        {muscleGroups.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }} contentContainerStyle={dS.tagRow}>
            {muscleGroups.map(m => (
              <View key={m} style={dS.muscleTag}>
                <Text style={dS.muscleTagText}>{m}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Exercises */}
        <ScrollView style={dS.exScroll} keyboardShouldPersistTaps="handled">
          <View style={dS.exSectionHeader}>
            <Text style={dS.exLabel}>EXERCISES</Text>
            <TouchableOpacity onPress={toggleAll} style={dS.collapseToggleWrap}>
              <Text style={dS.collapseToggleText}>{allExpanded ? 'COLLAPSE ALL' : 'EXPAND ALL'}</Text>
              <View style={[dS.toggleSwitch, allExpanded && dS.toggleSwitchOn]}>
                <View style={[dS.toggleKnob, allExpanded && dS.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

          {exercises.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: colors.textDim, fontSize: typography.sm }}>No exercises logged</Text>
            </View>
          )}

          {exercises.map(ex => {
            const isPB = pbSet.has((ex.exercise_name ?? '').toLowerCase());
            const isExpanded = expandedIds.has(ex.id);
            const sortedSets = (ex.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number);
            const bestIdx = getBestSetIndex(sortedSets);
            const exMuscles = getExerciseMuscles(ex.exercise_name);
            const exStyle = getWorkoutStyle(ex.exercise_name);

            return (
              <TouchableOpacity key={ex.id} style={dS.exCard} onPress={() => toggleEx(ex.id)} activeOpacity={0.85}>
                {/* Exercise header */}
                <View style={dS.exCardHeader}>
                  <View style={[dS.exIcon, { backgroundColor: exStyle.iconBg, borderColor: exStyle.cardBorder }]}>
                    <Text style={{ fontSize: 18 }}>{exStyle.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={dS.exName}>{(ex.exercise_name ?? '').toUpperCase()}</Text>
                      {isPB && (
                        <View style={dS.pbBadge}>
                          <Text style={dS.pbBadgeText}>🏆 PB</Text>
                        </View>
                      )}
                    </View>
                    {exMuscles.length > 0 && (
                      <View style={dS.exMuscleRow}>
                        {exMuscles.map(m => (
                          <Text key={m} style={dS.exMuscleTag}>{m}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                    size={14} color={colors.textDim}
                  />
                </View>

                {/* Set table */}
                {isExpanded && sortedSets.length > 0 && (
                  <>
                    <View style={dS.setTableHdr}>
                      <Text style={[dS.setTH, { width: 32 }]}>SET</Text>
                      <Text style={[dS.setTH, { width: 20 }]}></Text>
                      <Text style={[dS.setTH, { flex: 1 }]}>WEIGHT × REPS</Text>
                      <Text style={[dS.setTH, { width: 56 }]}></Text>
                    </View>
                    {sortedSets.map((s, idx) => {
                      const isBest = idx === bestIdx;
                      return (
                        <View key={s.id} style={[dS.setRow, isBest && dS.bestSetRow]}>
                          <Text style={dS.setNum}>S{s.set_number}</Text>
                          <View style={dS.setDotWrap}>
                            <View style={[dS.dot, { backgroundColor: isBest ? colors.warning : colors.textDim }]} />
                          </View>
                          <Text style={dS.setWeight}>{s.weight_kg != null ? `${s.weight_kg}kg` : '—'}</Text>
                          <Text style={dS.setXText}>×</Text>
                          <Text style={dS.setReps}>{s.reps != null ? String(s.reps) : '—'}</Text>
                          {/* Fixed-width slot keeps all rows aligned */}
                          <View style={{ width: 58, alignItems: 'flex-end' }}>
                            {isBest && (
                              <View style={dS.bestBadge}>
                                <Text style={dS.bestBadgeText}>★ best</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </>
                )}
                {isExpanded && sortedSets.length === 0 && (
                  <Text style={{ fontSize: typography.xs, color: colors.textDim, padding: 8 }}>No sets recorded</Text>
                )}
              </TouchableOpacity>
            );
          })}

          {/* Action buttons */}
          <View style={dS.actionRow}>
            <TouchableOpacity style={dS.editBtn} onPress={onEdit}>
              <Text style={{ fontSize: 14 }}>✏️</Text>
              <Text style={dS.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dS.repeatBtn} onPress={onRepeat}>
              <Ionicons name="refresh" size={16} color="#fff" />
              <Text style={dS.repeatBtnText}>Repeat</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dS.deleteBtn} onPress={onDelete}>
              <Text style={{ fontSize: 14 }}>🗑️</Text>
              <Text style={dS.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 50 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Custom Date Picker Modal ────────────────────────────────────────────────
const CAL_DAY_NAMES   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const CAL_MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function DatePickerModal({ visible, value, onSelect, onClose }) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const initFromValue = (v) => {
    const d = v ? new Date(v + 'T00:00:00') : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  };

  const [calYear, setCalYear]   = useState(() => initFromValue(value).getFullYear());
  const [calMonth, setCalMonth] = useState(() => initFromValue(value).getMonth());

  useEffect(() => {
    if (visible) {
      const d = initFromValue(value);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [visible, value]);

  const firstDow   = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const canGoNext = calYear < today.getFullYear() ||
    (calYear === today.getFullYear() && calMonth < today.getMonth());

  const prevCal = () => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
    else setCalMonth(m => m - 1);
  };
  const nextCal = () => {
    if (!canGoNext) return;
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
    else setCalMonth(m => m + 1);
  };

  const isoForDay = (day) =>
    `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  const selectDay = (day) => {
    const iso = isoForDay(day);
    if (iso > todayStr) return;
    onSelect(iso);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={dpS.overlay} onPress={onClose}>
        <Pressable style={dpS.sheet} onPress={() => {}}>
          {/* Month / Year nav */}
          <View style={dpS.calHeader}>
            <TouchableOpacity onPress={prevCal} style={dpS.calNavBtn}>
              <Text style={dpS.calNavText}>‹</Text>
            </TouchableOpacity>
            <Text style={dpS.calTitle}>{CAL_MONTH_SHORT[calMonth]} {calYear}</Text>
            <TouchableOpacity onPress={nextCal} style={dpS.calNavBtn} disabled={!canGoNext}>
              <Text style={[dpS.calNavText, !canGoNext && { color: colors.textDim }]}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Day names */}
          <View style={dpS.dayNamesRow}>
            {CAL_DAY_NAMES.map(n => (
              <View key={n} style={dpS.dayNameCell}>
                <Text style={dpS.dayNameText}>{n}</Text>
              </View>
            ))}
          </View>

          {/* Grid */}
          <View style={dpS.grid}>
            {cells.map((day, idx) => {
              if (!day) return <View key={`e${idx}`} style={dpS.dayCell} />;
              const iso    = isoForDay(day);
              const future = iso > todayStr;
              const isT    = iso === todayStr;
              const isSel  = iso === value;
              return (
                <TouchableOpacity
                  key={day}
                  style={[dpS.dayCell, isSel && dpS.dayCellSelected, isT && !isSel && dpS.dayCellToday]}
                  onPress={() => selectDay(day)}
                  disabled={future}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    dpS.dayText,
                    future && dpS.dayTextFuture,
                    isT && !isSel && dpS.dayTextToday,
                    isSel && dpS.dayTextSelected,
                  ]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Today shortcut */}
          <TouchableOpacity style={dpS.todayBtn} onPress={() => { onSelect(todayStr); onClose(); }}>
            <Text style={dpS.todayBtnText}>Today</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Edit Session Modal ───────────────────────────────────────────────────────
// Always show these two as default chip suggestions
const DEFAULT_CHIPS = ['Rest Day', 'Cardio'];

function EditSessionModal({ visible, isNew, initialData, recentTypes, onSave, onCancel, isSaving }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [exercises, setExercises] = useState([]);
  const [activeExIdx, setActiveExIdx] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // All chips: defaults first, then unique recent types excluding defaults
  const allChips = useMemo(() => {
    const extra = recentTypes.filter(t => !DEFAULT_CHIPS.some(d => d.toLowerCase() === t.toLowerCase()));
    return [...DEFAULT_CHIPS, ...extra];
  }, [recentTypes]);

  useEffect(() => {
    if (visible && initialData) {
      setDate(initialData.date ?? '');
      setName(initialData.name ?? '');
      setExercises(initialData.exercises ?? []);
      setActiveExIdx(null);
      setShowDatePicker(false);
    }
  }, [visible, initialData]);

  const addExercise = () => {
    const ex = blankEx();
    const newIdx = exercises.length;
    setExercises(prev => [...prev, ex]);
    setActiveExIdx(newIdx);
  };

  const removeExercise = (idx) => {
    setExercises(prev => prev.filter((_, i) => i !== idx));
    if (activeExIdx === idx) setActiveExIdx(null);
    else if (activeExIdx > idx) setActiveExIdx(activeExIdx - 1);
  };

  const updateExName = (idx, val) =>
    setExercises(prev => prev.map((ex, i) => i === idx ? { ...ex, name: val } : ex));

  const addSet = (exIdx) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: [...(ex.sets ?? []), { _key: tid(), weight_kg: '', reps: '' }],
    }));

  const removeSet = (exIdx, sIdx) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: (ex.sets ?? []).filter((_, j) => j !== sIdx),
    }));

  const updateSet = (exIdx, sIdx, field, val) =>
    setExercises(prev => prev.map((ex, i) => i !== exIdx ? ex : {
      ...ex, sets: (ex.sets ?? []).map((s, j) => j !== sIdx ? s : { ...s, [field]: val }),
    }));

  const handleSave = () => {
    if (!date.trim()) { Alert.alert('Date required', 'Please pick a date.'); return; }
    const isRest = name.toLowerCase() === 'rest day';
    onSave({ date: date.trim(), name: name.trim() || 'Workout', exercises: isRest ? [] : exercises });
  };

  const isRestDay = name.toLowerCase() === 'rest day';
  const isCardio  = !isRestDay && ['cardio','run','stair','hiit','bike','swim','walk','cycle'].some(k => name.toLowerCase().includes(k));

  const fmtDisplayDate = (iso) => {
    if (!iso) return 'Pick date';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <SafeAreaView style={eS.container}>
          {/* Header */}
          <View style={eS.header}>
            <View style={{ flex: 1 }}>
              <Text style={eS.headerTop}>
                <Text style={eS.headerLOG}>LOG </Text>
                <Text style={eS.headerSub}>{isNew ? 'New Session' : 'Edit Session'}</Text>
              </Text>
              <Text style={eS.trackLabel}>TRACK YOUR WORKOUT</Text>
            </View>
            <TouchableOpacity onPress={onCancel} style={eS.closeBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Session type chips — only the selected chip is highlighted */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={eS.typeScroll} contentContainerStyle={eS.typeRow}>
            {allChips.map(t => {
              const active = name.toLowerCase() === t.toLowerCase();
              return (
                <TouchableOpacity key={t}
                  style={[eS.typeChip, active && eS.typeChipActive]}
                  onPress={() => setName(t)}>
                  <Text style={[eS.typeChipText, active && eS.typeChipTextActive]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Date + Type */}
          <View style={eS.fieldRow}>
            <View style={eS.fieldCol}>
              <Text style={eS.fieldLabel}>DATE</Text>
              <TouchableOpacity style={eS.dateBtn} onPress={() => setShowDatePicker(true)}>
                <Ionicons name="calendar-outline" size={16} color={colors.warning} />
                <Text style={[eS.dateBtnText, !date && { color: colors.textDim }]}>
                  {date ? fmtDisplayDate(date) : 'Pick date'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={eS.fieldCol}>
              <Text style={eS.fieldLabel}>TYPE</Text>
              <TextInput style={eS.fieldInput} value={name} onChangeText={setName}
                placeholder="e.g. Chest & Back" placeholderTextColor={colors.textDim} />
            </View>
          </View>

          <DatePickerModal
            visible={showDatePicker}
            value={date}
            onSelect={setDate}
            onClose={() => setShowDatePicker(false)}
          />

          {/* Content area — differs by type */}
          {isRestDay ? (
            /* ── Rest Day UI ── */
            <View style={eS.restDayWrap}>
              <Text style={eS.restDayEmoji}>😴</Text>
              <Text style={eS.restDayTitle}>Rest & Recovery</Text>
              <Text style={eS.restDaySub}>No exercises needed on rest days.{'\n'}Recovery is part of progress!</Text>
              <View style={eS.restDayBadges}>
                {['💤 Sleep', '🧘 Stretch', '🥗 Nutrition'].map(b => (
                  <View key={b} style={eS.restBadge}>
                    <Text style={eS.restBadgeText}>{b}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
            /* ── Workout / Cardio exercise list ── */
            <ScrollView style={eS.exScroll} keyboardShouldPersistTaps="handled">
              {isCardio && (
                <View style={eS.cardioHint}>
                  <Ionicons name="fitness-outline" size={14} color="#60a5fa" />
                  <Text style={eS.cardioHintText}>Add activities — Distance (km) × Duration (min)</Text>
                </View>
              )}

              {exercises.map((ex, exIdx) => {
                const isActive = activeExIdx === exIdx;
                return (
                  <View key={ex._key} style={[eS.exCard, isActive && eS.exCardActive]}>
                    <TouchableOpacity style={eS.exCardHeader}
                      onPress={() => setActiveExIdx(isActive ? null : exIdx)}>
                      <View style={[eS.exNumBadge, isActive && eS.exNumBadgeActive]}>
                        <Text style={[eS.exNumText, isActive && eS.exNumTextActive]}>{exIdx + 1}</Text>
                      </View>
                      <Text style={[eS.exCardName, isActive && eS.exCardNameActive]} numberOfLines={1}>
                        {ex.name.trim() || (isCardio ? 'New Activity' : 'New Exercise')}
                      </Text>
                      <Text style={eS.exSetsCount}>{(ex.sets ?? []).length} sets</Text>
                      <TouchableOpacity onPress={() => removeExercise(exIdx)} style={eS.exDeleteBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <View style={eS.exDeleteX}>
                          <Ionicons name="close" size={12} color="#ff4444" />
                        </View>
                      </TouchableOpacity>
                    </TouchableOpacity>

                    {isActive && (
                      <View style={eS.exExpanded}>
                        <View style={eS.exNameRow}>
                          <View style={eS.hashIcon}>
                            <Text style={eS.hashText}>{isCardio ? '🏃' : '#'}</Text>
                          </View>
                          <TextInput
                            style={eS.exNameInput}
                            value={ex.name}
                            onChangeText={v => updateExName(exIdx, v)}
                            placeholder={isCardio ? 'Activity name (e.g. Running)' : 'Exercise name'}
                            placeholderTextColor={colors.textDim}
                            autoFocus
                          />
                        </View>

                        {(ex.sets ?? []).map((s, sIdx) => (
                          <View key={s._key} style={eS.setRow}>
                            <Text style={eS.setNumLabel}>{sIdx + 1}</Text>
                            <TextInput
                              style={eS.setInput}
                              value={s.weight_kg}
                              onChangeText={v => updateSet(exIdx, sIdx, 'weight_kg', v)}
                              keyboardType="decimal-pad"
                              placeholder={isCardio ? 'km' : 'kg'}
                              placeholderTextColor={colors.textDim}
                            />
                            <Text style={eS.setX}>×</Text>
                            <TextInput
                              style={eS.setInput}
                              value={s.reps}
                              onChangeText={v => updateSet(exIdx, sIdx, 'reps', v)}
                              keyboardType="numeric"
                              placeholder={isCardio ? 'min' : 'reps'}
                              placeholderTextColor={colors.textDim}
                            />
                            <TouchableOpacity onPress={() => removeSet(exIdx, sIdx)} style={eS.setDeleteBtn}>
                              <Ionicons name="close" size={14} color={colors.textDim} />
                            </TouchableOpacity>
                          </View>
                        ))}

                        <TouchableOpacity style={eS.addSetBtn} onPress={() => addSet(exIdx)}>
                          <Text style={eS.addSetText}>+ Add Set</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}

              <TouchableOpacity style={eS.addExBtn} onPress={addExercise}>
                <Ionicons name="add" size={18} color={colors.warning} />
                <Text style={eS.addExText}>{isCardio ? 'Add Activity' : 'Add Exercise'}</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          )}

          {/* Bottom buttons */}
          <View style={eS.bottomRow}>
            <TouchableOpacity style={eS.cancelBtn} onPress={onCancel}>
              <Text style={eS.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={eS.saveBtn} onPress={handleSave} disabled={isSaving}>
              {isSaving
                ? <ActivityIndicator color={colors.bg} />
                : <Text style={eS.saveBtnText}>{isNew ? 'Save Session' : 'Update Session'}</Text>
              }
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function WorkoutScreen() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1);
  const [search, setSearch]       = useState('');
  const [detailSession, setDetailSession] = useState(null);
  const [showDetail, setShowDetail]       = useState(false);
  const [showEdit, setShowEdit]           = useState(false);
  const [editIsNew, setEditIsNew]         = useState(false);
  const [editInitial, setEditInitial]     = useState(null);

  const { data: sessions = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['sessions', user?.id],
    queryFn: () => fetchSessions(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const saveMut = useMutation({
    mutationFn: (params) => saveSession(user.id, params),
    onSuccess: () => { qc.invalidateQueries(['sessions', user.id]); setShowEdit(false); },
    onError: (e) => Alert.alert('Error saving', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteFullSession,
    onSuccess: () => { qc.invalidateQueries(['sessions', user.id]); setShowDetail(false); },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const pbMap       = useMemo(() => computePBMap(sessions), [sessions]);
  const recentTypes = useMemo(() => getRecentTypes(sessions), [sessions]);

  const filteredSessions = useMemo(() => {
    const ms = sessions.filter(s => {
      const d = new Date(s.date);
      return d.getFullYear() === viewYear && d.getMonth() + 1 === viewMonth;
    });
    if (!search.trim()) return ms;
    const q = search.toLowerCase();
    return ms.filter(s =>
      (s.notes ?? '').toLowerCase().includes(q) ||
      (s.workout_exercises ?? []).some(ex => (ex.exercise_name ?? '').toLowerCase().includes(q))
    );
  }, [sessions, viewYear, viewMonth, search]);

  const dayList = useMemo(() =>
    generateDayList(filteredSessions, viewYear, viewMonth, search.trim().length > 0),
    [filteredSessions, viewYear, viewMonth, search]);

  const canGoNext = viewYear < today.getFullYear() ||
    (viewYear === today.getFullYear() && viewMonth < today.getMonth() + 1);

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (!canGoNext) return;
    if (viewMonth === 12) { setViewMonth(1); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const openDetail = (session) => {
    const live = sessions.find(s => s.id === session.id) ?? session;
    setDetailSession(live);
    setShowDetail(true);
  };

  const openEdit = (session) => {
    setEditIsNew(false);
    setEditInitial({
      sessionId: session.id,
      date: session.date,
      name: session.notes ?? '',
      exercises: (session.workout_exercises ?? [])
        .slice().sort((a, b) => a.order_index - b.order_index)
        .map(ex => ({
          _key: ex.id,
          name: ex.exercise_name,
          sets: (ex.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
            .map(s => ({ _key: s.id, weight_kg: s.weight_kg != null ? String(s.weight_kg) : '', reps: s.reps != null ? String(s.reps) : '' })),
        })),
    });
    setShowDetail(false);
    setShowEdit(true);
  };

  const openNew = () => {
    setEditIsNew(true);
    setEditInitial({ sessionId: null, date: today.toISOString().split('T')[0], name: '', exercises: [] });
    setShowEdit(true);
  };

  const handleRepeat = (session) => {
    setEditIsNew(true);
    setEditInitial({
      sessionId: null,
      date: today.toISOString().split('T')[0],
      name: session.notes ?? '',
      exercises: (session.workout_exercises ?? [])
        .slice().sort((a, b) => a.order_index - b.order_index)
        .map(ex => ({ _key: tid(), name: ex.exercise_name, sets: [{ _key: tid(), weight_kg: '', reps: '' }] })),
    });
    setShowDetail(false);
    setShowEdit(true);
  };

  const confirmDelete = (sessionId) => {
    Alert.alert('Delete Workout', 'Remove this session and all data?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(sessionId) },
    ]);
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.appHeader}>
        <Text style={s.logoText}>Fitzo<Text style={s.logoDot}>•</Text></Text>
        <Text style={s.screenLabel}>WORKOUT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={s.onlineDot} />
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </View>
      </View>

      {/* Title */}
      <View style={s.titleRow}>
        <Text style={s.pageTitle}>
          WORKOUT <Text style={s.pageTitleAccent}>HISTORY</Text>
        </Text>
        <Text style={s.sessionCount}>{sessions.length} SESSIONS</Text>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Ionicons name="search" size={15} color={colors.textDim} />
        <TextInput
          style={s.searchInput}
          placeholder="Search by exercise name..."
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={15} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>

      {/* Month nav */}
      <View style={s.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={s.monthBtn}>
          <Text style={s.monthChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={s.monthLabel}>{MONTH_FULL[viewMonth - 1]} {viewYear}</Text>
        <TouchableOpacity onPress={nextMonth} style={s.monthBtn} disabled={!canGoNext}>
          <Text style={[s.monthChevron, !canGoNext && { color: colors.textDim }]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />}

        {!isLoading && dayList.length === 0 && (
          <View style={s.empty}>
            <Ionicons name="barbell-outline" size={52} color={colors.textDim} />
            <Text style={s.emptyTitle}>No sessions in {MONTH_NAMES[viewMonth - 1]} {viewYear}</Text>
            <Text style={s.emptySub}>Tap + to log a workout</Text>
          </View>
        )}

        {dayList.map(item => {
          if (item.type === 'rest') {
            return (
              <TouchableOpacity
                key={item.date}
                style={s.restCard}
                onPress={() => {
                  setEditIsNew(true);
                  setEditInitial({ sessionId: null, date: item.date, name: 'Rest Day', exercises: [] });
                  setShowEdit(true);
                }}
                activeOpacity={0.75}
              >
                <View style={s.restIcon}>
                  <Text style={{ fontSize: 20 }}>😴</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.restTitle}>Rest Day</Text>
                  <Text style={s.restSub}>{fmtDate(item.date)} · Recovery · no workout</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color="#008866" />
              </TouchableOpacity>
            );
          }

          const sess = item.session;
          const ws   = getWorkoutStyle(sess.notes);
          const vol  = sess.total_volume ?? calcSessionVol(sess);
          const delta = getVolumeDelta(sess, sessions);
          const exs  = sess.workout_exercises ?? [];

          // Subtitle: cardio (vol=0) → show ex names; weighted → show count + vol
          let subtitle = fmtDate(sess.date);
          if (vol === 0 && exs.length > 0) {
            const names = exs.slice(0, 2).map(e => e.exercise_name).filter(Boolean).join(', ');
            const more = exs.length > 2 ? ` +${exs.length - 2}` : '';
            subtitle += ` · ${names}${more}`;
            if (sess.duration_min) subtitle += ` · ${sess.duration_min}min`;
            if (sess.calories_burned) subtitle += ` · 🔥${sess.calories_burned}kcal`;
          } else {
            if (exs.length > 0) subtitle += ` · ${exs.length}ex`;
            if (vol > 0) subtitle += ` · ${vol.toLocaleString()}kg`;
            if (sess.calories_burned) subtitle += ` · 🔥${sess.calories_burned}kcal`;
          }

          return (
            <TouchableOpacity
              key={sess.id}
              style={[s.sessionCard, { backgroundColor: ws.cardBg, borderColor: ws.cardBorder }]}
              onPress={() => openDetail(sess)}
              activeOpacity={0.82}
            >
              <View style={[s.sessionIcon, { backgroundColor: ws.iconBg, borderColor: ws.cardBorder }]}>
                <Text style={{ fontSize: 22 }}>{ws.icon}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.sessionNameRow}>
                  <Text style={[s.sessionName, { color: ws.titleColor }]} numberOfLines={1}>
                    {sess.notes || 'Workout'}
                  </Text>
                  {delta && (
                    <View style={[s.deltaBadge, { backgroundColor: delta.delta >= 0 ? '#003d00' : '#3d0000' }]}>
                      <Text style={[s.deltaText, { color: delta.delta >= 0 ? colors.success : colors.danger }]}>
                        {delta.delta >= 0 ? '▲' : '▼'}{Math.abs(delta.delta).toLocaleString()}kg
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={s.sessionSub} numberOfLines={1}>{subtitle}</Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.textDim} />
            </TouchableOpacity>
          );
        })}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={s.fab} onPress={openNew} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      <SessionDetailModal
        session={detailSession}
        pbMap={pbMap}
        allSessions={sessions}
        visible={showDetail}
        onClose={() => setShowDetail(false)}
        onEdit={() => openEdit(detailSession)}
        onRepeat={() => handleRepeat(detailSession)}
        onDelete={() => confirmDelete(detailSession?.id)}
      />

      <EditSessionModal
        visible={showEdit}
        isNew={editIsNew}
        initialData={editInitial}
        recentTypes={recentTypes}
        onSave={(data) => saveMut.mutate({ ...data, sessionId: editInitial?.sessionId ?? null })}
        onCancel={() => setShowEdit(false)}
        isSaving={saveMut.isPending}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  appHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  },
  logoText: { fontSize: typography.lg, fontWeight: weight.black, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.warning },
  screenLabel: { fontSize: typography.xs, fontWeight: weight.bold, letterSpacing: 2, color: colors.textMuted },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },

  titleRow: { paddingHorizontal: 20, paddingBottom: 10 },
  pageTitle: { fontSize: typography.xxxl, fontWeight: weight.black, color: colors.text, letterSpacing: -0.5 },
  pageTitleAccent: { color: colors.accent },
  sessionCount: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, marginTop: 2 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: colors.bgCard, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },

  monthNav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 10, marginBottom: 8,
  },
  monthBtn: { padding: 10 },
  monthChevron: { fontSize: 26, color: colors.text, fontWeight: '300' },
  monthLabel: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, fontStyle: 'italic' },

  content: { paddingHorizontal: 16, paddingBottom: 32 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim },

  restCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#001815', borderWidth: 1, borderColor: '#006650',
    borderRadius: 14, padding: 12, marginBottom: 8,
  },
  restIcon: {
    width: 44, height: 44, borderRadius: 11, backgroundColor: '#002820',
    borderWidth: 1, borderColor: '#006650', alignItems: 'center', justifyContent: 'center',
  },
  restTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: '#00cc99' },
  restSub: { fontSize: typography.xs, color: '#008866', marginTop: 2 },

  sessionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 8,
  },
  sessionIcon: {
    width: 44, height: 44, borderRadius: 11, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  sessionNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  sessionName: { fontSize: typography.base, fontWeight: weight.bold },
  deltaBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  deltaText: { fontSize: 11, fontWeight: weight.bold },
  sessionSub: { fontSize: typography.xs, color: colors.textDim },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.warning, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.warning, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },
});

const dS = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0c18' },
  handle: { width: 40, height: 4, backgroundColor: colors.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 4 },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  typeIconBox: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerName: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  headerDate: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },
  closeBtn: { padding: 8, borderRadius: 20, backgroundColor: colors.bgElevated },

  statsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  statCell: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statCellBorder: { borderRightWidth: 1, borderRightColor: colors.border },
  statValue: { fontSize: typography.lg, fontWeight: weight.black, color: colors.text, marginTop: 2 },
  statLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginTop: 1 },

  compBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1,
  },
  compText: { fontSize: typography.xs, fontWeight: weight.semibold, flex: 1 },

  tagRow: { paddingHorizontal: 16, gap: 6, paddingVertical: 4 },
  muscleTag: {
    backgroundColor: '#1a1a00', borderWidth: 1, borderColor: '#404020',
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
  },
  muscleTagText: { fontSize: 11, color: colors.warning, fontWeight: weight.medium },

  exScroll: { flex: 1, paddingHorizontal: 16 },
  exSectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 14, marginBottom: 10,
  },
  exLabel: { fontSize: 11, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5 },
  collapseToggleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  collapseToggleText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1 },
  toggleSwitch: {
    width: 34, height: 18, borderRadius: 9, backgroundColor: colors.bgElevated,
    borderWidth: 1, borderColor: colors.border, justifyContent: 'center', paddingHorizontal: 2,
  },
  toggleSwitchOn: { backgroundColor: colors.warning, borderColor: colors.warning },
  toggleKnob: { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textDim },
  toggleKnobOn: { backgroundColor: colors.bg, alignSelf: 'flex-end' },

  exCard: {
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  exCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exIcon: { width: 36, height: 36, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  exName: { fontSize: typography.sm, fontWeight: weight.black, color: colors.text, letterSpacing: 0.3 },
  exMuscleRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  exMuscleTag: { fontSize: 10, color: colors.textDim, fontWeight: weight.medium },
  pbBadge: {
    backgroundColor: '#1a1000', borderWidth: 1, borderColor: '#6b4800',
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  pbBadgeText: { fontSize: 10, color: colors.warning, fontWeight: weight.bold },

  setTableHdr: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 10, paddingBottom: 4,
    borderBottomWidth: 1, borderBottomColor: colors.bgElevated, marginBottom: 4,
  },
  setTH: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 1, textAlign: 'center' },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  bestSetRow: { backgroundColor: '#1a1100', borderRadius: 8, marginHorizontal: -4, paddingHorizontal: 4 },
  setNum: { width: 32, fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.bold },
  setDotWrap: { width: 20, alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  setWeight: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.semibold, textAlign: 'center' },
  setXText: { fontSize: typography.xs, color: colors.textDim, marginHorizontal: 4 },
  setReps: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.semibold, textAlign: 'center' },
  bestBadge: { backgroundColor: '#2a1f00', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' },
  bestBadgeText: { fontSize: 10, color: colors.warning, fontWeight: weight.bold },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 13, borderRadius: 12,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  editBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  repeatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 13, borderRadius: 12, backgroundColor: '#006633',
  },
  repeatBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: '#ffffff' },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 13, borderRadius: 12, backgroundColor: '#3d0000',
    borderWidth: 1, borderColor: '#660000',
  },
  deleteBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.danger },
});

const eS = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTop: { fontSize: typography.xl },
  headerLOG: { fontWeight: weight.black, fontStyle: 'italic', color: colors.text },
  headerSub: { fontWeight: weight.bold, fontStyle: 'italic', color: colors.warning },
  trackLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 2, marginTop: 4 },
  closeBtn: { padding: 8, borderRadius: 20, backgroundColor: colors.bgCard, marginTop: 2 },

  typeScroll: { maxHeight: 52 },
  typeRow: { paddingHorizontal: 16, gap: 8, alignItems: 'center', paddingVertical: 8 },
  typeChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  typeChipActive: { borderColor: colors.warning, backgroundColor: '#1a0d00' },
  typeChipDefault: { borderColor: colors.warning + '55', backgroundColor: '#120a00' },
  typeChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },
  typeChipTextActive: { color: colors.warning, fontWeight: weight.bold },
  typeChipTextDefault: { color: colors.warning + 'aa', fontWeight: weight.medium },

  fieldRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 10 },
  fieldCol: { flex: 1 },
  fieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  dateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.warning + '66',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 11,
  },
  dateBtnText: { fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  fieldInput: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: colors.text, fontSize: typography.sm,
  },

  exScroll: { flex: 1, paddingHorizontal: 16, marginTop: 12 },
  exCard: {
    backgroundColor: colors.bgCard, borderRadius: 14, marginBottom: 10,
    overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
  },
  exCardActive: { borderColor: colors.warning, borderWidth: 1.5 },
  exCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  exNumBadge: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center',
  },
  exNumBadgeActive: { backgroundColor: colors.warning },
  exNumText: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted },
  exNumTextActive: { color: colors.bg },
  exCardName: { flex: 1, fontSize: typography.sm, fontWeight: weight.semibold, color: colors.textMuted },
  exCardNameActive: { color: colors.text },
  exSetsCount: { fontSize: typography.xs, color: colors.textDim },
  exDeleteBtn: { padding: 4 },
  exDeleteX: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#2a0000',
    borderWidth: 1, borderColor: '#660000', alignItems: 'center', justifyContent: 'center',
  },

  exExpanded: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12 },
  exNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  hashIcon: {
    width: 32, height: 40, borderRadius: 8, backgroundColor: colors.bgElevated,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  hashText: { fontSize: typography.base, color: colors.textDim, fontWeight: weight.bold },
  exNameInput: {
    flex: 1, backgroundColor: colors.bgElevated, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 10, color: colors.text, fontSize: typography.sm,
    borderWidth: 1, borderColor: colors.border,
  },

  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  setNumLabel: { width: 20, fontSize: typography.xs, color: colors.textDim, textAlign: 'center', fontWeight: weight.bold },
  setInput: {
    flex: 1, backgroundColor: colors.bgElevated, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 9, color: colors.text, fontSize: typography.sm,
    textAlign: 'center', borderWidth: 1, borderColor: colors.border,
  },
  setX: { fontSize: typography.sm, color: colors.textDim },
  setDeleteBtn: { padding: 6 },

  addSetBtn: {
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 8,
    paddingVertical: 8, alignItems: 'center', marginTop: 4,
  },
  addSetText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },

  addExBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.warning,
    borderRadius: 14, padding: 14, marginTop: 4, marginBottom: 8,
  },
  addExText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.warning },

  bottomRow: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  cancelText: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.textMuted },
  saveBtn: { flex: 2, padding: 14, borderRadius: 14, backgroundColor: colors.warning, alignItems: 'center' },
  saveBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.bg },

  restDayWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, gap: 12,
  },
  restDayEmoji: { fontSize: 64 },
  restDayTitle: { fontSize: typography.xl, fontWeight: weight.black, color: '#00cc99', textAlign: 'center' },
  restDaySub: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  restDayBadges: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' },
  restBadge: {
    backgroundColor: '#001815', borderWidth: 1, borderColor: '#006650',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  restBadgeText: { fontSize: typography.xs, color: '#00cc99', fontWeight: weight.medium },

  cardioHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#080d1f', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#1e3a8a', marginBottom: 10,
  },
  cardioHintText: { fontSize: typography.xs, color: '#60a5fa', flex: 1 },
});

const dpS = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center',
  },
  sheet: {
    width: 308, backgroundColor: colors.bgCard,
    borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  calHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  calNavBtn: { padding: 8 },
  calNavText: { fontSize: 26, color: colors.text, fontWeight: '300' },
  calTitle: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text },
  dayNamesRow: { flexDirection: 'row', marginBottom: 4 },
  dayNameCell: { width: '14.285714%', alignItems: 'center', paddingVertical: 4 },
  dayNameText: { fontSize: 11, color: colors.textMuted, fontWeight: weight.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.285714%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  dayCellSelected: { backgroundColor: colors.warning },
  dayCellToday: { borderWidth: 1, borderColor: colors.warning },
  dayText: { fontSize: typography.sm, color: colors.text },
  dayTextFuture: { color: colors.textDim, opacity: 0.35 },
  dayTextToday: { color: colors.warning, fontWeight: weight.bold },
  dayTextSelected: { color: colors.bg, fontWeight: weight.bold },
  todayBtn: {
    marginTop: 12, padding: 10, borderRadius: 10,
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center',
  },
  todayBtnText: { fontSize: typography.sm, color: colors.warning, fontWeight: weight.bold },
});
