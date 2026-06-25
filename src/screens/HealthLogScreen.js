import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Polyline, Line, Circle, Path, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import CircularGauge from '../components/CircularGauge';
import ProGate from '../components/ui/ProGate';
import ScreenHeader from '../components/ScreenHeader';

// ─── Marker reference data — ports HL_REF / HL_GROUPS from reference app ────
const HL_REF = {
  sugar:       { name: 'Blood Sugar',       unit: 'mg/dL', lo: 70,   hi: 99,   group: 'Basic' },
  hba1c:       { name: 'HbA1c',             unit: '%',     lo: 0,    hi: 5.6,  group: 'Basic' },
  avgGlucose:  { name: 'Avg Blood Glucose', unit: 'mg/dL', lo: 70,   hi: 115,  group: 'Basic' },
  chol:        { name: 'Cholesterol',       unit: 'mg/dL', lo: 0,    hi: 200,  group: 'Lipid' },
  trig:        { name: 'Triglycerides',     unit: 'mg/dL', lo: 0,    hi: 150,  group: 'Lipid' },
  hdl:         { name: 'HDL',               unit: 'mg/dL', lo: 40,   hi: 999,  group: 'Lipid', hdlMode: true },
  ldl:         { name: 'LDL',               unit: 'mg/dL', lo: 0,    hi: 100,  group: 'Lipid' },
  vldl:        { name: 'VLDL',              unit: 'mg/dL', lo: 5,    hi: 40,   group: 'Lipid' },
  tcholRatio:  { name: 'TC/HDL Ratio',      unit: '',      lo: 0,    hi: 5,    group: 'Lipid', computed: true },
  ldlhdlRatio: { name: 'LDL/HDL Ratio',     unit: '',      lo: 0,    hi: 3.5,  group: 'Lipid', computed: true },
  urea:        { name: 'Urea',              unit: 'mg/dL', lo: 10,   hi: 45,   group: 'Renal' },
  creatinine:  { name: 'Creatinine',        unit: 'mg/dL', lo: 0.7,  hi: 1.3,  group: 'Renal' },
  uric:        { name: 'Uric Acid',         unit: 'mg/dL', lo: 3.5,  hi: 7.2,  group: 'Renal' },
  thyroid:     { name: 'TSH',               unit: 'mIU/L', lo: 0.4,  hi: 4.0,  group: 'Thyroid' },
  t3:          { name: 'T3',                unit: 'ng/dL', lo: 80,   hi: 200,  group: 'Thyroid' },
  t4:          { name: 'T4',                unit: 'µg/dL', lo: 4.5,  hi: 12.5, group: 'Thyroid' },
  vitd:        { name: 'Vitamin D',         unit: 'ng/mL', lo: 20,   hi: 50,   group: 'Vitamins' },
  vitb12:      { name: 'Vitamin B12',       unit: 'pg/mL', lo: 200,  hi: 900,  group: 'Vitamins' },
  hb:          { name: 'Hemoglobin',        unit: 'g/dL',  lo: 13.5, hi: 17.5, group: 'Vitamins' },
};
const HL_GROUPS = {
  Basic:    { icon: '🩸', keys: ['sugar', 'hba1c', 'avgGlucose'] },
  Lipid:    { icon: '🫀', keys: ['chol', 'trig', 'hdl', 'ldl', 'vldl', 'tcholRatio', 'ldlhdlRatio'] },
  Renal:    { icon: '🫁', keys: ['urea', 'creatinine', 'uric'] },
  Thyroid:  { icon: '🦋', keys: ['thyroid', 't3', 't4'] },
  Vitamins: { icon: '☀️', keys: ['vitd', 'vitb12', 'hb'] },
};
const HL_BUILTIN = Object.keys(HL_REF).filter(k => !HL_REF[k].computed);
const HL_ALL = Object.keys(HL_REF);

// Internal key <-> Supabase column mapping
const DB_COL = {
  sugar: 'sugar', hba1c: 'hba1c', avgGlucose: 'avg_glucose',
  chol: 'total_cholesterol', trig: 'triglycerides', hdl: 'hdl', ldl: 'ldl', vldl: 'vldl',
  urea: 'urea', creatinine: 'creatinine', uric: 'uric',
  thyroid: 'tsh', t3: 't3', t4: 't4',
  vitd: 'vitamin_d', vitb12: 'vitamin_b12', hb: 'hemoglobin',
};

function _hlSt(key, val) {
  if (val == null) return 'na';
  const r = HL_REF[key]; if (!r) return 'na';
  if (r.hdlMode) return val < r.lo ? 'lo' : 'ok';
  if (val > r.hi) return 'hi';
  if (val < r.lo) return 'lo';
  return 'ok';
}
function _hlBdg(key, val) {
  const s = _hlSt(key, val);
  return { ok: ['#34d399', 'NORMAL'], hi: ['#f87171', 'HIGH'], lo: ['#fbbf24', 'LOW'], na: ['#6b7280', '—'] }[s];
}
function _hlFmtDate(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function _hlFmtShort(d) { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }

function withComputed(rec) {
  const out = { ...rec };
  if (rec.chol != null && rec.hdl != null) out.tcholRatio = +(rec.chol / rec.hdl).toFixed(1);
  if (rec.ldl != null && rec.hdl != null) out.ldlhdlRatio = +(rec.ldl / rec.hdl).toFixed(1);
  return out;
}

// ─── Data Layer ─────────────────────────────────────────────────────────────
async function fetchHealthLogs(userId) {
  const { data, error } = await supabase
    .from('health_logs')
    .select('id, logged_at, notes, custom, sugar, hba1c, avg_glucose, total_cholesterol, triglycerides, hdl, ldl, vldl, urea, creatinine, uric, tsh, t3, t4, vitamin_d, vitamin_b12, hemoglobin')
    .eq('user_id', userId)
    .order('logged_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(row => withComputed({
    id: row.id,
    date: row.logged_at.slice(0, 10),
    sugar: row.sugar, hba1c: row.hba1c, avgGlucose: row.avg_glucose,
    chol: row.total_cholesterol, trig: row.triglycerides, hdl: row.hdl, ldl: row.ldl, vldl: row.vldl,
    urea: row.urea, creatinine: row.creatinine, uric: row.uric,
    thyroid: row.tsh, t3: row.t3, t4: row.t4,
    vitd: row.vitamin_d, vitb12: row.vitamin_b12, hb: row.hemoglobin,
    _custom: row.custom || [],
  }));
}

async function saveSession(userId, editId, rec) {
  const fields = { logged_at: rec.date, notes: '', custom: rec._custom || [] };
  HL_BUILTIN.forEach(k => { fields[DB_COL[k]] = rec[k] != null ? rec[k] : null; });
  if (editId) {
    const { error } = await supabase.from('health_logs').update(fields).eq('id', editId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('health_logs').insert({ ...fields, user_id: userId });
    if (error) throw error;
  }
}

async function deleteSession(id) {
  const { error } = await supabase.from('health_logs').delete().eq('id', id);
  if (error) throw error;
}

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── Trend chart — ports _hlDrawChart ───────────────────────────────────────
function HealthTrendChart({ data, refKey, colors, width }) {
  const H = 190;
  const P = { t: 16, r: 10, b: 26, l: 36 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  const ref = HL_REF[refKey];

  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Not enough data yet</Text>
      </View>
    );
  }

  const vals = data.map(d => d[refKey]);
  const dates = data.map(d => d.date);
  const refV = [];
  if (ref.hi < 900) refV.push(ref.hi);
  if (ref.lo > 0) refV.push(ref.lo);
  const allV = [...vals, ...refV];
  const minV = Math.min(...allV) * 0.95;
  const maxV = Math.max(...allV) * 1.05;
  const range = maxV - minV || 1;
  const n = vals.length;
  const toX = i => P.l + (i * pw) / Math.max(n - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;

  const pts = vals.map((v, i) => ({ x: toX(i), y: toY(v), v }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const labelStep = Math.max(1, Math.ceil(n / 6));

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="hlFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.accent} stopOpacity="0.22" />
          <Stop offset="1" stopColor={colors.accent} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>

      {[0, 1, 2, 3].map(i => {
        const y = P.t + (ph / 3) * i;
        const v = maxV - (range / 3) * i;
        return (
          <React.Fragment key={i}>
            <Line x1={P.l} y1={y} x2={width - P.r} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <SvgText x={P.l - 6} y={y + 3} fontSize={9} fill={colors.textDim} textAnchor="end">{v.toFixed(ref.unit === '%' ? 1 : 0)}</SvgText>
          </React.Fragment>
        );
      })}

      {ref.hi < 900 && (
        <Line x1={P.l} y1={toY(ref.hi)} x2={width - P.r} y2={toY(ref.hi)} stroke="#f87171" strokeOpacity={0.55} strokeWidth={1.4} strokeDasharray="4,3" />
      )}
      {ref.lo > 0 && (
        <Line x1={P.l} y1={toY(ref.lo)} x2={width - P.r} y2={toY(ref.lo)} stroke="#fbbf24" strokeOpacity={0.55} strokeWidth={1.4} strokeDasharray="4,3" />
      )}

      <Path
        d={`M ${pts[0].x},${H - P.b} ${pts.map(p => `L ${p.x},${p.y}`).join(' ')} L ${pts[pts.length - 1].x},${H - P.b} Z`}
        fill="url(#hlFill)"
      />
      <Polyline points={line} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => {
        const s = _hlSt(refKey, p.v);
        const dc = s === 'hi' ? '#f87171' : s === 'lo' ? '#fbbf24' : colors.accent;
        return <Circle key={i} cx={p.x} cy={p.y} r={4} fill={dc} stroke={colors.bg} strokeWidth={1.2} />;
      })}
      {pts.map((p, i) => {
        if (i % labelStep !== 0 && i !== n - 1) return null;
        return (
          <SvgText key={i} x={p.x} y={H - 6} fontSize={9} fill={colors.textDim} textAnchor="middle">
            {_hlFmtShort(dates[i])}
          </SvgText>
        );
      })}
    </Svg>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function HealthLogScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState('sessions'); // sessions | trends | summary | reference
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [chartKey, setChartKey] = useState('chol');

  const [showSheet, setShowSheet] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({});
  const [customRows, setCustomRows] = useState([]); // [{name,unit,value}]

  const { data: records = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['healthLogs', user?.id],
    queryFn: () => fetchHealthLogs(user.id),
    enabled: !!user?.id,
  });

  const sorted = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date)), [records]);

  const saveMut = useMutation({
    mutationFn: ({ id, rec }) => saveSession(user.id, id, rec),
    onMutate: async ({ id, rec }) => {
      await qc.cancelQueries(['healthLogs', user.id]);
      const previous = qc.getQueryData(['healthLogs', user.id]);
      qc.setQueryData(['healthLogs', user.id], (old) => {
        if (!old) return old;
        if (id) {
          return old.map(r => r.id === id ? withComputed({ id, date: rec.date, _custom: rec._custom || [], ...rec }) : r);
        }
        const optimisticRec = withComputed({ id: `optimistic-${rec.date}`, date: rec.date, _custom: rec._custom || [], ...rec });
        return [optimisticRec, ...old];
      });
      setShowSheet(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['healthLogs', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => qc.invalidateQueries(['healthLogs', user.id]),
  });

  const deleteMut = useMutation({
    mutationFn: deleteSession,
    onMutate: async (id) => {
      await qc.cancelQueries(['healthLogs', user.id]);
      const previous = qc.getQueryData(['healthLogs', user.id]);
      qc.setQueryData(['healthLogs', user.id], (old) => old ? old.filter(r => r.id !== id) : old);
      return { previous };
    },
    onError: (e, id, context) => {
      if (context?.previous) qc.setQueryData(['healthLogs', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => qc.invalidateQueries(['healthLogs', user.id]),
  });

  const openAdd = () => {
    setEditId(null);
    setForm({ date: localDateStr(new Date()) });
    setCustomRows([]);
    setShowSheet(true);
  };

  const openEdit = (rec) => {
    setEditId(rec.id);
    setForm({ ...rec });
    setCustomRows((rec._custom || []).map(c => ({ ...c, value: String(c.value) })));
    setShowSheet(true);
  };

  const handleSave = () => {
    if (!form.date) return Alert.alert('Required', 'Please select a date');
    const rec = { date: form.date };
    HL_BUILTIN.forEach(k => { if (form[k] !== undefined && form[k] !== '' && form[k] != null) rec[k] = parseFloat(form[k]); });
    rec._custom = customRows
      .map(r => ({ name: (r.name || '').trim(), unit: (r.unit || '').trim(), value: parseFloat(r.value) }))
      .filter(r => r.name && !isNaN(r.value));
    saveMut.mutate({ id: editId, rec });
  };

  const askDelete = (id) => Alert.alert('Delete Session', 'Remove this lab session? This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(id) },
  ]);

  // ── SESSIONS tab: score banner ──
  const latest = sorted[0];
  const score = useMemo(() => {
    if (!latest) return 0;
    let total = 0, normal = 0;
    HL_BUILTIN.forEach(k => { if (latest[k] != null) { total++; if (_hlSt(k, latest[k]) === 'ok') normal++; } });
    return total ? Math.round((normal / total) * 100) : 0;
  }, [latest]);
  const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  const scoreLabel = score >= 80 ? 'Good Standing' : score >= 60 ? 'Needs Attention' : 'Review Required';
  const counts = useMemo(() => {
    let ok = 0, hi = 0, lo = 0, total = 0;
    if (latest) HL_BUILTIN.forEach(k => {
      if (latest[k] == null) return;
      total++;
      const s = _hlSt(k, latest[k]);
      if (s === 'ok') ok++; else if (s === 'hi') hi++; else if (s === 'lo') lo++;
    });
    return { ok, hi, lo, total };
  }, [latest]);

  // ── TRENDS tab ──
  const availKeys = useMemo(() => HL_ALL.filter(k => sorted.filter(r => r[k] != null).length >= 2), [sorted]);
  const effectiveChartKey = availKeys.includes(chartKey) ? chartKey : availKeys[0];
  const chartData = useMemo(() => {
    if (!effectiveChartKey) return [];
    return [...records].filter(r => r[effectiveChartKey] != null).sort((a, b) => a.date.localeCompare(b.date));
  }, [records, effectiveChartKey]);
  const chartLatest = chartData[chartData.length - 1];

  // ── SUMMARY tab ──
  const summaryData = useMemo(() => {
    const latestMap = {}, prevMap = {};
    HL_ALL.forEach(k => {
      const vs = [...records].filter(r => r[k] != null).sort((a, b) => b.date.localeCompare(a.date));
      if (vs.length >= 1) latestMap[k] = vs[0][k];
      if (vs.length >= 2) prevMap[k] = vs[1][k];
    });
    const keys = HL_ALL.filter(k => latestMap[k] != null);
    let norm = 0, hi = 0, lo = 0;
    keys.forEach(k => { const s = _hlSt(k, latestMap[k]); if (s === 'ok') norm++; else if (s === 'hi') hi++; else if (s === 'lo') lo++; });
    return { latestMap, prevMap, keys, norm, hi, lo };
  }, [records]);

  // ── Search filter ──
  const matchedKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return HL_ALL.filter(k => HL_REF[k].name.toLowerCase().includes(q));
  }, [search]);
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    return sorted.filter(rec => matchedKeys.some(k => rec[k] != null));
  }, [sorted, matchedKeys, search]);

  const SCREEN_W = Dimensions.get('window').width;
  const chartWidth = SCREEN_W - 32 - 28;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title="HEALTH LOG" colors={colors} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        <Text style={styles.titleRow}>
          <Text style={styles.titleWhite}>HEALTH </Text>
          <Text style={styles.titleAccent}>LOG</Text>
        </Text>
        <Text style={styles.subtitle}>BLOOD TESTS &amp; LAB RESULTS</Text>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={15} color={colors.textDim} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search marker (e.g. Cholesterol, HbA1c…)"
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={colors.textDim} />
            </TouchableOpacity>
          )}
        </View>

        {!search ? (
          <View style={styles.tabNav}>
            {['sessions', 'trends', 'summary', 'reference'].map(t => (
              <TouchableOpacity key={t} style={[styles.tabPill, activeTab === t && styles.tabPillActive]} onPress={() => setActiveTab(t)}>
                <Text style={[styles.tabPillText, activeTab === t && styles.tabPillTextActive]}>{t.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
        <ProGate label="Health log">
        {search ? (
          // ── SEARCH RESULTS ──
          searchResults.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 36 }}>🔍</Text>
              <Text style={styles.emptyTitle}>No results for "{search}"</Text>
            </View>
          ) : (
            <>
              <Text style={styles.searchCount}>{searchResults.length} session{searchResults.length !== 1 ? 's' : ''} found</Text>
              {searchResults.map(rec => (
                <View key={rec.id} style={styles.srCard}>
                  <Text style={styles.srDate}>{_hlFmtDate(rec.date)}</Text>
                  <View style={styles.srMarkers}>
                    {matchedKeys.filter(k => rec[k] != null).map(k => {
                      const s = _hlSt(k, rec[k]);
                      const [bc] = _hlBdg(k, rec[k]);
                      return (
                        <View key={k} style={[styles.srMarker, { borderColor: bc + '55' }]}>
                          <Text style={styles.srMarkerName}>{HL_REF[k].name}</Text>
                          <Text style={[styles.srMarkerVal, { color: bc }]}>{rec[k]} <Text style={styles.srMarkerUnit}>{HL_REF[k].unit}</Text></Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </>
          )
        ) : activeTab === 'sessions' ? (
          !sorted.length ? (
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 44 }}>🩺</Text>
              <Text style={styles.emptyTitle}>No lab sessions yet</Text>
              <Text style={styles.emptySub}>Tap + to log your first blood test results.</Text>
            </View>
          ) : (
            <>
              <View style={styles.scoreBanner}>
                <CircularGauge percent={score} size={64} strokeWidth={5} color={scoreColor} value={score} label={`/ 100`} valueStyle={{ color: colors.text }} labelStyle={{ color: colors.textMuted }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.scoreMeta}>LATEST · {_hlFmtDate(latest.date).toUpperCase()}</Text>
                  <Text style={[styles.scoreTitle, { color: scoreColor }]}>{scoreLabel}</Text>
                  <Text style={styles.scoreSub}>{counts.ok} of {counts.total} markers in normal range</Text>
                  <View style={styles.scorePills}>
                    {counts.ok ? <View style={[styles.scorePill, { backgroundColor: '#34d39922' }]}><Text style={[styles.scorePillText, { color: '#34d399' }]}>✓ {counts.ok} Normal</Text></View> : null}
                    {counts.hi ? <View style={[styles.scorePill, { backgroundColor: '#f8717122' }]}><Text style={[styles.scorePillText, { color: '#f87171' }]}>↑ {counts.hi} High</Text></View> : null}
                    {counts.lo ? <View style={[styles.scorePill, { backgroundColor: '#fbbf2422' }]}><Text style={[styles.scorePillText, { color: '#fbbf24' }]}>↓ {counts.lo} Low</Text></View> : null}
                  </View>
                </View>
              </View>

              {sorted.map(rec => {
                let totalMetrics = 0, anom = 0;
                HL_BUILTIN.forEach(k => { if (rec[k] != null) { totalMetrics++; if (_hlSt(k, rec[k]) !== 'ok') anom++; } });
                totalMetrics += (rec._custom || []).length;
                const isOpen = !!expanded[rec.id];
                return (
                  <View key={rec.id} style={styles.sessionCard}>
                    <TouchableOpacity style={styles.sessionHdr} onPress={() => setExpanded(p => ({ ...p, [rec.id]: !p[rec.id] }))}>
                      <View>
                        <Text style={styles.sessionDate}>{_hlFmtDate(rec.date)}</Text>
                        <Text style={styles.sessionCount}>{totalMetrics} marker{totalMetrics !== 1 ? 's' : ''} logged</Text>
                      </View>
                      <View style={styles.sessionRight}>
                        <View style={[styles.flagPill, anom ? styles.flagWarn : styles.flagOk]}>
                          <Text style={[styles.flagText, { color: anom ? '#f87171' : '#34d399' }]}>
                            {anom ? `⚠ ${anom} abnormal` : '✓ Normal'}
                          </Text>
                        </View>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textDim} />
                      </View>
                    </TouchableOpacity>

                    <View style={styles.chipGrid}>
                      {HL_BUILTIN.filter(k => rec[k] != null).map(k => {
                        const s = _hlSt(k, rec[k]);
                        const [bc] = _hlBdg(k, rec[k]);
                        return (
                          <View key={k} style={[styles.chip, s !== 'ok' && { borderColor: bc + '66' }]}>
                            <Text style={styles.chipName}>{HL_REF[k].name}</Text>
                            <Text style={[styles.chipVal, s !== 'ok' && { color: bc }]}>{rec[k]}</Text>
                          </View>
                        );
                      })}
                      {(rec._custom || []).map((c, i) => (
                        <View key={`c${i}`} style={styles.chip}>
                          <Text style={styles.chipName}>{c.name}</Text>
                          <Text style={styles.chipVal}>{c.value}</Text>
                        </View>
                      ))}
                    </View>

                    {isOpen && (
                      <View style={styles.sessionBody}>
                        {Object.entries(HL_GROUPS).map(([gName, gData]) => {
                          const keys = gData.keys.filter(k => rec[k] != null);
                          if (!keys.length) return null;
                          return (
                            <View key={gName} style={styles.panel}>
                              <Text style={styles.panelHdr}>{gData.icon} {gName.toUpperCase()}</Text>
                              {keys.map(k => {
                                const [bc, bl] = _hlBdg(k, rec[k]);
                                return (
                                  <View key={k} style={styles.metricRow}>
                                    <Text style={styles.metricName}>{HL_REF[k].name}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                      <Text style={styles.metricVal}>{rec[k]}{HL_REF[k].unit ? ` ${HL_REF[k].unit}` : ''}</Text>
                                      <View style={[styles.badge, { backgroundColor: bc + '22' }]}><Text style={[styles.badgeText, { color: bc }]}>{bl}</Text></View>
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })}
                        {!!(rec._custom || []).length && (
                          <View style={styles.panel}>
                            <Text style={styles.panelHdr}>🧬 CUSTOM TESTS</Text>
                            {rec._custom.map((c, i) => (
                              <View key={i} style={styles.metricRow}>
                                <Text style={styles.metricName}>{c.name}</Text>
                                <Text style={styles.metricVal}>{c.value}{c.unit ? ` ${c.unit}` : ''}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                        <View style={styles.sessBtns}>
                          <TouchableOpacity style={styles.actBtn} onPress={() => openEdit(rec)}>
                            <Ionicons name="pencil" size={12} color={colors.text} /><Text style={styles.actBtnText}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.actBtn, styles.actBtnDel]} onPress={() => askDelete(rec.id)}>
                            <Ionicons name="trash" size={12} color="#f87171" /><Text style={[styles.actBtnText, { color: '#f87171' }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )
        ) : activeTab === 'trends' ? (
          !availKeys.length ? (
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 44 }}>📈</Text>
              <Text style={styles.emptyTitle}>Not enough data yet</Text>
              <Text style={styles.emptySub}>Log at least 2 sessions with the same metric to see trends.</Text>
            </View>
          ) : (
            <View style={styles.chartCard}>
              <Text style={styles.chartHead}>📈 METRIC OVER TIME</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsRow}>
                {availKeys.map(k => (
                  <TouchableOpacity key={k} style={[styles.mpill, effectiveChartKey === k && styles.mpillActive]} onPress={() => setChartKey(k)}>
                    <Text style={[styles.mpillText, effectiveChartKey === k && styles.mpillTextActive]}>{HL_REF[k].name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <HealthTrendChart data={chartData} refKey={effectiveChartKey} colors={colors} width={chartWidth} />
              {chartLatest && (
                <View style={styles.chartFooter}>
                  <Text style={styles.chartFooterLeft}>{HL_REF[effectiveChartKey].name} · {chartData.length} readings</Text>
                  <Text style={[styles.chartFooterRight, { color: _hlBdg(effectiveChartKey, chartLatest[effectiveChartKey])[0] }]}>
                    {chartLatest[effectiveChartKey]} {HL_REF[effectiveChartKey].unit} · {_hlBdg(effectiveChartKey, chartLatest[effectiveChartKey])[1]}
                  </Text>
                </View>
              )}
            </View>
          )
        ) : activeTab === 'summary' ? (
          !summaryData.keys.length ? (
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 44 }}>📋</Text>
              <Text style={styles.emptyTitle}>No data yet</Text>
            </View>
          ) : (
            <>
              <View style={styles.summaryHero}>
                <Text style={styles.summaryHeroLabel}>LATEST RESULTS OVERVIEW</Text>
                <View style={styles.summaryHeroRow}>
                  <View style={styles.summaryHeroCol}>
                    <Text style={[styles.summaryHeroNum, { color: '#34d399' }]}>{summaryData.norm}</Text>
                    <Text style={[styles.summaryHeroLbl, { color: '#34d399' }]}>NORMAL</Text>
                  </View>
                  <View style={styles.summaryHeroCol}>
                    <Text style={[styles.summaryHeroNum, { color: '#f87171' }]}>{summaryData.hi}</Text>
                    <Text style={[styles.summaryHeroLbl, { color: '#f87171' }]}>HIGH</Text>
                  </View>
                  <View style={styles.summaryHeroCol}>
                    <Text style={[styles.summaryHeroNum, { color: '#fbbf24' }]}>{summaryData.lo}</Text>
                    <Text style={[styles.summaryHeroLbl, { color: '#fbbf24' }]}>LOW</Text>
                  </View>
                </View>
                <Text style={styles.summaryHeroSub}>{summaryData.keys.length} metrics · {records.length} sessions</Text>
              </View>

              <View style={styles.sumGrid}>
                {summaryData.keys.map(k => {
                  const v = summaryData.latestMap[k];
                  const p = summaryData.prevMap[k];
                  const [bc, bl] = _hlBdg(k, v);
                  let trendEl = null;
                  if (p != null) {
                    const d = v - p;
                    const pct = p !== 0 ? Math.abs(Math.round((d / p) * 100)) : 0;
                    const up = d > 0;
                    const good = HL_REF[k].hdlMode ? up : !up;
                    const trendColor = d === 0 ? colors.textDim : good ? '#34d399' : '#f87171';
                    trendEl = <Text style={[styles.sumTrend, { color: trendColor }]}>{d === 0 ? '→ No change' : `${up ? '↑' : '↓'} ${pct}% vs prev`}</Text>;
                  }
                  return (
                    <View key={k} style={styles.sumTile}>
                      <Text style={styles.sumLabel}>{HL_REF[k].name.toUpperCase()}</Text>
                      <Text style={[styles.sumVal, { color: bl === 'HIGH' ? '#f87171' : bl === 'LOW' ? '#fbbf24' : colors.text }]}>{v}</Text>
                      <Text style={styles.sumUnit}>{HL_REF[k].unit || '—'}</Text>
                      <View style={[styles.badge, { backgroundColor: bc + '22', alignSelf: 'flex-start', marginTop: 5 }]}><Text style={[styles.badgeText, { color: bc }]}>{bl}</Text></View>
                      {trendEl}
                    </View>
                  );
                })}
              </View>
            </>
          )
        ) : (
          // ── REFERENCE ──
          Object.entries(HL_GROUPS).map(([gName, gData]) => (
            <View key={gName} style={styles.refGroup}>
              <Text style={styles.refGroupHdr}>{gData.icon} {gName.toUpperCase()}</Text>
              {gData.keys.map(k => {
                const r = HL_REF[k];
                const range = r.hdlMode ? `> ${r.lo} ${r.unit}` : r.lo === 0 ? `< ${r.hi} ${r.unit}` : `${r.lo} – ${r.hi} ${r.unit}`;
                return (
                  <View key={k} style={styles.refRow}>
                    <Text style={styles.refRowLabel}>{r.name}</Text>
                    <Text style={styles.refRowRange}>{range}</Text>
                  </View>
                );
              })}
            </View>
          ))
        )}
        </ProGate>
        )}
        <View style={{ height: 90 }} />
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={openAdd}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      <BottomSheet visible={showSheet} onClose={() => setShowSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{editId ? 'Edit Session' : 'New Session'}</Text>
          <TouchableOpacity onPress={() => setShowSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
          <View style={styles.sheetGroup}>
            <Text style={styles.sheetGroupHdr}>📅 DATE</Text>
            <Text style={styles.sheetFieldLabel}>TEST DATE</Text>
            <DatePickerField
              value={form.date ?? ''}
              onChange={v => setForm(p => ({ ...p, date: v }))}
              colors={colors}
              maxDate={localDateStr(new Date())}
            />
          </View>

          {Object.entries(HL_GROUPS).map(([gName, gData]) => (
            <View key={gName} style={styles.sheetGroup}>
              <Text style={styles.sheetGroupHdr}>{gData.icon} {gName.toUpperCase()}{gName === 'Basic' ? ' PANEL' : gName === 'Lipid' ? ' PROFILE' : gName === 'Renal' ? ' FUNCTION' : gName === 'Vitamins' ? ' & MINERALS' : ''}</Text>
              {gData.keys.filter(k => !HL_REF[k].computed).map(k => (
                <View key={k} style={styles.sheetFieldRowSingle}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetFieldLabel}>{HL_REF[k].name.toUpperCase()}{HL_REF[k].unit ? ` (${HL_REF[k].unit})` : ''}</Text>
                  </View>
                  <TextInput
                    style={styles.sheetInputSmall}
                    value={form[k] != null ? String(form[k]) : ''}
                    onChangeText={v => setForm(p => ({ ...p, [k]: v }))}
                    placeholder="0"
                    placeholderTextColor={colors.textDim}
                    keyboardType="numeric"
                  />
                </View>
              ))}
            </View>
          ))}

          <View style={styles.sheetGroup}>
            <View style={styles.customHdrRow}>
              <Text style={styles.sheetGroupHdr}>+ CUSTOM TESTS</Text>
              <TouchableOpacity style={styles.addCustomBtn} onPress={() => setCustomRows(p => [...p, { name: '', unit: '', value: '' }])}>
                <Text style={styles.addCustomBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {!customRows.length && (
              <Text style={styles.customHint}>Tap + Add for any unlisted test. e.g. Iron, Ferritin, WBC, Platelets…</Text>
            )}
            {customRows.map((row, i) => (
              <View key={i} style={styles.crow}>
                <View style={styles.crowHdr}>
                  <Text style={styles.crowTitle}>🧬 TEST #{i + 1}</Text>
                  <TouchableOpacity onPress={() => setCustomRows(p => p.filter((_, j) => j !== i))}>
                    <Text style={styles.crowRemove}>✕ Remove</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.crowGrid}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetFieldLabel}>NAME</Text>
                    <TextInput style={styles.sheetInput} value={row.name} onChangeText={v => setCustomRows(p => p.map((r, j) => j === i ? { ...r, name: v } : r))} placeholder="Iron, WBC…" placeholderTextColor={colors.textDim} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetFieldLabel}>UNIT</Text>
                    <TextInput style={styles.sheetInput} value={row.unit} onChangeText={v => setCustomRows(p => p.map((r, j) => j === i ? { ...r, unit: v } : r))} placeholder="mg/dL…" placeholderTextColor={colors.textDim} />
                  </View>
                </View>
                <Text style={styles.sheetFieldLabel}>RESULT</Text>
                <TextInput style={styles.sheetInput} value={row.value} onChangeText={v => setCustomRows(p => p.map((r, j) => j === i ? { ...r, value: v } : r))} placeholder="Value" placeholderTextColor={colors.textDim} keyboardType="numeric" />
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saveMut.isPending}>
            {saveMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>💾 Save Session</Text>}
          </TouchableOpacity>
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  appHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  },
  logoText: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.accent },
  screenLabel: { fontSize: typography.xs, fontWeight: weight.bold, letterSpacing: 2, color: colors.textMuted },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },

  content: { paddingHorizontal: 16, paddingBottom: 16 },

  titleRow: { marginTop: 8 },
  titleWhite: { fontSize: typography.xxl, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  titleAccent: { fontSize: typography.xxl, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent },
  subtitle: { fontSize: 10, fontWeight: weight.bold, letterSpacing: 1.5, color: colors.textDim, marginTop: 2, marginBottom: 14, fontFamily: fontFamily.mono },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bgCard, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },

  tabNav: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 14, padding: 3, marginBottom: 14 },
  tabPill: { flex: 1, paddingVertical: 9, borderRadius: 11, alignItems: 'center' },
  tabPillActive: { backgroundColor: colors.bgCard },
  tabPillText: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5, fontFamily: fontFamily.mono },
  tabPillTextActive: { color: colors.text },

  emptyWrap: { alignItems: 'center', paddingTop: 56, gap: 8 },
  emptyTitle: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text, marginTop: 6 },
  emptySub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', lineHeight: 19 },

  searchCount: { fontSize: typography.xs, color: colors.textDim, marginBottom: 10 },
  srCard: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  srDate: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text, marginBottom: 8 },
  srMarkers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  srMarker: { backgroundColor: colors.bgElevated, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  srMarkerName: { fontSize: 9, color: colors.textDim, fontFamily: fontFamily.mono },
  srMarkerVal: { fontSize: typography.sm, fontWeight: weight.bold, marginTop: 1 },
  srMarkerUnit: { fontSize: 9, color: colors.textDim, fontWeight: weight.normal },

  scoreBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: colors.bgCard, borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
  },
  scoreMeta: { fontSize: 9, color: colors.textDim, fontWeight: weight.bold, letterSpacing: 1, fontFamily: fontFamily.mono },
  scoreTitle: { fontSize: typography.base, fontWeight: weight.bold, marginTop: 3 },
  scoreSub: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },
  scorePills: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  scorePill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  scorePillText: { fontSize: 9, fontWeight: weight.bold },

  sessionCard: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  sessionHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionDate: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  sessionCount: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  sessionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flagPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  flagWarn: { backgroundColor: '#f8717118' },
  flagOk: { backgroundColor: '#34d39918' },
  flagText: { fontSize: 9, fontWeight: weight.bold },

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { backgroundColor: colors.bgElevated, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  chipName: { fontSize: 8, color: colors.textDim, fontFamily: fontFamily.mono },
  chipVal: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text, marginTop: 1 },

  sessionBody: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  panel: { marginBottom: 12 },
  panelHdr: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginBottom: 8, fontFamily: fontFamily.mono },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  metricName: { fontSize: typography.sm, color: colors.text },
  metricVal: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: weight.bold },

  sessBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.border },
  actBtnDel: { borderColor: '#f8717144' },
  actBtnText: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text },

  chartCard: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border },
  chartHead: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginBottom: 10, fontFamily: fontFamily.mono },
  pillsRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  mpill: { backgroundColor: colors.bgElevated, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  mpillActive: { borderColor: colors.accent, backgroundColor: colors.accent + '18' },
  mpillText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted },
  mpillTextActive: { color: colors.accent },
  chartFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  chartFooterLeft: { fontSize: typography.xs, color: colors.textDim },
  chartFooterRight: { fontSize: typography.xs, fontWeight: weight.bold },

  summaryHero: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  summaryHeroLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, marginBottom: 12, fontFamily: fontFamily.mono },
  summaryHeroRow: { flexDirection: 'row' },
  summaryHeroCol: { flex: 1, alignItems: 'center' },
  summaryHeroNum: { fontSize: 26, fontWeight: weight.bold, fontFamily: fontFamily.displayItalic, fontStyle: 'italic' },
  summaryHeroLbl: { fontSize: 10, fontWeight: weight.bold, fontFamily: fontFamily.mono, marginTop: 2 },
  summaryHeroSub: { fontSize: typography.xs, color: colors.textDim, textAlign: 'center', marginTop: 12 },

  sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sumTile: { width: '47.5%', backgroundColor: colors.bgCard, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border },
  sumLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5, fontFamily: fontFamily.mono },
  sumVal: { fontSize: typography.xl, fontWeight: weight.bold, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', marginTop: 6 },
  sumUnit: { fontSize: 10, color: colors.textDim },
  sumTrend: { fontSize: 10, fontWeight: weight.bold, marginTop: 5 },

  refGroup: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  refGroupHdr: { fontSize: 10, fontWeight: weight.bold, color: colors.accent, letterSpacing: 1, marginBottom: 10, fontFamily: fontFamily.mono },
  refRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  refRowLabel: { fontSize: typography.sm, color: colors.text },
  refRowRange: { fontSize: typography.xs, color: colors.textMuted, fontFamily: fontFamily.mono },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },

  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  sheetGroup: { marginBottom: 18 },
  sheetGroupHdr: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginBottom: 10, fontFamily: fontFamily.mono },
  sheetFieldLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 0.5, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetFieldRowSingle: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  sheetInputSmall: { width: 90, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10, color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border, textAlign: 'center' },

  customHdrRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addCustomBtn: { backgroundColor: colors.accent + '18', borderWidth: 1, borderColor: colors.accent, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  addCustomBtnText: { color: colors.accent, fontSize: 10, fontWeight: weight.bold, fontFamily: fontFamily.mono },
  customHint: { fontSize: typography.xs, color: colors.textDim, marginTop: 8, lineHeight: 17 },
  crow: { backgroundColor: colors.bgElevated, borderRadius: 14, padding: 12, marginTop: 10, borderWidth: 1, borderColor: colors.border },
  crowHdr: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  crowTitle: { fontSize: typography.xs, fontWeight: weight.bold, color: colors.text },
  crowRemove: { fontSize: 10, fontWeight: weight.bold, color: '#f87171' },
  crowGrid: { flexDirection: 'row', gap: 10 },

  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4, marginBottom: 8 },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
});
