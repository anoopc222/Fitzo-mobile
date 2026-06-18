import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Modal, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';

// ─── marker definitions with reference ranges ────────────────────────────────
const MARKERS = [
  // Blood Glucose
  {
    key: 'glucose', label: 'Glucose', unit: 'mg/dL', category: 'Glucose',
    ref: { low: 70, highNormal: 100, highWarning: 125 },
    desc: 'Fasting blood sugar',
  },
  // Lipids
  {
    key: 'total_cholesterol', label: 'Total Cholesterol', unit: 'mg/dL', category: 'Lipids',
    ref: { low: 0, highNormal: 200, highWarning: 239 },
    desc: 'Total blood cholesterol',
  },
  {
    key: 'hdl', label: 'HDL', unit: 'mg/dL', category: 'Lipids',
    ref: { low: 40, highNormal: 999, highWarning: 999 },
    desc: 'Good cholesterol (higher is better)',
    inverted: true,
  },
  {
    key: 'ldl', label: 'LDL', unit: 'mg/dL', category: 'Lipids',
    ref: { low: 0, highNormal: 100, highWarning: 159 },
    desc: 'Bad cholesterol (lower is better)',
  },
  {
    key: 'triglycerides', label: 'Triglycerides', unit: 'mg/dL', category: 'Lipids',
    ref: { low: 0, highNormal: 150, highWarning: 199 },
    desc: 'Blood fats',
  },
  // Vitamins
  {
    key: 'vitamin_d', label: 'Vitamin D', unit: 'ng/mL', category: 'Vitamins',
    ref: { low: 20, highNormal: 80, highWarning: 100 },
    desc: 'Sunlight vitamin',
    inverted: false,
    lowBad: true,
  },
  {
    key: 'vitamin_b12', label: 'Vitamin B12', unit: 'pg/mL', category: 'Vitamins',
    ref: { low: 200, highNormal: 900, highWarning: 1000 },
    desc: 'Energy & nerve health',
    lowBad: true,
  },
  // Thyroid
  {
    key: 'tsh', label: 'TSH', unit: 'mIU/L', category: 'Thyroid',
    ref: { low: 0.4, highNormal: 4.0, highWarning: 10.0 },
    desc: 'Thyroid stimulating hormone',
  },
];

const CATEGORIES = ['All', ...new Set(MARKERS.map(m => m.category))];

function getStatus(marker, value) {
  if (value == null) return 'unknown';
  const v = parseFloat(value);
  const { ref, inverted, lowBad } = marker;
  if (inverted) {
    // HDL: higher is better
    if (v >= ref.low) return 'good';
    if (v >= ref.low * 0.8) return 'warning';
    return 'danger';
  }
  if (lowBad) {
    // Vitamin D, B12: too low is bad
    if (v < ref.low) return 'danger';
    if (v <= ref.highNormal) return 'good';
    if (v <= ref.highWarning) return 'warning';
    return 'danger';
  }
  // Standard: low normal range is fine
  if (v < ref.low) return 'danger';
  if (v <= ref.highNormal) return 'good';
  if (v <= ref.highWarning) return 'warning';
  return 'danger';
}

function statusColor(colors, status) {
  return { good: colors.success, warning: colors.warning, danger: colors.danger, unknown: colors.textDim }[status];
}

function statusIcon(status) {
  return { good: 'checkmark-circle', warning: 'warning', danger: 'close-circle', unknown: 'help-circle' }[status];
}

async function fetchHealthLogs(userId) {
  const { data, error } = await supabase
    .from('health_logs')
    .select('id, glucose, total_cholesterol, hdl, ldl, triglycerides, vitamin_d, vitamin_b12, tsh, notes, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

async function logHealth(userId, values, notes) {
  const { error } = await supabase.from('health_logs').insert({
    user_id: userId, ...values, notes,
    logged_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function deleteHealthLog(id) {
  const { error } = await supabase.from('health_logs').delete().eq('id', id);
  if (error) throw error;
}

export default function HealthLogScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeTab, setActiveTab] = useState('Latest');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [notes, setNotes] = useState('');
  const [markerSearch, setMarkerSearch] = useState('');

  const { data: logs = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['health', user?.id],
    queryFn: () => fetchHealthLogs(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logMut = useMutation({
    mutationFn: ({ values, notes: n }) => logHealth(user.id, values, n),
    onSuccess: () => {
      qc.invalidateQueries(['health', user.id]);
      setShowModal(false);
      setForm({});
      setNotes('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteHealthLog,
    onSuccess: () => qc.invalidateQueries(['health', user.id]),
  });

  const latest = logs[0];

  const filteredMarkers = MARKERS.filter(m => {
    const categoryMatch = activeCategory === 'All' || m.category === activeCategory;
    const searchMatch = !markerSearch || m.label.toLowerCase().includes(markerSearch.toLowerCase());
    return categoryMatch && searchMatch;
  });

  const handleSave = () => {
    const hasAny = MARKERS.some(m => form[m.key]);
    if (!hasAny) return Alert.alert('Required', 'Enter at least one marker value');
    const values = {};
    MARKERS.forEach(m => {
      if (form[m.key]) values[m.key] = parseFloat(form[m.key]);
    });
    logMut.mutate({ values, notes });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Health Log</Text>
        <TouchableOpacity style={styles.logBtn} onPress={() => { setForm({}); setNotes(''); setShowModal(true); }}>
          <Ionicons name="add" size={18} color={colors.bg} />
          <Text style={styles.logBtnText}>Log</Text>
        </TouchableOpacity>
      </View>

      {/* Tab selector */}
      <View style={styles.tabRow}>
        {['Latest', 'History', 'Reference'].map(tab => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── Category filter ─────────────────────────────────── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity key={cat}
                  style={[styles.catChip, activeCategory === cat && styles.catChipActive]}
                  onPress={() => setActiveCategory(cat)}>
                  <Text style={[styles.catChipText, activeCategory === cat && styles.catChipTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* ── LATEST TAB ─────────────────────────────────────── */}
            {activeTab === 'Latest' && (
              <>
                {latest ? (
                  <>
                    <View style={styles.sessionHeader}>
                      <Ionicons name="calendar" size={14} color={colors.textMuted} />
                      <Text style={styles.sessionDate}>
                        {new Date(latest.logged_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                    {filteredMarkers.map(marker => {
                      const val = latest[marker.key];
                      if (val == null) return null;
                      const status = getStatus(marker, val);
                      const sc = statusColor(colors, status);
                      return (
                        <View key={marker.key} style={styles.markerCard}>
                          <View style={[styles.markerStatus, { backgroundColor: sc + '22' }]}>
                            <Ionicons name={statusIcon(status)} size={18} color={sc} />
                          </View>
                          <View style={styles.markerInfo}>
                            <Text style={styles.markerLabel}>{marker.label}</Text>
                            <Text style={styles.markerDesc}>{marker.desc}</Text>
                          </View>
                          <View style={styles.markerRight}>
                            <Text style={[styles.markerVal, { color: sc }]}>{val}</Text>
                            <Text style={styles.markerUnit}>{marker.unit}</Text>
                          </View>
                        </View>
                      );
                    })}
                    {latest.notes ? (
                      <View style={styles.notesCard}>
                        <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
                        <Text style={styles.notesText}>{latest.notes}</Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View style={styles.empty}>
                    <Ionicons name="heart-outline" size={52} color={colors.textDim} />
                    <Text style={styles.emptyTitle}>No health logs yet</Text>
                    <Text style={styles.emptySub}>Tap "Log" to record your first blood test results</Text>
                  </View>
                )}
              </>
            )}

            {/* ── HISTORY TAB ────────────────────────────────────── */}
            {activeTab === 'History' && (
              <>
                {logs.length === 0 && (
                  <Text style={styles.emptyText}>No entries yet</Text>
                )}
                {logs.map(log => (
                  <View key={log.id} style={styles.histCard}>
                    <View style={styles.histHeader}>
                      <Text style={styles.histDate}>
                        {new Date(log.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </Text>
                      <TouchableOpacity onPress={() => Alert.alert('Delete', 'Remove this health log?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                      ])}>
                        <Ionicons name="trash-outline" size={15} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.histValues}>
                      {MARKERS.filter(m => log[m.key] != null).map(marker => {
                        const status = getStatus(marker, log[marker.key]);
                        const sc = statusColor(colors, status);
                        return (
                          <View key={marker.key} style={styles.histValue}>
                            <View style={[styles.histDot, { backgroundColor: sc }]} />
                            <Text style={styles.histValueText}>{marker.label}: </Text>
                            <Text style={[styles.histValueNum, { color: sc }]}>{log[marker.key]} {marker.unit}</Text>
                          </View>
                        );
                      })}
                    </View>
                    {log.notes ? <Text style={styles.histNotes}>{log.notes}</Text> : null}
                  </View>
                ))}
              </>
            )}

            {/* ── REFERENCE TAB ──────────────────────────────────── */}
            {activeTab === 'Reference' && (
              <>
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={15} color={colors.textDim} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search markers…"
                    placeholderTextColor={colors.textDim}
                    value={markerSearch}
                    onChangeText={setMarkerSearch}
                  />
                </View>
                {filteredMarkers.map(marker => (
                  <View key={marker.key} style={styles.refCard}>
                    <View style={styles.refTop}>
                      <Text style={styles.refLabel}>{marker.label}</Text>
                      <Text style={styles.refUnit}>{marker.unit}</Text>
                    </View>
                    <Text style={styles.refDesc}>{marker.desc}</Text>
                    <View style={styles.refRanges}>
                      <RefRange label="Normal" color={colors.success}
                        range={marker.lowBad
                          ? `${marker.ref.low}–${marker.ref.highNormal}`
                          : marker.inverted
                          ? `> ${marker.ref.low}`
                          : `${marker.ref.low}–${marker.ref.highNormal}`
                        }
                      />
                      <RefRange label="Borderline" color={colors.warning}
                        range={marker.inverted
                          ? `< ${marker.ref.low}`
                          : `${marker.ref.highNormal + 1}–${marker.ref.highWarning}`
                        }
                      />
                      {!marker.inverted && (
                        <RefRange label="High Risk" color={colors.danger} range={`> ${marker.ref.highWarning}`} />
                      )}
                    </View>
                    {latest?.[marker.key] != null && (
                      <View style={styles.refCurrent}>
                        <Text style={styles.refCurrentLabel}>Your last value:</Text>
                        <Text style={[styles.refCurrentVal, { color: statusColor(colors, getStatus(marker, latest[marker.key])) }]}>
                          {latest[marker.key]} {marker.unit}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Log Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Log Blood Test</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {MARKERS.map(marker => (
                <View key={marker.key} style={styles.modalFieldRow}>
                  <View style={styles.modalFieldLeft}>
                    <Text style={styles.modalFieldLabel}>{marker.label}</Text>
                    <Text style={styles.modalFieldUnit}>{marker.unit}</Text>
                  </View>
                  <TextInput
                    style={styles.modalFieldInput}
                    placeholder="0"
                    placeholderTextColor={colors.textDim}
                    value={form[marker.key] ?? ''}
                    onChangeText={v => setForm(p => ({ ...p, [marker.key]: v }))}
                    keyboardType="numeric"
                  />
                </View>
              ))}
              <View style={styles.notesField}>
                <Text style={styles.modalFieldLabel}>Notes (optional)</Text>
                <TextInput
                  style={styles.notesInput}
                  placeholder="e.g. Fasting 12h, feeling tired…"
                  placeholderTextColor={colors.textDim}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={2}
                />
              </View>
            </ScrollView>
            <View style={styles.sheetBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={logMut.isPending}>
                {logMut.isPending
                  ? <ActivityIndicator color={colors.bg} />
                  : <Text style={styles.saveBtnText}>Save</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function RefRange({ label, color, range }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.refRange, { backgroundColor: color + '18', borderColor: color + '44' }]}>
      <View style={[styles.refRangeDot, { backgroundColor: color }]} />
      <Text style={[styles.refRangeLabel, { color }]}>{label}</Text>
      <Text style={styles.refRangeVal}>{range}</Text>
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  logBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.danger, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  logBtnText: { color: '#fff', fontWeight: weight.bold, fontSize: typography.sm },

  tabRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.danger },
  tabText: { fontSize: typography.sm, color: colors.textMuted, fontWeight: weight.medium },
  tabTextActive: { color: colors.danger, fontWeight: weight.bold },

  content: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 10 },
  catRow: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border },
  catChipActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  catChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },
  catChipTextActive: { color: '#fff', fontWeight: weight.bold },

  sessionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12,
  },
  sessionDate: { fontSize: typography.xs, color: colors.textMuted },

  markerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  markerStatus: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  markerInfo: { flex: 1 },
  markerLabel: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  markerDesc: { fontSize: 10, color: colors.textDim, marginTop: 1 },
  markerRight: { alignItems: 'flex-end' },
  markerVal: { fontSize: typography.lg, fontWeight: weight.black },
  markerUnit: { fontSize: 10, color: colors.textDim },

  notesCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.bgCard, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: colors.border, marginTop: 4,
  },
  notesText: { flex: 1, fontSize: typography.xs, color: colors.textMuted },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center' },
  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 30 },

  histCard: {
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
  },
  histHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  histDate: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  histValues: { gap: 4 },
  histValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  histDot: { width: 7, height: 7, borderRadius: 4 },
  histValueText: { fontSize: typography.xs, color: colors.textMuted },
  histValueNum: { fontSize: typography.xs, fontWeight: weight.bold },
  histNotes: { fontSize: typography.xs, color: colors.textDim, marginTop: 8, fontStyle: 'italic' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },

  refCard: {
    backgroundColor: colors.bgCard, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, marginBottom: 8,
  },
  refTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  refLabel: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  refUnit: { fontSize: typography.xs, color: colors.textDim },
  refDesc: { fontSize: 10, color: colors.textDim, marginBottom: 10 },
  refRanges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  refRange: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1,
  },
  refRangeDot: { width: 6, height: 6, borderRadius: 3 },
  refRangeLabel: { fontSize: 10, fontWeight: weight.bold },
  refRangeVal: { fontSize: 10, color: colors.textMuted },
  refCurrent: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8,
  },
  refCurrentLabel: { fontSize: 10, color: colors.textDim },
  refCurrentVal: { fontSize: typography.sm, fontWeight: weight.bold },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: {
    backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 8, maxHeight: '85%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  sheetScroll: { maxHeight: 400 },
  modalFieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalFieldLeft: { flex: 1 },
  modalFieldLabel: { fontSize: typography.xs, color: colors.text, fontWeight: weight.medium },
  modalFieldUnit: { fontSize: 9, color: colors.textDim, marginTop: 1 },
  modalFieldInput: {
    width: 90, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 9,
    color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border,
    textAlign: 'center',
  },
  notesField: { paddingVertical: 10 },
  notesInput: {
    backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10,
    color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border,
    marginTop: 6, minHeight: 60, textAlignVertical: 'top',
  },
  sheetBtns: { flexDirection: 'row', gap: 12, paddingVertical: 16 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.danger, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: weight.bold },
});
