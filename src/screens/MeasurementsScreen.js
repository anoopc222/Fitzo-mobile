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

const SITES = [
  { key: 'chest',       label: 'Chest',        icon: 'body' },
  { key: 'waist',       label: 'Waist',        icon: 'body' },
  { key: 'hips',        label: 'Hips',         icon: 'body' },
  { key: 'left_arm',    label: 'Left Arm',     icon: 'fitness' },
  { key: 'right_arm',   label: 'Right Arm',    icon: 'fitness' },
  { key: 'left_thigh',  label: 'Left Thigh',   icon: 'walk' },
  { key: 'right_thigh', label: 'Right Thigh',  icon: 'walk' },
];

async function fetchMeasurements(userId) {
  const { data, error } = await supabase
    .from('body_measurements')
    .select('id, chest, waist, hips, left_arm, right_arm, left_thigh, right_thigh, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

async function logMeasurements(userId, values) {
  const { error } = await supabase.from('body_measurements').insert({
    user_id: userId,
    ...values,
    logged_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function deleteMeasurement(id) {
  const { error } = await supabase.from('body_measurements').delete().eq('id', id);
  if (error) throw error;
}

function fmt(v) {
  return v != null ? `${Number(v).toFixed(1)}` : '--';
}

function diffColor(diff, colors) {
  if (diff === null || diff === undefined) return colors.textDim;
  if (Math.abs(diff) < 0.1) return colors.textMuted;
  return diff < 0 ? colors.success : colors.warning;
}

export default function MeasurementsScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});

  const { data: logs = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['measurements', user?.id],
    queryFn: () => fetchMeasurements(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logMut = useMutation({
    mutationFn: (values) => logMeasurements(user.id, values),
    onSuccess: () => {
      qc.invalidateQueries(['measurements', user.id]);
      setShowModal(false);
      setForm({});
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deleteMeasurement,
    onSuccess: () => qc.invalidateQueries(['measurements', user.id]),
  });

  const latest = logs[0];
  const previous = logs[1];

  const handleSave = () => {
    const hasAny = SITES.some(s => form[s.key]);
    if (!hasAny) return Alert.alert('Required', 'Enter at least one measurement');
    const values = {};
    SITES.forEach(s => {
      if (form[s.key]) values[s.key] = parseFloat(form[s.key]);
    });
    logMut.mutate(values);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Measurements</Text>
        <TouchableOpacity style={styles.logBtn} onPress={() => { setForm({}); setShowModal(true); }}>
          <Ionicons name="add" size={18} color={colors.bg} />
          <Text style={styles.logBtnText}>Log</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Latest vs Previous comparison */}
            {latest ? (
              <View style={styles.compCard}>
                <View style={styles.compHeader}>
                  <Text style={styles.compTitle}>Current Measurements</Text>
                  <Text style={styles.compDate}>
                    {new Date(latest.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>

                {/* Column headers */}
                <View style={styles.compRow}>
                  <Text style={[styles.compCell, styles.compLabelCell]} />
                  <Text style={[styles.compCell, styles.compHeaderCell]}>NOW (cm)</Text>
                  <Text style={[styles.compCell, styles.compHeaderCell]}>PREV</Text>
                  <Text style={[styles.compCell, styles.compHeaderCell]}>DIFF</Text>
                </View>

                {SITES.map(site => {
                  const curr = latest[site.key];
                  const prev = previous?.[site.key];
                  const diff = (curr != null && prev != null) ? curr - prev : null;
                  return (
                    <View key={site.key} style={styles.compRow}>
                      <Text style={[styles.compCell, styles.compLabelCell]}>{site.label}</Text>
                      <Text style={[styles.compCell, styles.compValCell, { color: colors.accent }]}>
                        {fmt(curr)}
                      </Text>
                      <Text style={[styles.compCell, styles.compValCell]}>
                        {fmt(prev)}
                      </Text>
                      <Text style={[styles.compCell, styles.compDiffCell, { color: diffColor(diff, colors) }]}>
                        {diff !== null ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` : '--'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.empty}>
                <Ionicons name="body-outline" size={52} color={colors.textDim} />
                <Text style={styles.emptyTitle}>No measurements yet</Text>
                <Text style={styles.emptySub}>Tap "Log" to record your first measurements</Text>
              </View>
            )}

            {/* History */}
            {logs.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>History</Text>
                {logs.map((log, idx) => (
                  <View key={log.id} style={styles.historyItem}>
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyDate}>
                        {new Date(log.logged_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </Text>
                      <View style={styles.historyValues}>
                        {SITES.filter(s => log[s.key] != null).map(site => (
                          <Text key={site.key} style={styles.historyValue}>
                            {site.label}: <Text style={styles.historyValueNum}>{fmt(log[site.key])}</Text>
                          </Text>
                        ))}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => Alert.alert('Delete', 'Remove this measurement entry?', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                      ])}
                      style={styles.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textDim} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Log Modal */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Log Measurements</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetSub}>Enter values in centimetres (cm)</Text>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {SITES.map(site => (
                <View key={site.key} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{site.label}</Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder={`cm (optional)`}
                    placeholderTextColor={colors.textDim}
                    value={form[site.key] ?? ''}
                    onChangeText={v => setForm(p => ({ ...p, [site.key]: v }))}
                    keyboardType="numeric"
                  />
                </View>
              ))}
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

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  logBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  logBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.sm },
  content: { paddingHorizontal: 16, paddingBottom: 32 },

  compCard: {
    backgroundColor: colors.bgCard, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
  },
  compHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  compTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  compDate: { fontSize: typography.xs, color: colors.textMuted },
  compRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  compCell: { flex: 1, textAlign: 'center' },
  compLabelCell: { flex: 1.4, textAlign: 'left', fontSize: typography.xs, color: colors.text, fontWeight: weight.medium },
  compHeaderCell: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 0.5 },
  compValCell: { fontSize: typography.sm, color: colors.text, fontWeight: weight.semibold },
  compDiffCell: { fontSize: typography.xs, fontWeight: weight.bold },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center' },

  card: {
    backgroundColor: colors.bgCard, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text, marginBottom: 12 },
  historyItem: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
  },
  historyLeft: { flex: 1 },
  historyDate: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.semibold, marginBottom: 4 },
  historyValues: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  historyValue: { fontSize: 10, color: colors.textMuted },
  historyValueNum: { color: colors.text, fontWeight: weight.semibold },
  deleteBtn: { padding: 4 },

  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000088' },
  sheet: {
    backgroundColor: colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 8, maxHeight: '80%',
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  sheetSub: { fontSize: typography.xs, color: colors.textDim, marginBottom: 14 },
  sheetScroll: { maxHeight: 340 },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  fieldLabel: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  fieldInput: {
    width: 100, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10,
    color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border,
    textAlign: 'center',
  },
  sheetBtns: { flexDirection: 'row', gap: 12, paddingVertical: 16 },
  cancelBtn: {
    flex: 1, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  cancelBtnText: { color: colors.textMuted, fontWeight: weight.semibold },
  saveBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold },
});
