import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Polyline, Line, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import CircularGauge from '../components/CircularGauge';

// ─── Constants ──────────────────────────────────────────────────────────────
const KG_TO_LBS = 2.20462;
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}
function toDisp(kg, unit) { return unit === 'lbs' ? +(kg * KG_TO_LBS).toFixed(1) : +kg.toFixed(1); }
function fromDisp(val, unit) { return unit === 'lbs' ? +(val / KG_TO_LBS).toFixed(2) : +val.toFixed(2); }

// ─── Data Layer ─────────────────────────────────────────────────────────────
async function fetchWeightData(userId) {
  const [logs, profile] = await Promise.all([
    supabase.from('weight_logs').select('id, weight, notes, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(400),
    supabase.from('profiles').select('weight_goal_kg, full_name').eq('id', userId).single(),
  ]);
  if (logs.error) throw logs.error;
  const normLogs = (logs.data ?? []).map(l => ({ ...l, logged_at: l.logged_at.slice(0, 10) }));
  return { logs: normLogs, profile: profile.data };
}

async function logWeight(userId, { date, weight: weightKg, note }) {
  const existing = await supabase
    .from('weight_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('logged_at', date)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;

  const fields = { weight: weightKg, notes: note || null };

  if (existing.data) {
    const { error } = await supabase.from('weight_logs').update(fields).eq('id', existing.data.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('weight_logs').insert({ ...fields, user_id: userId, logged_at: date });
    if (error) throw error;
  }
}

async function updateWeightGoal(userId, goalKg) {
  const { error } = await supabase.from('profiles').update({ weight_goal_kg: goalKg }).eq('id', userId);
  if (error) throw error;
}

async function deleteWeightLog(id) {
  const { error } = await supabase.from('weight_logs').delete().eq('id', id);
  if (error) throw error;
}

// ─── Weight Heatmap — ports _renderWeightHeatmap (quartile-relative-to-month) ─
function WeightHeatmap({ year, month, logsByDate, colors }) {
  const SCREEN_W = Dimensions.get('window').width;
  const cellSize = Math.floor((SCREEN_W - 32 - 48 - 12) / 7);
  const firstDay = new Date(year, month, 1).getDay();
  let startDow = firstDay - 1; if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());

  const vals = Object.values(logsByDate);
  const minW = vals.length ? Math.min(...vals) : 0;
  const maxW = vals.length ? Math.max(...vals) : 0;
  const rangeW = maxW - minW || 0.001;

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ key: `e${i}`, empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const w = logsByDate[ds];
    let lvl = 0;
    if (w !== undefined) {
      const rel = (w - minW) / rangeW;
      if (rel < 0.25) lvl = 1; else if (rel < 0.5) lvl = 2; else if (rel < 0.75) lvl = 3; else lvl = 4;
    }
    cells.push({ key: ds, day: d, w, lvl, isToday: ds === todayStr });
  }

  const LVL_COLOR = {
    0: colors.dim,
    1: 'rgba(52,211,153,0.25)',
    2: 'rgba(52,211,153,0.5)',
    3: 'rgba(251,191,36,0.55)',
    4: 'rgba(248,113,113,0.7)',
  };

  return (
    <View>
      <View style={s_hm.dowRow}>
        {DOW_LABELS.map(d => (
          <View key={d} style={{ width: cellSize, alignItems: 'center' }}>
            <Text style={s_hm.dowText}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={s_hm.grid}>
        {cells.map(cell => {
          if (cell.empty) return <View key={cell.key} style={{ width: cellSize, height: cellSize, margin: 2 }} />;
          return (
            <View
              key={cell.key}
              style={[
                s_hm.cell,
                { width: cellSize, height: cellSize, backgroundColor: LVL_COLOR[cell.lvl] },
                cell.isToday && { borderWidth: 2, borderColor: '#f59e0b' },
              ]}
            >
              <Text style={[s_hm.dayNum, cell.lvl === 0 && { color: colors.textDim }]}>{cell.day}</Text>
              <Text style={[s_hm.wTxt, cell.lvl === 0 && { color: colors.textDim, opacity: 0.5 }]}>
                {cell.w !== undefined ? cell.w.toFixed(1) : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s_hm = StyleSheet.create({
  dowRow: { flexDirection: 'row', marginBottom: 6 },
  dowText: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.mono },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dayNum: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.7)', fontFamily: fontFamily.mono },
  wTxt: { fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.85)', fontFamily: fontFamily.mono, marginTop: 1 },
});

// ─── 30-Day Trend Chart — ports fzRenderWeightTrendChart ────────────────────
function WeightTrendChart({ data, unit, goalKg, colors, width }) {
  const H = 170;
  const P = { t: 18, r: 8, b: 22, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>Not enough data yet</Text>
      </View>
    );
  }

  const rawVals = data.map(e => toDisp(e.weight, unit));
  const avgVals = data.map((_, i) => {
    const win = data.slice(Math.max(0, i - 6), i + 1);
    const avg = win.reduce((s, x) => s + x.weight, 0) / win.length;
    return toDisp(avg, unit);
  });
  const goalDisp = goalKg ? toDisp(goalKg, unit) : null;

  const allVals = [...rawVals, ...avgVals, ...(goalDisp ? [goalDisp] : [])];
  const minV = Math.min(...allVals) * 0.98;
  const maxV = Math.max(...allVals) * 1.02;
  const range = maxV - minV || 1;
  const n = data.length;
  const xs = pw / Math.max(n - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + i * xs;

  const rawPts = rawVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const rawLine = rawPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const avgPts = avgVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const avgLine = avgPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const goalY = goalDisp != null ? toY(goalDisp) : null;
  const lastAvg = avgPts[avgPts.length - 1];

  return (
    <Svg width={width} height={H}>
      <Defs>
        <LinearGradient id="wtFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#f59e0b" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#f59e0b" stopOpacity="0" />
        </LinearGradient>
      </Defs>

      {[0, 1, 2, 3].map(i => {
        const y = P.t + (ph / 3) * i;
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
      })}

      {goalY != null && (
        <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#34d399" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4,4" />
      )}

      {avgPts.length > 1 && (
        <Path
          d={`M ${avgPts[0].x},${H - P.b} ${avgPts.map(p => `L ${p.x},${p.y}`).join(' ')} L ${avgPts[avgPts.length - 1].x},${H - P.b} Z`}
          fill="url(#wtFill)"
        />
      )}

      {rawPts.length > 1 && (
        <Polyline points={rawLine} fill="none" stroke="#67e8f9" strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {avgPts.length > 1 && (
        <Polyline points={avgLine} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {rawPts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2} fill="#67e8f9" fillOpacity={0.6} />
      ))}

      {lastAvg && <Circle cx={lastAvg.x} cy={lastAvg.y} r={3.5} fill="#f59e0b" />}
    </Svg>
  );
}

// ─── Weekly Avg Chart + Table — ports _renderWeeklyAvgChart / _wkTrendPill / _wkCumBar ─
function WeeklyAvgChart({ logs, viewMode, unit, colors, width }) {
  const groups = useMemo(() => {
    const sorted = [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at));
    const map = {};
    sorted.forEach(l => {
      let key;
      if (viewMode === 'month') {
        key = l.logged_at.slice(0, 7);
      } else {
        const d = new Date(l.logged_at + 'T00:00:00');
        const dow = d.getDay();
        const mondayOffset = dow === 0 ? -6 : 1 - dow;
        const monday = new Date(d); monday.setDate(d.getDate() + mondayOffset);
        key = localDateStr(monday);
      }
      if (!map[key]) map[key] = [];
      map[key].push(l.weight);
    });
    return Object.keys(map).sort().map(key => ({
      key, avg: map[key].reduce((s, w) => s + w, 0) / map[key].length,
    }));
  }, [logs, viewMode]);

  if (groups.length === 0) {
    return <Text style={{ color: colors.textDim, fontSize: typography.sm, textAlign: 'center', paddingVertical: 20 }}>Not enough data yet</Text>;
  }

  const allDisp = groups.map(g => toDisp(g.avg, unit));
  const maxLost = Math.max(...allDisp.map((_, i, a) => +(a[0] - a[i]).toFixed(1)), 0.001);

  const H = 110;
  const P = { t: 12, r: 8, b: 8, l: 8 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  const minV = Math.min(...allDisp) * 0.98;
  const maxV = Math.max(...allDisp) * 1.02;
  const range = maxV - minV || 1;
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + (i * pw) / Math.max(groups.length - 1, 1);
  const linePts = allDisp.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  return (
    <View>
      <Svg width={width} height={H}>
        <Polyline points={linePts} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {allDisp.map((v, i) => <Circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill="#f59e0b" />)}
      </Svg>

      <View style={s_wk.tableHeader}>
        <Text style={[s_wk.th, { width: 44 }]}>{viewMode === 'month' ? 'MO' : 'WK'}</Text>
        <Text style={[s_wk.th, { flex: 1 }]}>AVG WEIGHT</Text>
        <Text style={[s_wk.th, { width: 60, textAlign: 'right' }]}>TREND</Text>
        <Text style={[s_wk.th, { width: 70, textAlign: 'right' }]}>LOST</Text>
      </View>
      {groups.map((g, i) => {
        const dispVal = toDisp(g.avg, unit);
        const delta = i === 0 ? null : +(dispVal - toDisp(groups[i - 1].avg, unit)).toFixed(1);
        const cumLostVal = +(allDisp[0] - dispVal).toFixed(1);
        const isLast = i === groups.length - 1;
        const pct = Math.min(100, Math.max(0, Math.round((cumLostVal / maxLost) * 100)));
        const gained = cumLostVal < 0;
        return (
          <View key={g.key} style={s_wk.row}>
            <Text style={[s_wk.cellLabel, { width: 44 }]}>{viewMode === 'month' ? MONTH_NAMES[parseInt(g.key.slice(5, 7), 10) - 1] : `Wk${i + 1}`}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s_wk.cellVal, isLast && { color: colors.accent }]}>{dispVal.toFixed(1)}{unit} {isLast ? <Text style={s_wk.nowTag}>NOW</Text> : null}</Text>
            </View>
            <View style={{ width: 60, alignItems: 'flex-end' }}>
              {i === 0 ? (
                <View style={[s_wk.pill, { backgroundColor: 'rgba(148,163,184,0.12)' }]}><Text style={[s_wk.pillText, { color: colors.textMuted }]}>START</Text></View>
              ) : Math.abs(delta) < 0.05 ? (
                <View style={[s_wk.pill, { backgroundColor: 'rgba(148,163,184,0.12)' }]}><Text style={[s_wk.pillText, { color: colors.textMuted }]}>→ 0.0</Text></View>
              ) : delta < 0 ? (
                <View style={[s_wk.pill, { backgroundColor: 'rgba(52,211,153,0.15)' }]}><Text style={[s_wk.pillText, { color: '#34d399' }]}>▼ {Math.abs(delta).toFixed(1)}</Text></View>
              ) : (
                <View style={[s_wk.pill, { backgroundColor: 'rgba(248,113,113,0.15)' }]}><Text style={[s_wk.pillText, { color: '#f87171' }]}>▲ {delta.toFixed(1)}</Text></View>
              )}
            </View>
            <View style={{ width: 70, alignItems: 'flex-end' }}>
              {gained ? (
                <Text style={[s_wk.cumText, { color: '#f87171' }]}>+{Math.abs(cumLostVal).toFixed(1)}</Text>
              ) : (
                <View style={s_wk.cumTrack}>
                  <View style={[s_wk.cumFill, { width: `${pct}%` }]} />
                  <Text style={s_wk.cumText}>-{cumLostVal.toFixed(1)}</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s_wk = StyleSheet.create({
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', paddingBottom: 6, marginTop: 14, marginBottom: 4 },
  th: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, fontFamily: fontFamily.mono },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  cellLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: fontFamily.mono },
  cellVal: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontFamily: fontFamily.monoBold },
  nowTag: { fontSize: 8, color: '#0c0c0f', backgroundColor: '#f59e0b', paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' },
  pill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10 },
  pillText: { fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono },
  cumTrack: { width: 64, height: 16, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', position: 'relative', overflow: 'hidden' },
  cumFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(52,211,153,0.35)', borderRadius: 8 },
  cumText: { fontSize: 9, color: '#34d399', fontWeight: '700', textAlign: 'right', paddingRight: 4, fontFamily: fontFamily.mono },
});

// ─── History slider bar row — ports renderBody()'s history list ────────────
function WeightHistoryBar({ value, goalVal, barMax, colors }) {
  const fillPct = Math.min(97, Math.max(2, (value / barMax) * 100));
  const goalPct = goalVal != null ? Math.min(99, Math.max(1, (goalVal / barMax) * 100)) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={s_bar.track}>
        <View style={[s_bar.fill, { width: `${fillPct}%` }]} />
        {goalPct != null && <View style={[s_bar.marker, { left: `${goalPct}%`, backgroundColor: '#34d399' }]} />}
        <View style={[s_bar.marker, { left: `${fillPct}%`, backgroundColor: '#67e8f9' }]} />
      </View>
    </View>
  );
}

const s_bar = StyleSheet.create({
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', position: 'relative' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: 'rgba(103,232,249,0.18)' },
  marker: { position: 'absolute', top: -3, width: 10, height: 10, borderRadius: 5, marginLeft: -5 },
});

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function WeightScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [unit, setUnit] = useState('kg');
  const [wkViewMode, setWkViewMode] = useState('week'); // 'week' | 'month'
  const [trendRangeDays, setTrendRangeDays] = useState(30); // 30 | 60 | 90 | 0(all)

  const [showLogSheet, setShowLogSheet] = useState(false);
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [weightInput, setWeightInput] = useState('');
  const [note, setNote] = useState('');
  const [goalInput, setGoalInput] = useState('');

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['weight', user?.id],
    queryFn: () => fetchWeightData(user.id),
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
  });

  const logs = data?.logs ?? [];
  const goalKg = data?.profile?.weight_goal_kg ?? null;

  const sortedDesc = useMemo(() => [...logs].sort((a, b) => b.logged_at.localeCompare(a.logged_at)), [logs]);
  const sortedAsc = useMemo(() => [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at)), [logs]);

  const logMut = useMutation({
    mutationFn: ({ date, weight: w, note: logNote }) => logWeight(user.id, { date, weight: w, note: logNote }),
    onSuccess: () => {
      qc.invalidateQueries(['weight', user.id]);
      qc.invalidateQueries(['home', user.id]);
      setShowLogSheet(false); setWeightInput(''); setNote('');
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateWeightGoal(user.id, fromDisp(parseFloat(goal), unit)),
    onSuccess: () => { qc.invalidateQueries(['weight', user.id]); setGoalInput(''); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteWeightLog,
    onSuccess: () => { qc.invalidateQueries(['weight', user.id]); qc.invalidateQueries(['home', user.id]); },
  });

  const mk = `${year}-${String(month + 1).padStart(2, '0')}`;
  const mWeights = useMemo(() => sortedDesc.filter(w => w.logged_at.startsWith(mk)), [sortedDesc, mk]);
  const mSortedAsc = useMemo(() => [...mWeights].sort((a, b) => a.logged_at.localeCompare(b.logged_at)), [mWeights]);

  const logsByDate = useMemo(() => {
    const m = {};
    logs.forEach(l => { if (l.weight) m[l.logged_at] = l.weight; });
    return m;
  }, [logs]);

  const latest = sortedDesc[0];
  const prevEntry = sortedDesc[1];
  const vsPrev = latest && prevEntry ? +(latest.weight - prevEntry.weight).toFixed(1) : null;

  const mMax = mWeights.length ? Math.max(...mWeights.map(w => w.weight)) : null;
  const mMin = mWeights.length ? Math.min(...mWeights.map(w => w.weight)) : null;
  const mAvg = mWeights.length ? mWeights.reduce((s, w) => s + w.weight, 0) / mWeights.length : null;
  const mChange = mSortedAsc.length >= 2 ? mSortedAsc[mSortedAsc.length - 1].weight - mSortedAsc[0].weight : null;

  const allTimeStats = useMemo(() => {
    if (sortedAsc.length < 2) return null;
    const first = sortedAsc[0];
    const lastE = sortedAsc[sortedAsc.length - 1];
    const lost = first.weight - lastE.weight;
    const days = Math.max(1, (new Date(lastE.logged_at) - new Date(first.logged_at)) / 86400000);
    const rateKgWk = (lost / days) * 7;
    return { first, lost, rateKgWk, days };
  }, [sortedAsc]);

  const goalProgress = useMemo(() => {
    if (!goalKg || sortedAsc.length === 0) return null;
    const curKg = sortedDesc[0].weight;
    const startKg = sortedAsc[0].weight;
    const totalNeeded = Math.abs(startKg - goalKg) || 0.001;
    const done = Math.abs(startKg - curKg);
    const pct = Math.min(done / totalNeeded, 1) * 100;
    const toGo = curKg - goalKg;
    const days = Math.max(1, (new Date(sortedDesc[0].logged_at) - new Date(sortedAsc[0].logged_at)) / 86400000);
    const ratePerDay = (startKg - curKg) / days;
    let etaText = null;
    if (Math.abs(toGo) < 0.05) etaText = '🎉 Goal reached!';
    else if (ratePerDay > 0 && toGo > 0) {
      const etaDays = Math.round(toGo / ratePerDay);
      const etaDate = new Date(); etaDate.setDate(etaDate.getDate() + etaDays);
      etaText = `🗓 Est. ${MONTH_NAMES[etaDate.getMonth()]} ${etaDate.getDate()}`;
    }
    const rateWk = Math.abs(ratePerDay * 7);
    const rateText = `${ratePerDay > 0 ? 'Losing' : 'Gaining'} ~${toDisp(rateWk, unit).toFixed(1)}${unit}/wk`;
    return { pct, curKg, startKg, toGo, etaText, rateText };
  }, [goalKg, sortedAsc, sortedDesc, unit]);

  const allTimeMaxKg = useMemo(() => (logs.length ? Math.max(...logs.map(w => w.weight)) : 1), [logs]);

  const trendData = useMemo(() => {
    if (trendRangeDays === 0) return sortedAsc;
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - trendRangeDays);
    const cutoffStr = localDateStr(cutoff);
    return sortedAsc.filter(l => l.logged_at >= cutoffStr);
  }, [sortedAsc, trendRangeDays]);

  const trendStats = useMemo(() => {
    if (trendData.length < 2) return null;
    const first = toDisp(trendData[0].weight, unit);
    const lastV = toDisp(trendData[trendData.length - 1].weight, unit);
    const change = +(lastV - first).toFixed(1);
    const days = Math.max(1, (new Date(trendData[trendData.length - 1].logged_at) - new Date(trendData[0].logged_at)) / 86400000);
    const ratePerWk = days > 6 ? +((change / days) * 7).toFixed(2) : null;
    return { first, lastV, change, ratePerWk };
  }, [trendData, unit]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const SCREEN_W = Dimensions.get('window').width;
  const chartWidth = SCREEN_W - 32 - 32;

  const openLogSheet = () => {
    setLogDate(localDateStr(new Date()));
    setWeightInput('');
    setNote('');
    setShowLogSheet(true);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* App header */}
      <View style={styles.appHeader}>
        <Text style={styles.logoText}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
        <Text style={styles.screenLabel}>WEIGHT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.onlineDot} />
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
        </View>
      </View>

      {/* Month nav + unit toggle */}
      <View style={styles.topRow}>
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.monthBtn}>
            <Text style={styles.monthChevron}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{MONTH_FULL[month]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} style={styles.monthBtn}>
            <Text style={styles.monthChevron}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.segmentRow}>
          {['kg', 'lbs'].map(u => (
            <TouchableOpacity key={u} onPress={() => setUnit(u)} style={[styles.segmentBtn, unit === u && styles.segmentBtnActive]}>
              <Text style={[styles.segmentText, unit === u && styles.segmentTextActive]}>{u.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* ── Hero ── */}
            <View style={styles.heroCard}>
              <View style={styles.heroGradientBar} />
              <Text style={styles.heroNum}>{latest ? toDisp(latest.weight, unit).toFixed(1) : '—'}</Text>
              <Text style={styles.heroLabel}>{unit.toUpperCase()} · LATEST ENTRY</Text>
              <Text style={styles.heroSub}>
                {vsPrev != null ? `${vsPrev <= 0 ? '▼' : '▲'} ${Math.abs(toDisp(vsPrev, unit)).toFixed(1)} vs prev` : '— vs prev'}
              </Text>
              <View style={styles.tileGrid}>
                <Tile value={mMax != null ? toDisp(mMax, unit).toFixed(1) : '—'} label="PEAK" color={colors.text} />
                <Tile value={mMin != null ? toDisp(mMin, unit).toFixed(1) : '—'} label="LOWEST" color={colors.good} />
                <Tile value={mChange != null ? `${mChange >= 0 ? '−' : '+'}${Math.abs(toDisp(mChange, unit)).toFixed(1)}` : '—'} label="LOST" color={mChange != null && mChange >= 0 ? colors.good : colors.danger} />
                <Tile value={mAvg != null ? toDisp(mAvg, unit).toFixed(1) : '—'} label="MO.AVG" color={colors.text} />
              </View>
            </View>

            {/* ── Goal Progress ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>GOAL PROGRESS</Text>
              <View style={styles.goalProgressRow}>
                <CircularGauge
                  percent={goalProgress ? goalProgress.pct : 0}
                  size={110} strokeWidth={10} color={colors.accent}
                  value={goalProgress ? `${Math.round(goalProgress.pct)}%` : '—'}
                  label="DONE"
                />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <View style={styles.goalStatRow}>
                    <Text style={styles.goalStatLabel}>NOW</Text>
                    <Text style={styles.goalStatVal}>{goalProgress ? toDisp(goalProgress.curKg, unit).toFixed(1) : '—'}{unit}</Text>
                  </View>
                  <View style={styles.goalStatRow}>
                    <Text style={styles.goalStatLabel}>TARGET</Text>
                    <Text style={styles.goalStatVal}>{goalKg ? toDisp(goalKg, unit).toFixed(1) : '—'}{unit}</Text>
                  </View>
                  <View style={styles.goalStatRow}>
                    <Text style={styles.goalStatLabel}>TO GO</Text>
                    <Text style={styles.goalStatVal}>{goalProgress ? Math.abs(toDisp(goalProgress.toGo, unit)).toFixed(1) : '—'}{unit}</Text>
                  </View>
                  {goalProgress?.etaText && <Text style={styles.goalEta}>{goalProgress.etaText}</Text>}
                  {goalProgress?.rateText && <Text style={styles.goalRate}>{goalProgress.rateText}</Text>}
                </View>
              </View>
              <View style={styles.goalRow}>
                <TextInput
                  style={styles.goalInput}
                  placeholder={goalKg ? toDisp(goalKg, unit).toFixed(1) : `Goal (${unit})`}
                  placeholderTextColor={colors.textDim}
                  value={goalInput}
                  onChangeText={setGoalInput}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  style={styles.setGoalBtn}
                  onPress={() => { if (goalInput) goalMut.mutate(goalInput); }}
                  disabled={goalMut.isPending}
                >
                  {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.setGoalBtnText}>SET GOAL</Text>}
                </TouchableOpacity>
              </View>
            </View>

            {/* ── All-time tiles ── */}
            <View style={styles.statTileRow}>
              <StatCell value={allTimeStats ? toDisp(allTimeStats.first.weight, unit).toFixed(1) : '—'} label="START" />
              <StatCell
                value={allTimeStats ? `${allTimeStats.lost >= 0 ? '−' : '+'}${Math.abs(toDisp(allTimeStats.lost, unit)).toFixed(1)}` : '—'}
                label="TOTAL CHANGE" color={allTimeStats && allTimeStats.lost >= 0 ? colors.good : colors.danger}
              />
              <StatCell
                value={allTimeStats ? `${toDisp(allTimeStats.rateKgWk, unit).toFixed(2)}` : '—'}
                label={`${unit.toUpperCase()}/WEEK`} color={allTimeStats && allTimeStats.rateKgWk <= 0 ? colors.good : colors.danger}
              />
            </View>

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>MONTHLY HEATMAP</Text>
                <View style={styles.hmLegend}>
                  <Text style={styles.hmLegendLabel}>Low</Text>
                  {['rgba(52,211,153,0.25)', 'rgba(52,211,153,0.5)', 'rgba(251,191,36,0.55)', 'rgba(248,113,113,0.7)'].map((c, i) => (
                    <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                  ))}
                  <Text style={styles.hmLegendLabel}>High</Text>
                </View>
              </View>
              <WeightHeatmap year={year} month={month} logsByDate={logsByDate} colors={colors} />
            </View>

            {/* ── 30-Day Trend ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>📈 TREND</Text>
                <View style={styles.segmentRow}>
                  {[30, 60, 90, 0].map(d => (
                    <TouchableOpacity key={d} onPress={() => setTrendRangeDays(d)} style={[styles.segmentBtn, trendRangeDays === d && styles.segmentBtnActive]}>
                      <Text style={[styles.segmentText, trendRangeDays === d && styles.segmentTextActive]}>{d === 0 ? 'ALL' : `${d}D`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#67e8f9' }]} /><Text style={styles.legendLabel}>Daily</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} /><Text style={styles.legendLabel}>7D Avg</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#34d399' }]} /><Text style={styles.legendLabel}>Goal</Text></View>
              </View>
              <WeightTrendChart data={trendData} unit={unit} goalKg={goalKg} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={styles.trendStatsRow}>
                  <WeekStatCell value={trendStats.first.toFixed(1)} label="START" color={colors.text} />
                  <WeekStatCell value={trendStats.lastV.toFixed(1)} label="LATEST" color={colors.accent} />
                  <WeekStatCell value={`${trendStats.change >= 0 ? '+' : ''}${trendStats.change.toFixed(1)}`} label="CHANGE" color={trendStats.change <= 0 ? colors.good : colors.danger} />
                  <WeekStatCell value={trendStats.ratePerWk != null ? trendStats.ratePerWk.toFixed(2) : '—'} label={`${unit}/WK`} color={trendStats.ratePerWk != null ? (trendStats.ratePerWk <= 0 ? colors.good : colors.danger) : colors.textMuted} />
                </View>
              )}
            </View>

            {/* ── Avg Weight (weekly/monthly) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>AVG WEIGHT</Text>
                <View style={styles.segmentRow}>
                  {['week', 'month'].map(v => (
                    <TouchableOpacity key={v} onPress={() => setWkViewMode(v)} style={[styles.segmentBtn, wkViewMode === v && styles.segmentBtnActive]}>
                      <Text style={[styles.segmentText, wkViewMode === v && styles.segmentTextActive]}>BY {v.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <WeeklyAvgChart logs={logs} viewMode={wkViewMode} unit={unit} colors={colors} width={chartWidth} />
            </View>

            {/* ── History ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>HISTORY</Text>
              {mWeights.length === 0 && <Text style={styles.emptyText}>No weight entries for this month.</Text>}
              {mWeights.map((log, idx) => {
                const nextLog = mWeights[idx + 1];
                const delta = nextLog ? +(log.weight - nextLog.weight).toFixed(2) : null;
                return (
                  <View key={log.id} style={styles.logRowWrap}>
                    <View style={styles.logRow}>
                      <Text style={styles.logDate}>{fmtDateShort(log.logged_at)}</Text>
                      <WeightHistoryBar value={toDisp(log.weight, unit)} goalVal={goalKg ? toDisp(goalKg, unit) : null} barMax={toDisp(allTimeMaxKg, unit)} colors={colors} />
                      <Text style={styles.logVal}>{toDisp(log.weight, unit).toFixed(1)}</Text>
                      {delta != null && (
                        <Text style={[styles.logDelta, { color: delta > 0 ? colors.danger : colors.good }]}>
                          {delta > 0 ? '+' : ''}{toDisp(delta, unit).toFixed(1)}
                        </Text>
                      )}
                      <TouchableOpacity
                        onPress={() => Alert.alert('Delete entry', `Remove ${fmtDateShort(log.logged_at)}?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                        ])}
                        style={styles.logDelBtn}
                      >
                        <Ionicons name="close" size={14} color={colors.textDim} />
                      </TouchableOpacity>
                    </View>
                    {log.notes ? <Text style={styles.logNote}>{log.notes}</Text> : null}
                  </View>
                );
              })}
            </View>
          </>
        )}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openLogSheet}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      {/* Log Weight bottom sheet */}
      <BottomSheet visible={showLogSheet} onClose={() => setShowLogSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>LOG WEIGHT</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sheetFieldLabel}>DATE</Text>
        <TextInput
          style={styles.sheetInput}
          value={logDate}
          onChangeText={setLogDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textDim}
        />

        <View style={{ height: 16 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={styles.sheetFieldLabel}>WEIGHT ({unit.toUpperCase()})</Text>
          {latest && <Text style={styles.lastHint}>↑ LAST: {toDisp(latest.weight, unit).toFixed(1)}{unit}</Text>}
        </View>
        <TextInput
          style={styles.sheetInput}
          value={weightInput}
          onChangeText={setWeightInput}
          placeholder={latest ? toDisp(latest.weight, unit).toFixed(1) : '70.0'}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        <View style={{ height: 16 }} />
        <Text style={styles.sheetFieldLabel}>NOTE (OPTIONAL)</Text>
        <TextInput
          style={styles.sheetNoteInput}
          value={note}
          onChangeText={setNote}
          placeholder="e.g. After workout, fasted..."
          placeholderTextColor={colors.textDim}
          multiline
        />

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => {
            if (weightInput) {
              const kg = fromDisp(parseFloat(weightInput), unit);
              logMut.mutate({ date: logDate, weight: kg, note });
            }
          }}
          disabled={logMut.isPending}
        >
          {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Weight</Text>}
        </TouchableOpacity>
      </BottomSheet>
    </SafeAreaView>
  );
}

function Tile({ value, label, color }) {
  return (
    <View style={s_tile.tile}>
      <Text style={[s_tile.val, { color }]}>{value}</Text>
      <Text style={s_tile.label}>{label}</Text>
    </View>
  );
}

const s_tile = StyleSheet.create({
  tile: { width: '48%', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12, marginBottom: 8, alignItems: 'center' },
  val: { fontSize: typography.md, fontFamily: fontFamily.monoBold },
  label: { fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 4 },
});

function StatCell({ value, label, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontFamily: fontFamily.monoBold, color: color || '#f5f0e8' }}>{value}</Text>
      <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function WeekStatCell({ value, label, color }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontFamily: fontFamily.monoBold, color }}>{value}</Text>
      <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2 }}>{label}</Text>
    </View>
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

  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8, gap: 8 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  monthBtn: { padding: 8 },
  monthChevron: { fontSize: 22, color: colors.text, fontWeight: '300' },
  monthLabel: { fontSize: typography.base, fontFamily: fontFamily.displayItalic, color: colors.text, fontStyle: 'italic' },

  segmentRow: { flexDirection: 'row', backgroundColor: colors.bgElevated, borderRadius: 20, padding: 2 },
  segmentBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18 },
  segmentBtnActive: { backgroundColor: colors.accent },
  segmentText: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 0.5 },
  segmentTextActive: { color: colors.bg },

  content: { paddingHorizontal: 16, paddingBottom: 16 },

  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono, marginBottom: 8 },

  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: colors.textMuted },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  logRowWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logDate: { width: 44, fontSize: 11, color: colors.text, fontFamily: fontFamily.bodyMedium },
  logNote: { fontSize: typography.xs, color: colors.textMuted, paddingLeft: 52, paddingTop: 6 },
  logVal: { fontSize: typography.sm, fontWeight: weight.bold, minWidth: 40, textAlign: 'right', fontFamily: fontFamily.monoBold, color: '#67e8f9' },
  logDelta: { fontSize: typography.xs, fontWeight: weight.bold, minWidth: 36, textAlign: 'right', fontFamily: fontFamily.mono },
  logDelBtn: { padding: 4 },

  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },

  heroCard: { backgroundColor: colors.bgCard, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 12, position: 'relative', overflow: 'hidden' },
  heroGradientBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#fb7185' },
  heroNum: { fontSize: 38, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent },
  heroLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  heroSub: { fontSize: typography.sm, color: colors.textDim, marginTop: 4, marginBottom: 14 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  goalProgressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  goalStatRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  goalStatLabel: { fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.mono },
  goalStatVal: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, fontFamily: fontFamily.monoBold },
  goalEta: { fontSize: 11, color: colors.accent, marginTop: 4 },
  goalRate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  goalRow: { flexDirection: 'row', gap: 10 },
  goalInput: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  setGoalBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  setGoalBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.sm },

  statTileRow: { flexDirection: 'row', backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },

  trendStatsRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 8 },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },

  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 2, fontFamily: fontFamily.mono },
  sheetFieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  lastHint: { fontSize: 10, color: colors.accent, fontFamily: fontFamily.mono },
  sheetNoteInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border, minHeight: 60, textAlignVertical: 'top', marginBottom: 18, marginTop: 6 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },
});
