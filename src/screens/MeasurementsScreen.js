import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import { typography, weight } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import PaywallModal from '../components/ui/PaywallModal';
import CircularGauge from '../components/CircularGauge';
import ScreenHeader from '../components/ScreenHeader';

const SITES = [
  { key: 'chest',       label: 'Chest',        icon: 'body',    dir: 'up' },
  { key: 'waist',       label: 'Waist',        icon: 'body',    dir: 'down' },
  { key: 'hips',        label: 'Hips',         icon: 'body',    dir: 'neutral' },
  { key: 'left_arm',    label: 'L.Arm',        icon: 'fitness', dir: 'up' },
  { key: 'right_arm',   label: 'R.Arm',        icon: 'fitness', dir: 'up' },
  { key: 'left_thigh',  label: 'L.Thigh',      icon: 'walk',    dir: 'up' },
  { key: 'right_thigh', label: 'R.Thigh',      icon: 'walk',    dir: 'up' },
  { key: 'neck',        label: 'Neck',         icon: 'body',    dir: 'down' },
  { key: 'calf_left',   label: 'L.Calf',       icon: 'walk',    dir: 'up' },
  { key: 'calf_right',  label: 'R.Calf',       icon: 'walk',    dir: 'up' },
];
const SITE_BY_KEY = Object.fromEntries(SITES.map(s => [s.key, s]));
const SYMMETRY_PAIRS = [
  { label: 'Arms',   l: 'left_arm',    r: 'right_arm',   icon: 'fitness' },
  { label: 'Thighs', l: 'left_thigh',  r: 'right_thigh', icon: 'walk' },
  { label: 'Calves', l: 'calf_left',   r: 'calf_right',  icon: 'walk' },
];
const PROGRESS_SITES = ['chest', 'waist', 'hips', 'left_arm', 'right_arm'];

async function fetchMeasurements(userId) {
  const { data, error } = await supabase
    .from('body_measurements')
    .select('id, chest, waist, hips, left_arm, right_arm, left_thigh, right_thigh, neck, calf_left, calf_right, logged_at')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return data ?? [];
}

async function fetchBodyStats(userId) {
  const [profile, weight] = await Promise.all([
    supabase.from('profiles').select('height_cm, sex').eq('id', userId).single(),
    supabase.from('weight_logs').select('weight').eq('user_id', userId).order('logged_at', { ascending: false }).limit(1),
  ]);
  return {
    heightCm: profile.data?.height_cm ?? null,
    sex: profile.data?.sex ?? null,
    weightKg: weight.data?.[0]?.weight ?? null,
  };
}

function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function logMeasurements(userId, values, date) {
  const { error } = await supabase.from('body_measurements').insert({
    user_id: userId,
    ...values,
    logged_at: new Date(`${date}T00:00:00`).toISOString(),
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

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function trendColor(diff, dir, colors) {
  if (diff === null || diff === undefined || Math.abs(diff) < 0.05 || dir === 'neutral') return colors.textMuted;
  const improved = dir === 'down' ? diff < 0 : diff > 0;
  return improved ? colors.success : colors.danger;
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}

function personalBest(logsAll, key, dir) {
  const withVal = logsAll.filter(l => l[key] != null);
  if (!withVal.length) return null;
  const best = withVal.reduce((b, l) => {
    if (!b) return l;
    if (dir === 'down') return l[key] < b[key] ? l : b;
    return l[key] > b[key] ? l : b;
  }, null);
  return best ? { value: best[key], date: best.logged_at } : null;
}

function rateOfChange(logsAsc, key) {
  const withVal = logsAsc.filter(l => l[key] != null);
  if (withVal.length < 2) return null;
  const first = withVal[0];
  const last = withVal[withVal.length - 1];
  const days = daysBetween(first.logged_at, last.logged_at);
  if (days <= 0) return null;
  return { perWeek: +(((last[key] - first[key]) / days) * 7).toFixed(2), logs: withVal.length, days };
}

function clampScore(v) {
  return Math.round(Math.max(0, Math.min(100, v)));
}

function ratioScore(value, threshold, betterWhenLower) {
  const ratio = value / threshold;
  let score;
  if (betterWhenLower) {
    score = ratio <= 1 ? 100 - (1 - ratio) * 40 : 100 - (ratio - 1) * 150;
  } else {
    score = ratio >= 1 ? 100 - (ratio - 1) * 40 : 100 - (1 - ratio) * 150;
  }
  return clampScore(score);
}

function bmiInfo(bmi) {
  if (bmi == null) return null;
  let category, color;
  if (bmi < 18.5) { category = 'Underweight'; color = 'warn'; }
  else if (bmi < 25) { category = 'Normal'; color = 'good'; }
  else if (bmi < 30) { category = 'Overweight'; color = 'warn'; }
  else { category = 'Obese'; color = 'danger'; }
  return { value: bmi, category, color, score: clampScore(100 - Math.abs(bmi - 22) * 7) };
}

// Catmull-Rom -> cubic-bezier smoothing for a polyline's points
function smoothPath(pts) {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  let d = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function ProgressChart({ logsAsc, site, colors, width, dir }) {
  const H = 150;
  const P = { t: 16, r: 8, b: 18, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  const pts = logsAsc.filter(l => l[site] != null).map(l => ({ v: l[site], d: l.logged_at }));

  if (pts.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Not enough data yet</Text>
      </View>
    );
  }

  const vals = pts.map(p => p.v);
  const maxV = Math.max(...vals);
  const minV = Math.min(...vals);
  const range = (maxV - minV) || 1;
  const toX = i => P.l + (i * pw) / Math.max(pts.length - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const linePts = pts.map((p, i) => ({ x: toX(i), y: toY(p.v) }));
  const line = smoothPath(linePts);

  const change = +(vals[vals.length - 1] - vals[0]).toFixed(1);
  const changeColor = trendColor(change, dir, colors);
  const days = daysBetween(pts[0].d, pts[pts.length - 1].d);

  return (
    <View>
      <Svg width={width} height={H}>
        <Line x1={P.l} y1={H - P.b} x2={width - P.r} y2={H - P.b} stroke={colors.border} strokeWidth={1} />
        <Path d={line} fill="none" stroke={colors.purple} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {linePts.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={i === linePts.length - 1 ? 4 : 2.5} fill={colors.purple} />
        ))}
      </Svg>
      <View style={styles_static.chartStatsRow}>
        <View style={styles_static.chartStatCell}>
          <Text style={[styles_static.chartStatLabel, { color: colors.textDim }]}>{fmtDate(pts[0].d)}</Text>
          <Text style={[styles_static.chartStatVal, { color: colors.text }]}>{fmt(vals[0])}cm</Text>
        </View>
        <View style={styles_static.chartStatCell}>
          <Text style={[styles_static.chartStatLabel, { color: colors.textDim }]}>OVER {days}d</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {Math.abs(change) >= 0.05 && (
              <Ionicons name={change > 0 ? 'arrow-up' : 'arrow-down'} size={11} color={changeColor} />
            )}
            <Text style={[styles_static.chartStatVal, { color: Math.abs(change) >= 0.05 ? changeColor : colors.textMuted }]}>
              {Math.abs(change) >= 0.05 ? `${change > 0 ? '+' : ''}${change}cm` : 'No change'}
            </Text>
          </View>
        </View>
        <View style={[styles_static.chartStatCell, { alignItems: 'flex-end' }]}>
          <Text style={[styles_static.chartStatLabel, { color: colors.textDim }]}>{fmtDate(pts[pts.length - 1].d)}</Text>
          <Text style={[styles_static.chartStatVal, { color: colors.text }]}>{fmt(vals[vals.length - 1])}cm</Text>
        </View>
      </View>
    </View>
  );
}

const styles_static = StyleSheet.create({
  chartStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  chartStatCell: { alignItems: 'flex-start' },
  chartStatLabel: { fontSize: 9, fontWeight: weight.bold, letterSpacing: 0.5, marginBottom: 2 },
  chartStatVal: { fontSize: typography.sm, fontWeight: weight.bold },
});

export default function MeasurementsScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { hasAccess } = useSubscription();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [progressSite, setProgressSite] = useState('waist');
  const [compareOldIdx, setCompareOldIdx] = useState(1);
  const [compareNewIdx, setCompareNewIdx] = useState(0);
  const [openPicker, setOpenPicker] = useState(null);

  const { data: logs = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['measurements', user?.id],
    queryFn: () => fetchMeasurements(user.id),
    enabled: !!user?.id,
  });

  const { data: bodyStats } = useQuery({
    queryKey: ['measurements-bodystats', user?.id],
    queryFn: () => fetchBodyStats(user.id),
    enabled: !!user?.id,
  });

  const logMut = useMutation({
    mutationFn: ({ values, date }) => logMeasurements(user.id, values, date),
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
  const logsAsc = useMemo(() => [...logs].reverse(), [logs]);

  const whr = (latest?.waist != null && latest?.hips != null) ? +(latest.waist / latest.hips).toFixed(2) : null;
  const whrThreshold = bodyStats?.sex === 'female' ? 0.75 : 0.85;
  const waistToHeight = (latest?.waist != null && bodyStats?.heightCm) ? +(latest.waist / bodyStats.heightCm).toFixed(2) : null;
  const chestToWaist = (latest?.chest != null && latest?.waist) ? +(latest.chest / latest.waist).toFixed(2) : null;
  const bmi = (bodyStats?.weightKg != null && bodyStats?.heightCm) ? +(bodyStats.weightKg / ((bodyStats.heightCm / 100) ** 2)).toFixed(1) : null;
  const bmiData = bmiInfo(bmi);

  const personalBests = useMemo(() => SITES.map(s => ({ ...s, pb: personalBest(logs, s.key, s.dir) })).filter(s => s.pb), [logs]);
  const rates = useMemo(() => SITES.map(s => ({ ...s, rate: rateOfChange(logsAsc, s.key) })).filter(s => s.rate), [logsAsc]);

  const consistencyScore = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const count = logs.filter(l => new Date(l.logged_at).getTime() >= cutoff).length;
    return clampScore((count / 4) * 100);
  }, [logs]);

  const whrScore = whr != null ? ratioScore(whr, whrThreshold, true) : null;
  const waistHeightScore = waistToHeight != null ? ratioScore(waistToHeight, 0.5, true) : null;
  const bodyScoreParts = [bmiData?.score, whrScore, waistHeightScore, consistencyScore].filter(v => v != null);
  const bodyScore = bodyScoreParts.length ? Math.round(bodyScoreParts.reduce((a, b) => a + b, 0) / bodyScoreParts.length) : null;
  const bodyScoreLabel = bodyScore == null ? '' : bodyScore >= 85 ? 'Elite' : bodyScore >= 70 ? 'Fit' : bodyScore >= 50 ? 'Average' : 'Needs Focus';
  const bodyScoreSub = bodyScore == null ? 'Log more data to unlock your score' : bodyScore >= 85 ? 'Excellent shape across the board.' : bodyScore >= 70 ? 'Solid foundation, room to grow.' : bodyScore >= 50 ? 'On track — stay consistent.' : 'Focus on consistency and ratios.';

  const handleSave = () => {
    const hasAny = SITES.some(s => form[s.key]);
    if (!hasAny) return Alert.alert('Required', 'Enter at least one measurement');
    if (!logDate) return Alert.alert('Required', 'Select a date');
    const values = {};
    SITES.forEach(s => {
      if (form[s.key]) values[s.key] = parseFloat(form[s.key]);
    });
    logMut.mutate({ values, date: logDate });
  };

  const openProModal = (setter) => {
    if (!hasAccess) { setShowPaywall(true); return; }
    setter(true);
  };

  const entryOld = logs[compareOldIdx];
  const entryNew = logs[compareNewIdx];

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader
        title="MEASUREMENTS"
        colors={colors}
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Analytics / Insights preview cards — always visible so free users can discover Pro features */}
            <View style={styles.previewRow}>
              <TouchableOpacity style={styles.previewCard} activeOpacity={0.85} onPress={() => openProModal(setShowAnalytics)}>
                <View style={styles.previewTopRow}>
                  <Text style={styles.previewIcon}>📊</Text>
                  {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
                </View>
                <Text style={styles.previewTitle}>Analytics</Text>
                <View style={styles.previewChips}>
                  <Text style={styles.previewChip}>🏆 BESTS</Text>
                  <Text style={styles.previewChip}>🥇 SCORE</Text>
                </View>
                <Text style={styles.previewSub}>{bmiData ? `BMI ${bmiData.value} · ${personalBests.length} PBs` : (latest ? `${personalBests.length} PBs logged` : 'Log measurements to unlock')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.previewCard} activeOpacity={0.85} onPress={() => openProModal(setShowInsights)}>
                <View style={styles.previewTopRow}>
                  <Text style={styles.previewIcon}>🔬</Text>
                  {!hasAccess && <Ionicons name="lock-closed" size={12} color={colors.textDim} />}
                </View>
                <Text style={styles.previewTitle}>Insights</Text>
                <View style={styles.previewChips}>
                  <Text style={styles.previewChip}>⚖️ SYMMETRY</Text>
                  <Text style={styles.previewChip}>📐 RATIOS</Text>
                </View>
                <Text style={styles.previewSub}>{whr != null ? `WHR ${whr} · ${rates.length} rates` : 'Log more to unlock'}</Text>
              </TouchableOpacity>
            </View>

            {!latest ? (
              <View style={styles.empty}>
                <Ionicons name="body-outline" size={52} color={colors.textDim} />
                <Text style={styles.emptyTitle}>No measurements yet</Text>
                <Text style={styles.emptySub}>Tap "Log" to record your first measurements</Text>
              </View>
            ) : (
              <>

            {/* Body Map */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardTitleCaps}>📐 BODY MAP</Text>
                {whr != null && (
                  <View style={styles.whrBadge}>
                    <Text style={styles.whrBadgeText}>WHR {whr}</Text>
                  </View>
                )}
              </View>
              <View style={styles.bodyMapRow}>
                <BodySilhouette logs={latest} colors={colors} />
                <View style={styles.bodyMapList}>
                  {SITES.filter(s => latest[s.key] != null).slice(0, 6).map(s => {
                    const diff = previous?.[s.key] != null ? latest[s.key] - previous[s.key] : null;
                    const color = trendColor(diff, s.dir, colors);
                    return (
                      <View key={s.key} style={styles.bodyMapItem}>
                        <View style={[styles.bodyMapDot, { backgroundColor: color }]} />
                        <Text style={styles.bodyMapLabel}>{s.label}</Text>
                        <Text style={styles.bodyMapValue}>
                          {fmt(latest[s.key])}
                          {diff != null && Math.abs(diff) >= 0.05 && (
                            <Ionicons name={diff > 0 ? 'arrow-up' : 'arrow-down'} size={10} color={color} />
                          )}
                          {' '}<Text style={styles.bodyMapUnit}>cm</Text>
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
              {previous && (
                <View style={styles.sinceRow}>
                  <Text style={styles.sinceLabel}>Since {fmtDate(logs[logs.length - 1].logged_at)} ({daysBetween(logs[logs.length - 1].logged_at, latest.logged_at)}d):</Text>
                  <View style={styles.sinceChips}>
                    {['waist', 'chest'].map(k => {
                      const first = logs[logs.length - 1][k];
                      if (first == null || latest[k] == null) return null;
                      const diff = +(latest[k] - first).toFixed(1);
                      const color = trendColor(diff, SITE_BY_KEY[k].dir, colors);
                      return (
                        <View key={k} style={[styles.sinceChip, { borderColor: color }]}>
                          <Text style={[styles.sinceChipText, { color }]}>{SITE_BY_KEY[k].label} {diff > 0 ? '+' : ''}{diff}cm</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* Progress Chart */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Progress Chart</Text>
              <View style={styles.tabRow}>
                {PROGRESS_SITES.map(key => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.tabBtn, progressSite === key && styles.tabBtnActive]}
                    onPress={() => setProgressSite(key)}
                  >
                    <Text style={[styles.tabBtnText, progressSite === key && styles.tabBtnTextActive]}>{SITE_BY_KEY[key].label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <ProgressChart logsAsc={logsAsc} site={progressSite} colors={colors} width={328} dir={SITE_BY_KEY[progressSite].dir} />
            </View>

            {/* Compare Entries */}
            <TouchableOpacity style={styles.compareBtn} activeOpacity={0.85} onPress={() => { setCompareOldIdx(Math.min(1, logs.length - 1)); setCompareNewIdx(0); setShowCompare(true); }}>
              <Ionicons name="swap-horizontal" size={16} color={colors.accent} />
              <Text style={styles.compareBtnText}>Compare Entries</Text>
            </TouchableOpacity>

            {/* History */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>History</Text>
              {logs.map((log) => (
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
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => { setForm({}); setLogDate(localDateStr(new Date())); setShowModal(true); }}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      {/* Log Modal */}
      <BottomSheet visible={showModal} onClose={() => setShowModal(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Log Measurements</Text>
          <TouchableOpacity onPress={() => setShowModal(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sheetSub}>Enter values in centimetres (cm)</Text>
        <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Date</Text>
            <DatePickerField
              value={logDate}
              onChange={setLogDate}
              colors={colors}
              maxDate={localDateStr(new Date())}
              style={{ width: 140 }}
            />
          </View>
          {SITES.map(site => (
            <View key={site.key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{site.label}</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="cm"
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
      </BottomSheet>

      {/* Analytics Modal */}
      <BottomSheet visible={showAnalytics} onClose={() => setShowAnalytics(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>📊 Analytics</Text>
          <TouchableOpacity onPress={() => setShowAnalytics(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sheetScrollTall} showsVerticalScrollIndicator={false}>
          <View style={[styles.subCard, { borderColor: colors.accent + '55' }]}>
            <Text style={styles.subCardTitleCaps}>🏆 PERSONAL BESTS</Text>
            <View style={styles.pbGrid}>
              {personalBests.map(s => (
                <View key={s.key} style={styles.pbCell}>
                  <Text style={styles.pbValue}>{fmt(s.pb.value)}cm</Text>
                  <Text style={styles.pbLabel}>{s.label.toUpperCase()}</Text>
                  <Text style={styles.pbDate}>{fmtDate(s.pb.date)}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>⚕️ HEALTH METRICS</Text>
            {bmiData ? (
              <View style={styles.bmiBox}>
                <Text style={[styles.bmiValue, { color: colors[bmiData.color] }]}>{bmiData.value}</Text>
                <Text style={styles.bmiLabel}>BMI</Text>
                <View style={[styles.bmiPill, { backgroundColor: colors[bmiData.color] + '22' }]}>
                  <Text style={[styles.bmiPillText, { color: colors[bmiData.color] }]}>{bmiData.category}</Text>
                </View>
                <View style={styles.bmiBar}>
                  <View style={[styles.bmiBarFill, { width: `${bmiData.score}%`, backgroundColor: colors[bmiData.color] }]} />
                </View>
              </View>
            ) : (
              <Text style={styles.muted}>Log your weight and height to see BMI</Text>
            )}
          </View>

          <View style={[styles.subCard, { borderColor: colors.purple + '55' }]}>
            <View style={styles.scoreHeaderRow}>
              <CircularGauge percent={bodyScore ?? 0} size={64} strokeWidth={6} color={colors.accent} bgColor={colors.border} value={bodyScore ?? '--'} label="/100" />
              <View style={styles.scoreTextCol}>
                <Text style={styles.subCardTitleCaps}>🥇 BODY SCORE</Text>
                <Text style={[styles.scoreLabel, { color: colors.accent }]}>{bodyScoreLabel}</Text>
                <Text style={styles.scoreSub}>{bodyScoreSub}</Text>
              </View>
            </View>
            {[
              { label: 'BMI', score: bmiData?.score, color: colors.blue },
              { label: 'WHR', score: whrScore, color: colors.pink },
              { label: 'Waist:Height', score: waistHeightScore, color: colors.accent },
              { label: 'Consistency', score: consistencyScore, color: colors.good },
            ].filter(b => b.score != null).map(b => (
              <View key={b.label} style={styles.scoreBarRow}>
                <Text style={styles.scoreBarLabel}>{b.label}</Text>
                <View style={styles.scoreBarTrack}>
                  <View style={[styles.scoreBarFill, { width: `${b.score}%`, backgroundColor: b.color }]} />
                </View>
                <Text style={styles.scoreBarVal}>{b.score}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </BottomSheet>

      {/* Insights Modal */}
      <BottomSheet visible={showInsights} onClose={() => setShowInsights(false)} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>🔬 Insights</Text>
          <TouchableOpacity onPress={() => setShowInsights(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.sheetScrollTall} showsVerticalScrollIndicator={false}>
          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>⚖️ SYMMETRY TRACKER</Text>
            {SYMMETRY_PAIRS.map(pair => {
              const lv = latest?.[pair.l];
              const rv = latest?.[pair.r];
              if (lv == null || rv == null) return null;
              const diff = +(lv - rv).toFixed(1);
              const balanced = Math.abs(diff) <= 1;
              return (
                <View key={pair.label} style={styles.symRow}>
                  <Ionicons name={pair.icon} size={15} color={colors.accent} style={{ width: 20 }} />
                  <Text style={styles.symLabel}>{pair.label}</Text>
                  <Text style={styles.symValues}>{fmt(lv)} / {fmt(rv)} cm</Text>
                  <View style={styles.symTrack}>
                    <View style={[styles.symMarker, { left: `${50 + Math.max(-40, Math.min(40, diff * 10))}%`, backgroundColor: balanced ? colors.good : colors.warn }]} />
                  </View>
                  {balanced
                    ? <Ionicons name="checkmark" size={16} color={colors.good} />
                    : <Text style={[styles.symDiff, { color: colors.warn }]}>{diff > 0 ? '+' : ''}{diff}</Text>}
                </View>
              );
            })}
          </View>

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>📐 PHYSIQUE RATIOS</Text>
            {whr != null && (
              <RatioRow icon="infinite-outline" label="Waist-to-Hip (WHR)" sub={`< ${whrThreshold} threshold`} value={whr} good={whr <= whrThreshold} colors={colors} />
            )}
            {waistToHeight != null && (
              <RatioRow icon="resize-outline" label="Waist-to-Height" sub="< 0.50 (universal)" value={waistToHeight} good={waistToHeight <= 0.5} colors={colors} />
            )}
            {chestToWaist != null && (
              <RatioRow icon="barbell-outline" label="Chest-to-Waist" sub="≥ 1.35 (athletic V-taper)" value={chestToWaist} good={chestToWaist >= 1.35} colors={colors} goodLabel="Athletic" badLabel="Room to grow" />
            )}
            {whr == null && waistToHeight == null && chestToWaist == null && (
              <Text style={styles.muted}>Log waist, hips and chest together to see ratios</Text>
            )}
          </View>

          <View style={styles.subCard}>
            <Text style={styles.subCardTitleCaps}>📈 RATE OF CHANGE</Text>
            {rates.map(s => (
              <View key={s.key} style={styles.rateRow}>
                <Ionicons name={s.icon} size={15} color={colors.accent} style={{ width: 20 }} />
                <Text style={styles.rateLabel}>{s.label}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.rateVal, { color: trendColor(s.rate.perWeek, s.dir, colors) }]}>
                    {s.rate.perWeek > 0 ? '+' : ''}{s.rate.perWeek}cm/wk
                  </Text>
                  <Text style={styles.rateSub}>{s.rate.logs} logs · {s.rate.days}d</Text>
                </View>
              </View>
            ))}
            {rates.length === 0 && <Text style={styles.muted}>Log the same site twice to see rate of change</Text>}
            {rates.length > 0 && <Text style={styles.footnote}>Avg per week, based on first vs latest log per site</Text>}
          </View>
        </ScrollView>
      </BottomSheet>

      {/* Compare Entries Modal */}
      <BottomSheet visible={showCompare} onClose={() => { setShowCompare(false); setOpenPicker(null); }} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Compare Entries</Text>
          <TouchableOpacity onPress={() => { setShowCompare(false); setOpenPicker(null); }}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.compareSelectRow}>
          <View style={styles.compareSelectCol}>
            <Text style={styles.compareSelectLabel}>OLDER</Text>
            <TouchableOpacity style={styles.compareSelectBtn} onPress={() => setOpenPicker(openPicker === 'OLD' ? null : 'OLD')}>
              <Text style={styles.compareSelectBtnText}>{entryOld ? fmtDate(entryOld.logged_at) : '--'}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Ionicons name="arrow-forward" size={16} color={colors.textDim} style={{ marginTop: 22 }} />
          <View style={styles.compareSelectCol}>
            <Text style={styles.compareSelectLabel}>NEWER</Text>
            <TouchableOpacity style={styles.compareSelectBtn} onPress={() => setOpenPicker(openPicker === 'NEW' ? null : 'NEW')}>
              <Text style={styles.compareSelectBtnText}>{entryNew ? fmtDate(entryNew.logged_at) : '--'}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
        {openPicker && (
          <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
            {logs.map((l, idx) => (
              <TouchableOpacity
                key={l.id}
                style={styles.pickerItem}
                onPress={() => {
                  if (openPicker === 'OLD') {
                    if (new Date(l.logged_at) >= new Date(entryNew.logged_at)) {
                      Alert.alert('Invalid selection', 'The older entry must be before the newer entry. Please reselect.');
                      return;
                    }
                    setCompareOldIdx(idx);
                  } else {
                    if (new Date(l.logged_at) <= new Date(entryOld.logged_at)) {
                      Alert.alert('Invalid selection', 'The newer entry must be after the older entry. Please reselect.');
                      return;
                    }
                    setCompareNewIdx(idx);
                  }
                  setOpenPicker(null);
                }}
              >
                <Text style={styles.pickerItemText}>{fmtDate(l.logged_at)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {entryOld && entryNew && (
          <ScrollView style={styles.sheetScrollTall}>
            <View style={styles.compareHeaderRow}>
              <Text style={styles.compareHeaderCell}>Old · {fmtDate(entryOld.logged_at)}</Text>
              <Text style={styles.compareHeaderCell}>New · {fmtDate(entryNew.logged_at)}</Text>
            </View>
            {SITES.filter(s => entryOld[s.key] != null || entryNew[s.key] != null).map(s => {
              const ov = entryOld[s.key];
              const nv = entryNew[s.key];
              const diff = (ov != null && nv != null) ? +(nv - ov).toFixed(1) : null;
              const balanced = diff !== null && Math.abs(diff) < 0.05;
              const color = trendColor(diff, s.dir, colors);
              return (
                <View key={s.key} style={styles.compareRow}>
                  <Text style={styles.compareLabel}>{s.label}</Text>
                  <Text style={styles.compareVal}>{fmt(ov)}cm</Text>
                  <Text style={styles.compareVal}>{fmt(nv)}cm</Text>
                  {diff === null ? (
                    <Text style={styles.compareDiffMuted}>--</Text>
                  ) : balanced ? (
                    <View style={styles.compareDiffChip}><Text style={styles.compareDiffMuted}>= same</Text></View>
                  ) : (
                    <View style={[styles.compareDiffChip, { backgroundColor: color + '22' }]}>
                      <Ionicons name={diff > 0 ? 'arrow-up' : 'arrow-down'} size={11} color={color} />
                      <Text style={[styles.compareDiffText, { color }]}>{diff > 0 ? '+' : ''}{diff}cm</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </BottomSheet>

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

function RatioRow({ icon, label, sub, value, good, colors, goodLabel = 'Healthy', badLabel = 'Watch' }) {
  return (
    <View style={styles_static2.ratioRow}>
      <Ionicons name={icon} size={16} color={colors.textMuted} style={{ width: 22 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles_static2.ratioLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles_static2.ratioSub, { color: colors.textDim }]}>{sub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles_static2.ratioVal, { color: good ? colors.good : colors.warn }]}>{value}</Text>
        <Text style={[styles_static2.ratioTag, { color: good ? colors.good : colors.textMuted }]}>{good ? goodLabel : badLabel}</Text>
      </View>
    </View>
  );
}

function BodySilhouette({ logs, colors }) {
  const c = (key) => {
    const dir = SITE_BY_KEY[key]?.dir;
    return dir === 'neutral' || logs[key] == null ? colors.textDim : colors.purple;
  };
  return (
    <View style={styles_static2.silhouette}>
      <View style={[styles_static2.head, { borderColor: colors.textDim }]} />
      <View style={[styles_static2.band, { height: 26, borderColor: c('chest') }]} />
      <View style={[styles_static2.band, { height: 22, borderColor: c('waist') }]} />
      <View style={[styles_static2.band, { height: 24, borderColor: c('hips') }]} />
      <View style={styles_static2.legsRow}>
        <View style={[styles_static2.leg, { borderColor: c('left_thigh') }]} />
        <View style={[styles_static2.leg, { borderColor: c('right_thigh') }]} />
      </View>
    </View>
  );
}

const styles_static2 = StyleSheet.create({
  silhouette: { width: 70, alignItems: 'center' },
  head: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, marginBottom: 4 },
  band: { width: 52, borderWidth: 2, borderRadius: 8, marginBottom: 2 },
  legsRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  leg: { width: 18, height: 38, borderWidth: 2, borderRadius: 8 },
  ratioRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, gap: 4 },
  ratioLabel: { fontSize: typography.sm, fontWeight: weight.semibold },
  ratioSub: { fontSize: 10, marginTop: 1 },
  ratioVal: { fontSize: typography.md, fontWeight: weight.black },
  ratioTag: { fontSize: 10, fontWeight: weight.semibold, marginTop: 1 },
});

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },
  content: { paddingHorizontal: 16, paddingBottom: 90 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.textMuted },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center' },

  previewRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  previewCard: {
    flex: 1, backgroundColor: colors.bgCard, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  previewTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewIcon: { fontSize: 20 },
  previewTitle: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, marginTop: 6 },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  previewChip: {
    fontSize: 9, color: colors.textMuted, backgroundColor: colors.bgElevated,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, fontWeight: weight.bold,
  },
  previewSub: { fontSize: 10, color: colors.textDim, marginTop: 8 },

  card: {
    backgroundColor: colors.bgCard, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
  },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text, marginBottom: 12 },
  cardTitleCaps: { fontSize: 11, fontWeight: weight.bold, letterSpacing: 1, color: colors.textMuted },
  whrBadge: { backgroundColor: colors.good + '22', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  whrBadgeText: { fontSize: 11, fontWeight: weight.bold, color: colors.good },

  bodyMapRow: { flexDirection: 'row', gap: 16 },
  bodyMapList: { flex: 1, gap: 8 },
  bodyMapItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bodyMapDot: { width: 8, height: 8, borderRadius: 4 },
  bodyMapLabel: { flex: 1, fontSize: typography.sm, color: colors.textMuted },
  bodyMapValue: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  bodyMapUnit: { fontSize: 10, color: colors.textDim, fontWeight: weight.normal },

  sinceRow: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  sinceLabel: { fontSize: 10, color: colors.textDim, marginBottom: 8 },
  sinceChips: { flexDirection: 'row', gap: 8 },
  sinceChip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  sinceChipText: { fontSize: 11, fontWeight: weight.bold },

  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tabBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  tabBtnActive: { backgroundColor: colors.purple + '22', borderColor: colors.purple },
  tabBtnText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },
  tabBtnTextActive: { color: colors.purple },

  compareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: colors.accent + '55',
    paddingVertical: 13, marginBottom: 14,
  },
  compareBtnText: { color: colors.accent, fontWeight: weight.bold, fontSize: typography.sm },

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

  sheet: { paddingBottom: 8 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  sheetSub: { fontSize: typography.xs, color: colors.textDim, marginBottom: 14 },
  sheetScroll: { maxHeight: 340 },
  sheetScrollTall: { maxHeight: 480 },
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

  subCard: {
    backgroundColor: colors.bgElevated, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: colors.border, marginVertical: 6,
  },
  subCardTitleCaps: { fontSize: 11, fontWeight: weight.bold, letterSpacing: 1, color: colors.textMuted, marginBottom: 8 },
  muted: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', paddingVertical: 6 },
  footnote: { fontSize: 10, color: colors.textDim, textAlign: 'center', marginTop: 4 },

  pbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pbCell: { flexBasis: '23%', backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  pbValue: { fontSize: typography.sm, fontWeight: weight.black, color: colors.accent },
  pbLabel: { fontSize: 8, color: colors.textDim, fontWeight: weight.bold, marginTop: 2 },
  pbDate: { fontSize: 8, color: colors.textDim, marginTop: 1 },

  bmiBox: { alignItems: 'center', paddingVertical: 2 },
  bmiValue: { fontSize: 26, fontWeight: weight.black },
  bmiLabel: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 1 },
  bmiPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  bmiPillText: { fontSize: 11, fontWeight: weight.bold },
  bmiBar: { width: '100%', height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 8, overflow: 'hidden' },
  bmiBarFill: { height: 4, borderRadius: 2 },

  scoreHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  scoreTextCol: { flex: 1 },
  scoreLabel: { fontSize: typography.md, fontWeight: weight.black, marginTop: 2 },
  scoreSub: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },
  scoreBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  scoreBarLabel: { width: 90, fontSize: typography.xs, color: colors.textMuted },
  scoreBarTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  scoreBarFill: { height: 5, borderRadius: 3 },
  scoreBarVal: { width: 28, fontSize: typography.xs, color: colors.textMuted, textAlign: 'right' },

  symRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  symLabel: { width: 50, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  symValues: { width: 70, fontSize: 10, color: colors.textDim },
  symTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, position: 'relative' },
  symMarker: { position: 'absolute', top: -3, width: 10, height: 10, borderRadius: 5, marginLeft: -5 },
  symDiff: { fontSize: typography.xs, fontWeight: weight.bold, width: 32, textAlign: 'right' },

  rateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border },
  rateLabel: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  rateVal: { fontSize: typography.sm, fontWeight: weight.bold },
  rateSub: { fontSize: 9, color: colors.textDim, marginTop: 1 },

  compareSelectRow: { flexDirection: 'row', gap: 10, marginBottom: 4, alignItems: 'flex-start' },
  compareSelectCol: { flex: 1 },
  compareSelectLabel: { fontSize: 10, fontWeight: weight.bold, letterSpacing: 1, marginBottom: 6, color: colors.textMuted },
  compareSelectBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  compareSelectBtnText: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text },
  pickerList: { maxHeight: 160, backgroundColor: colors.bgElevated, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: colors.border },
  pickerItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickerItemText: { fontSize: typography.sm, color: colors.text },

  compareHeaderRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: 10 },
  compareHeaderCell: { flex: 1, fontSize: typography.xs, fontWeight: weight.bold, color: colors.textMuted },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  compareLabel: { flex: 1, fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  compareVal: { flex: 1, fontSize: typography.sm, fontWeight: weight.bold, textAlign: 'left', color: colors.text },
  compareDiffChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  compareDiffText: { fontSize: 11, fontWeight: weight.bold },
  compareDiffMuted: { fontSize: 11, color: colors.textDim },
});
