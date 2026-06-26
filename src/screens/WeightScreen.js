import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Line, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import DatePickerField from '../components/ui/DatePickerField';
import MonthYearPicker from '../components/ui/MonthYearPicker';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import PaywallModal from '../components/ui/PaywallModal';
import { useSubscription } from '../context/SubscriptionContext';
import { useNotificationPrefs } from '../context/NotificationContext';
import { syncConditionalReminder } from '../lib/notifications';
import CircularGauge from '../components/CircularGauge';
import ScreenHeader from '../components/ScreenHeader';
import { useExportCard } from '../hooks/useExportCard';
import { SkeletonCard } from '../components/Skeleton';

// ─── Constants ──────────────────────────────────────────────────────────────
const KG_TO_LBS = 2.20462;
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function weekKeyOf(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return localDateStr(d);
}
function groupByWeek(items, getDate) {
  const groups = [];
  let cur = null;
  for (const item of items) {
    const wk = weekKeyOf(getDate(item));
    if (!cur || cur.key !== wk) {
      cur = { key: wk, items: [] };
      groups.push(cur);
    }
    cur.items.push(item);
  }
  return groups;
}
function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} (${DOW_SHORT[d.getDay()]})`;
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
function WeightHeatmap({ year, month, logsByDate, colors, unit, hasAccess = true, onLockedPress, cardWidth }) {
  const SCREEN_W = cardWidth ?? Dimensions.get('window').width;
  const cellSize = Math.floor((SCREEN_W - (cardWidth ? 12 : 92)) / 7);
  const firstDay = new Date(year, month, 1).getDay();
  let startDow = firstDay - 1; if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());
  const cutoffStr = localDateStr(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const vals = Object.entries(logsByDate)
    .filter(([ds]) => ds.startsWith(monthPrefix))
    .map(([, w]) => w);
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
    const locked = !hasAccess && ds < cutoffStr;
    cells.push({ key: ds, day: d, w, lvl, isToday: ds === todayStr, locked });
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
      <View style={{ flexDirection: 'row', marginBottom: 6 }}>
        {DOW_LABELS.map(d => (
          <View key={d} style={{ width: cellSize, marginHorizontal: 2, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: colors.textMuted, fontFamily: fontFamily.mono }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: (cellSize + 4) * 7 }}>
        {cells.map(cell => {
          if (cell.empty) return <View key={cell.key} style={{ width: cellSize, height: cellSize, margin: 2 }} />;
          if (cell.locked) {
            return (
              <TouchableOpacity
                key={cell.key}
                onPress={onLockedPress}
                style={[
                  { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim },
                  { width: cellSize, height: cellSize },
                ]}
              >
                <Ionicons name="lock-closed" size={11} color={colors.textDim} />
                <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.textDim, marginTop: 1 }}>{cell.day}</Text>
              </TouchableOpacity>
            );
          }
          return (
            <View
              key={cell.key}
              style={[
                { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
                { width: cellSize, height: cellSize, backgroundColor: LVL_COLOR[cell.lvl] },
                cell.isToday && { borderWidth: 2, borderColor: '#f59e0b' },
              ]}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: fontFamily.mono, color: cell.lvl === 0 ? colors.textDim : colors.text }}>{cell.day}</Text>
              <Text style={{ fontSize: 8, fontWeight: '700', fontFamily: fontFamily.mono, marginTop: 1, color: cell.lvl === 0 ? colors.textDim : colors.text, opacity: cell.lvl === 0 ? 0.5 : 1 }}>
                {cell.w !== undefined ? toDisp(cell.w, unit).toFixed(1) : '—'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// Catmull-Rom → cubic-bezier smoothing for a polyline's points
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
  const rangeAvgVal = rawVals.reduce((s, v) => s + v, 0) / rawVals.length;
  const goalDisp = goalKg ? toDisp(goalKg, unit) : null;

  const allVals = [...rawVals, ...avgVals, rangeAvgVal, ...(goalDisp ? [goalDisp] : [])];
  const minV = Math.min(...allVals) * 0.98;
  const maxV = Math.max(...allVals) * 1.02;
  const range = maxV - minV || 1;
  const n = data.length;
  const xs = pw / Math.max(n - 1, 1);
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + i * xs;

  const rawPts = rawVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const rawLine = smoothPath(rawPts);
  const avgPts = avgVals.map((v, i) => ({ x: toX(i), y: toY(v) }));
  const avgLine = smoothPath(avgPts);
  const rangeAvgY = toY(rangeAvgVal);
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
        return <Line key={i} x1={P.l} y1={y} x2={width - P.r} y2={y} stroke={colors.border} strokeWidth={1} />;
      })}

      {goalY != null && (
        <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#34d399" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4,4" />
      )}

      <Line x1={P.l} y1={rangeAvgY} x2={width - P.r} y2={rangeAvgY} stroke="#c4b5fd" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="2,3" />

      {avgPts.length > 1 && (
        <Path
          d={`${avgLine} L ${avgPts[avgPts.length - 1].x.toFixed(1)},${H - P.b} L ${avgPts[0].x.toFixed(1)},${H - P.b} Z`}
          fill="url(#wtFill)"
        />
      )}

      {rawPts.length > 1 && (
        <Path d={rawLine} fill="none" stroke="#67e8f9" strokeOpacity={0.35} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {avgPts.length > 1 && (
        <Path d={avgLine} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {rawPts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2} fill="#67e8f9" fillOpacity={0.6} />
      ))}

      {lastAvg && <Circle cx={lastAvg.x} cy={lastAvg.y} r={3.5} fill="#f59e0b" />}
    </Svg>
  );
}

// ─── Avg Weight: grouping + row computation ─────────────────────────────────
function computeAvgWeightRows(logs, viewMode, unit) {
  const sorted = [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at));
  const map = {};
  sorted.forEach(l => {
    const key = viewMode === 'month' ? l.logged_at.slice(0, 7) : weekKeyOf(l.logged_at);
    if (!map[key]) map[key] = [];
    map[key].push(l.weight);
  });
  const groups = Object.keys(map).sort().map(key => ({
    key, avg: map[key].reduce((s, w) => s + w, 0) / map[key].length,
  }));
  const allDisp = groups.map(g => toDisp(g.avg, unit));
  const maxLost = Math.max(...allDisp.map((_, i, a) => Math.abs(+(a[0] - a[i]).toFixed(1))), 0.001);

  const rows = groups.map((g, i) => {
    const dispVal = allDisp[i];
    const delta = i === 0 ? null : +(dispVal - allDisp[i - 1]).toFixed(1);
    const cumLost = +(allDisp[0] - dispVal).toFixed(1);
    const periodLabel = viewMode === 'month'
      ? MONTH_NAMES[parseInt(g.key.slice(5, 7), 10) - 1] + ' ' + g.key.slice(0, 4)
      : `Wk ${i + 1}`;
    const dateLabel = viewMode === 'month'
      ? MONTH_NAMES[parseInt(g.key.slice(5, 7), 10) - 1].slice(0, 3)
      : (() => { const d = new Date(g.key + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}`; })();
    return {
      key: g.key, periodLabel, dateLabel, dispVal, delta, cumLost,
      isFirst: i === 0, isLast: i === groups.length - 1,
      fillPct: Math.min(100, Math.max(2, (Math.abs(cumLost) / maxLost) * 100)),
    };
  });

  return { groups, allDisp, rows, maxLost };
}

// ─── Avg Weight: smooth trend chart with min/max + date axis labels ────────
function AvgWeightChart({ allDisp, dateLabels, unit, colors, width }) {
  const H = 110;
  const P = { t: 16, r: 6, b: 18, l: 6 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;
  const minV = Math.min(...allDisp);
  const maxV = Math.max(...allDisp);
  const range = (maxV - minV) || 1;
  const toY = v => P.t + ph - ((v - minV) / range) * ph;
  const toX = i => P.l + (i * pw) / Math.max(allDisp.length - 1, 1);
  const pts = allDisp.map((v, i) => ({ x: toX(i), y: toY(v) }));

  let linePath = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2;
    linePath += ` Q ${p0.x.toFixed(1)},${p0.y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
  }
  linePath += ` L ${pts[pts.length - 1].x.toFixed(1)},${pts[pts.length - 1].y.toFixed(1)}`;
  const fillPath = `M ${pts[0].x.toFixed(1)},${(H - P.b).toFixed(1)} ${linePath.slice(linePath.indexOf('M') + 1)} L ${pts[pts.length - 1].x.toFixed(1)},${(H - P.b).toFixed(1)} Z`;

  const labelStep = Math.max(1, Math.ceil(dateLabels.length / 6));

  return (
    <View>
      <Text style={{ position: 'absolute', top: 0, left: 0, fontSize: 9, fontFamily: fontFamily.mono, color: colors.textDim }}>
        {maxV.toFixed(1)}
      </Text>
      <Text style={{ position: 'absolute', top: H - P.b - 12, left: 0, fontSize: 9, fontFamily: fontFamily.mono, color: colors.textDim }}>
        {minV.toFixed(1)}
      </Text>
      <Svg width={width} height={H}>
        <Defs>
          <LinearGradient id="avgFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.accent} stopOpacity="0.22" />
            <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Line x1={P.l} y1={P.t} x2={width - P.r} y2={P.t} stroke={colors.border} strokeWidth={1} />
        <Line x1={P.l} y1={H - P.b} x2={width - P.r} y2={H - P.b} stroke={colors.border} strokeWidth={1} />
        {pts.length > 1 && <Path d={fillPath} fill="url(#avgFill)" />}
        <Path d={linePath} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <Circle
            key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 4 : 0}
            fill={colors.accent} stroke={i === pts.length - 1 ? colors.bgCard : 'none'}
            strokeWidth={i === pts.length - 1 ? 2 : 0}
          />
        ))}
      </Svg>
      <View style={{ height: 14, marginTop: 2 }}>
        {dateLabels.map((lbl, i) => (
          (i % labelStep === 0 || i === dateLabels.length - 1) ? (
            <Text
              key={i}
              style={{
                position: 'absolute', left: toX(i) - 14, width: 30, textAlign: 'center',
                fontSize: 9, fontFamily: fontFamily.mono, color: colors.textDim,
              }}
            >
              {lbl}
            </Text>
          ) : null
        ))}
      </View>
    </View>
  );
}

// ─── Avg Weight: trend pill + row ───────────────────────────────────────────
function trendPillFor(row, colors) {
  if (row.isFirst) return { bg: 'rgba(148,163,184,0.12)', color: colors.textMuted, label: '− START' };
  if (Math.abs(row.delta) < 0.05) return { bg: 'rgba(148,163,184,0.12)', color: colors.textMuted, label: '→ 0.0' };
  if (row.delta < 0) return { bg: 'rgba(52,211,153,0.15)', color: colors.good, label: `▼ ${Math.abs(row.delta).toFixed(1)}` };
  return { bg: 'rgba(248,113,113,0.15)', color: colors.danger, label: `▲ ${Math.abs(row.delta).toFixed(1)}` };
}

function AvgWeightRow({ row, unit, colors }) {
  const pill = trendPillFor(row, colors);
  const barColor = row.cumLost > 0 ? colors.danger : colors.good;
  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
      row.isLast && { backgroundColor: colors.dim, borderRadius: 8, paddingHorizontal: 6 },
    ]}>
      <View style={{ flex: 0.85 }}>
        <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>
          {row.periodLabel}{row.isLast ? <Text style={{ color: colors.accent, fontWeight: '700' }}> NOW</Text> : null}
        </Text>
      </View>
      <View style={{ flex: 0.95 }}>
        <Text style={{ fontSize: 13, fontFamily: fontFamily.monoBold, color: colors.text }}>{row.dispVal.toFixed(1)}{unit}</Text>
      </View>
      <View style={{ flex: 0.85 }}>
        <View style={{ alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: pill.bg }}>
          <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, color: pill.color }}>{pill.label}</Text>
        </View>
      </View>
      <View style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.dim }}>
          <View style={{ height: 5, borderRadius: 3, width: `${row.fillPct}%`, backgroundColor: barColor }} />
        </View>
        <Text style={{ fontSize: 10, fontFamily: fontFamily.mono, color: colors.textMuted, minWidth: 40, textAlign: 'right' }}>
          {row.cumLost > 0 ? '+' : ''}{row.cumLost.toFixed(1)}{unit}
        </Text>
      </View>
    </View>
  );
}

// ─── Avg Weight: locked row teaser (free users, weeks beyond the first 4) ──
function AvgWeightLockedRow({ periodLabel, colors, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flex: 0.85 }}>
        <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>{periodLabel}</Text>
      </View>
      <View style={{ flex: 0.95 }}>
        <Text style={{ fontSize: 13, fontFamily: fontFamily.monoBold, color: colors.textDim }}>••.•kg</Text>
      </View>
      <View style={{ flex: 0.85 }}>
        <View style={{ alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(148,163,184,0.12)' }}>
          <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.textDim }}>•••</Text>
        </View>
      </View>
      <View style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <Ionicons name="lock-closed" size={11} color={colors.textDim} />
        <Text style={{ fontSize: 10, fontFamily: fontFamily.mono, color: colors.textDim }}>PRO</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Avg Weight: full section (collapsed summary or expanded chart+table) ──
function AvgWeightSection({ logs, viewMode, unit, colors, width, expanded, hasAccess, onLockedPress }) {
  const { allDisp, rows } = useMemo(() => computeAvgWeightRows(logs, viewMode, unit), [logs, viewMode, unit]);

  if (rows.length === 0) {
    return <Text style={{ color: colors.textDim, fontSize: typography.sm, textAlign: 'center', paddingVertical: 20 }}>Not enough data yet</Text>;
  }

  const lastRow = rows[rows.length - 1];

  if (!expanded) {
    const pill = trendPillFor(lastRow, colors);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>
            {lastRow.periodLabel} <Text style={{ color: colors.accent, fontWeight: '700' }}>NOW</Text>
          </Text>
        </View>
        <Text style={{ fontSize: 15, fontFamily: fontFamily.monoBold, color: colors.text, marginRight: 10 }}>
          {lastRow.dispVal.toFixed(1)}{unit}
        </Text>
        <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: pill.bg, marginRight: 10 }}>
          <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, color: pill.color }}>{pill.label}</Text>
        </View>
        <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>
          {lastRow.cumLost > 0 ? '+' : ''}{lastRow.cumLost.toFixed(1)}{unit}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <AvgWeightChart allDisp={allDisp} dateLabels={rows.map(r => r.dateLabel)} unit={unit} colors={colors} width={width} />
      <View style={{ flexDirection: 'row', paddingTop: 14, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ flex: 0.85, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim }}>
          {viewMode === 'month' ? 'MONTH' : 'WK'}
        </Text>
        <Text style={{ flex: 0.95, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim }}>AVG WEIGHT</Text>
        <Text style={{ flex: 0.85, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim }}>TREND</Text>
        <Text style={{ flex: 1.3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim, textAlign: 'right' }}>TOTAL LOST</Text>
      </View>
      {(hasAccess ? rows : rows.slice(0, 4)).map(row => <AvgWeightRow key={row.key} row={row} unit={unit} colors={colors} />)}
      {!hasAccess && rows.slice(4).map(row => (
        <AvgWeightLockedRow key={row.key} periodLabel={row.periodLabel} colors={colors} onPress={onLockedPress} />
      ))}
    </View>
  );
}

// ─── History slider bar row — ports renderBody()'s history list ────────────
function WeightHistoryBar({ value, goalVal, barMax, colors }) {
  const fillPct = Math.min(97, Math.max(2, (value / barMax) * 100));
  const goalPct = goalVal != null ? Math.min(99, Math.max(1, (goalVal / barMax) * 100)) : null;

  return (
    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.dim, position: 'relative' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: 'rgba(103,232,249,0.18)', width: `${fillPct}%` }} />
      {goalPct != null && <View style={{ position: 'absolute', top: -1, width: 6, height: 6, borderRadius: 3, marginLeft: -3, left: `${goalPct}%`, backgroundColor: '#34d399' }} />}
      <View style={{ position: 'absolute', top: -1, width: 6, height: 6, borderRadius: 3, marginLeft: -3, left: `${fillPct}%`, backgroundColor: '#67e8f9' }} />
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function WeightScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();

  const [unit, setUnit] = useState('kg');
  const [wkViewMode, setWkViewMode] = useState('week'); // 'week' | 'month'
  const [avgExpanded, setAvgExpanded] = useState(false);
  const avgWeightExport = useExportCard();
  const heatmapExport = useExportCard();
  const { hasAccess, isPro } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);
  const [trendRangeDays, setTrendRangeDays] = useState(30); // 30 | 60 | 90 | 0(all)

  const [showLogSheet, setShowLogSheet] = useState(false);
  const [logDate, setLogDate] = useState(localDateStr(new Date()));
  const [weightInput, setWeightInput] = useState('');
  const [note, setNote] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [showGoalSheet, setShowGoalSheet] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['weight', user?.id],
    queryFn: () => fetchWeightData(user.id),
    enabled: !!user?.id,
  });

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const logs = data?.logs ?? [];
  const goalKg = data?.profile?.weight_goal_kg ?? 60;

  const { prefs: notifPrefs, times: notifTimes } = useNotificationPrefs() ?? { prefs: {}, times: {} };
  const reminderTime = notifTimes.weightReminder ?? { hour: 8, minute: 0 };
  useEffect(() => {
    if (isLoading || !notifPrefs.weightReminder) {
      if (!notifPrefs.weightReminder) syncConditionalReminder('weightReminder', true, reminderTime.hour, reminderTime.minute, '', '');
      return;
    }
    const yday = new Date(); yday.setDate(yday.getDate() - 1);
    const ydayStr = localDateStr(yday);
    const loggedYesterday = logs.some(l => l.logged_at === ydayStr);
    syncConditionalReminder('weightReminder', loggedYesterday, reminderTime.hour, reminderTime.minute,
      "Don't forget your weigh-in", "You haven't logged yesterday's weight yet.");
  }, [isLoading, notifPrefs.weightReminder, logs, reminderTime.hour, reminderTime.minute]);

  const sortedDesc = useMemo(() => [...logs].sort((a, b) => b.logged_at.localeCompare(a.logged_at)), [logs]);
  const sortedAsc = useMemo(() => [...logs].sort((a, b) => a.logged_at.localeCompare(b.logged_at)), [logs]);

  const logMut = useMutation({
    mutationFn: ({ date, weight: w, note: logNote }) => logWeight(user.id, { date, weight: w, note: logNote }),
    onMutate: async ({ date, weight: w, note: logNote }) => {
      await qc.cancelQueries(['weight', user.id]);
      const previous = qc.getQueryData(['weight', user.id]);
      qc.setQueryData(['weight', user.id], (old) => {
        if (!old) return old;
        const rest = old.logs.filter(l => l.logged_at !== date);
        const optimisticLog = { id: `optimistic-${date}`, weight: w, notes: logNote || null, logged_at: date };
        return { ...old, logs: [optimisticLog, ...rest] };
      });
      setShowLogSheet(false); setWeightInput(''); setNote('');
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['weight', user.id], context.previous);
      Alert.alert('Error', e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['weight', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateWeightGoal(user.id, fromDisp(parseFloat(goal), unit)),
    onSuccess: () => { qc.invalidateQueries(['weight', user.id]); setGoalInput(''); setShowGoalSheet(false); },
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
    if (sortedAsc.length < 1) return null;
    const first = sortedAsc[0];
    const lastE = sortedAsc[sortedAsc.length - 1];
    const lost = first.weight - lastE.weight;
    const days = Math.max(1, (new Date(lastE.logged_at) - new Date(first.logged_at)) / 86400000);
    const rateKgWk = sortedAsc.length < 2 ? 0 : (lost / days) * 7;
    return { first, lost, rateKgWk, days };
  }, [sortedAsc]);

  const goalProgress = useMemo(() => {
    if (!goalKg || sortedAsc.length === 0) return null;
    const curKg = sortedDesc[0].weight;
    const startKg = sortedAsc[0].weight;
    const toGo = curKg - goalKg;
    const pct = Math.min(100, Math.max(0, 100 - (Math.abs(toGo) / curKg) * 100));
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

    const vals = trendData.map(e => toDisp(e.weight, unit));
    const avg = +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1);
    const goalDisp = goalKg ? toDisp(goalKg, unit) : null;
    const best = goalDisp != null
      ? +vals.reduce((b, v) => Math.abs(v - goalDisp) < Math.abs(b - goalDisp) ? v : b, vals[0]).toFixed(1)
      : +(change <= 0 ? Math.min(...vals) : Math.max(...vals)).toFixed(1);
    const totalDays = Math.round(days) + 1;

    return { first, lastV, change, ratePerWk, avg, best, loggedDays: trendData.length, totalDays };
  }, [trendData, unit, goalKg]);

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
      <ScreenHeader title="WEIGHT" colors={colors} />

      {/* Month nav + unit toggle */}
      <View style={styles.topRow}>
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.monthBtn}>
            <Text style={styles.monthChevron}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowMonthPicker(true)}>
            <Text style={styles.monthLabel}>{MONTH_FULL[month]} {year}</Text>
          </TouchableOpacity>
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
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {isLoading ? (
          <View>
            {/* Hero + goal ring */}
            <SkeletonCard lines={2} style={{ height: 140 }} />
            {/* Trend chart */}
            <SkeletonCard lines={1} style={{ height: 160 }} />
            {/* Month heatmap */}
            <SkeletonCard lines={4} />
            {/* History list rows */}
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </View>
        ) : (
          <>
            {/* ── Hero + Goal Progress + Stats (merged) ── */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View>
                  <Text style={styles.heroNum}>{latest ? toDisp(latest.weight, unit).toFixed(1) : '—'}</Text>
                  <Text style={styles.heroLabel}>{unit.toUpperCase()} · LATEST ENTRY</Text>
                  <Text style={[styles.heroSub, vsPrev != null && { color: vsPrev <= 0 ? colors.good : colors.danger }]}>
                    {vsPrev != null ? `${vsPrev <= 0 ? '▼' : '▲'} ${Math.abs(toDisp(vsPrev, unit)).toFixed(1)} vs prev` : '— vs prev'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.goalPillBtn}
                  onPress={() => { if (!isPro) { setShowPaywall(true); return; } setGoalInput(goalKg ? String(toDisp(goalKg, unit)) : ''); setShowGoalSheet(true); }}
                >
                  <Text style={styles.goalPillBtnText}>🎯 {toDisp(goalKg, unit).toFixed(1)}{unit}</Text>
                  <Ionicons name={isPro ? 'pencil' : 'lock-closed'} size={11} color={colors.accent} />
                </TouchableOpacity>
              </View>

              <View style={styles.goalProgressRow}>
                <CircularGauge
                  percent={goalProgress ? goalProgress.pct : 0}
                  size={56} strokeWidth={6} color={colors.accent}
                  value={goalProgress ? `${Math.abs(toDisp(goalProgress.toGo, unit)).toFixed(1)}${unit}` : '—'}
                  label="TO GO"
                  valueStyle={{ color: colors.text }}
                  labelStyle={{ color: colors.textMuted }}
                />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <View style={styles.statTileRowInline}>
                    <StatCell value={goalProgress ? `${toDisp(goalProgress.curKg, unit).toFixed(1)}${unit}` : '—'} label="NOW" colors={colors} />
                    <View style={styles.statDividerInline} />
                    <StatCell value={goalKg ? `${toDisp(goalKg, unit).toFixed(1)}${unit}` : '—'} label="TARGET" colors={colors} />
                    <View style={styles.statDividerInline} />
                    <StatCell value={goalProgress ? `${Math.abs(toDisp(goalProgress.toGo, unit)).toFixed(1)}${unit}` : '—'} label="TO GO" colors={colors} />
                  </View>
                  {(goalProgress?.etaText || goalProgress?.rateText) && (
                    <Text style={styles.goalEta}>
                      {[goalProgress?.etaText, goalProgress?.rateText].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.sectionDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerLabel}>{MONTH_FULL[month].toUpperCase()} {year}</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.statTileRowInline}>
                <StatCell value={mMax != null ? toDisp(mMax, unit).toFixed(1) : '—'} label="PEAK" colors={colors} />
                <View style={styles.statDividerInline} />
                <StatCell value={mMin != null ? toDisp(mMin, unit).toFixed(1) : '—'} label="LOW" color={colors.good} colors={colors} />
                <View style={styles.statDividerInline} />
                <StatCell value={mAvg != null ? toDisp(mAvg, unit).toFixed(1) : '—'} label="AVG" colors={colors} />
              </View>

              <View style={styles.sectionDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerLabel}>ALL-TIME</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.statTileRowInline}>
                <StatCell value={allTimeStats ? toDisp(allTimeStats.first.weight, unit).toFixed(1) : '—'} label="START" colors={colors} />
                <View style={styles.statDividerInline} />
                <StatCell
                  value={allTimeStats ? `${allTimeStats.lost >= 0 ? '−' : '+'}${Math.abs(toDisp(allTimeStats.lost, unit)).toFixed(1)}` : '—'}
                  label="CHANGE" color={allTimeStats && allTimeStats.lost >= 0 ? colors.good : colors.danger} colors={colors}
                />
                <View style={styles.statDividerInline} />
                <StatCell
                  value={allTimeStats ? `${toDisp(allTimeStats.rateKgWk, unit).toFixed(2)}` : '—'}
                  label={`${unit.toUpperCase()}/WK`} color={allTimeStats && allTimeStats.rateKgWk <= 0 ? colors.good : colors.danger} colors={colors}
                />
              </View>
            </View>

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>MONTHLY HEATMAP</Text>
                <TouchableOpacity
                  onPress={() => (hasAccess ? heatmapExport.exportCard() : setShowPaywall(true))}
                  disabled={heatmapExport.exporting}
                  style={styles.avgViewToggleBtn}
                >
                  {heatmapExport.exporting ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="share-outline" size={14} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>
              <View style={[styles.hmLegend, styles.hmLegendRow]}>
                <Text style={styles.hmLegendLabel}>Low</Text>
                {['rgba(52,211,153,0.25)', 'rgba(52,211,153,0.5)', 'rgba(251,191,36,0.55)', 'rgba(248,113,113,0.7)'].map((c, i) => (
                  <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                ))}
                <Text style={styles.hmLegendLabel}>High</Text>
              </View>
              <WeightHeatmap year={year} month={month} logsByDate={logsByDate} colors={colors} unit={unit} hasAccess={hasAccess} onLockedPress={() => setShowPaywall(true)} />
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate
                ref={heatmapExport.ref}
                title="Monthly Heatmap"
                subtitle={`${MONTH_NAMES[month]} ${year}`}
                colors={colors}
                width={340}
              >
                <WeightHeatmap year={year} month={month} logsByDate={logsByDate} colors={colors} unit={unit} hasAccess={true} cardWidth={258} />
              </ExportCardTemplate>
            </View>

            {/* ── 30-Day Trend ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>WEIGHT - TREND</Text>
                <View style={styles.segmentRow}>
                  {[30, 60, 90, 0].map(d => (
                    <TouchableOpacity
                      key={d}
                      onPress={() => {
                        if (d !== 30 && !hasAccess) { setShowPaywall(true); return; }
                        setTrendRangeDays(d);
                      }}
                      style={[styles.segmentBtn, trendRangeDays === d && styles.segmentBtnActive]}
                    >
                      <Text style={[styles.segmentText, trendRangeDays === d && styles.segmentTextActive]}>{d === 0 ? 'ALL' : `${d}D`}{d !== 30 && !hasAccess ? ' 🔒' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#67e8f9' }]} /><Text style={styles.legendLabel}>Daily</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} /><Text style={styles.legendLabel}>7D Avg</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#c4b5fd' }]} /><Text style={styles.legendLabel}>{trendRangeDays === 0 ? 'All' : `${trendRangeDays}D`} Avg</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#34d399' }]} /><Text style={styles.legendLabel}>Goal</Text></View>
              </View>
              <WeightTrendChart data={trendData} unit={unit} goalKg={goalKg} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={styles.trendStatsRow}>
                  <WeekStatCell value={trendStats.avg.toFixed(1)} label="AVG" color={colors.accent} colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={`${trendStats.loggedDays}/${trendStats.totalDays}`} label="LOGGED DAYS" color={colors.good} colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={trendStats.best.toFixed(1)} label="BEST" color="#22d3ee" colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={`${trendStats.change >= 0 ? '+' : ''}${trendStats.change.toFixed(1)}`} label="CHANGE" color={trendStats.change <= 0 ? colors.good : colors.danger} colors={colors} />
                </View>
              )}
            </View>

            {/* ── Avg Weight (weekly/monthly) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>AVG WEIGHT</Text>
                <TouchableOpacity
                  onPress={() => (hasAccess ? avgWeightExport.exportCard() : setShowPaywall(true))}
                  disabled={avgWeightExport.exporting}
                  style={styles.avgViewToggleBtn}
                >
                  {avgWeightExport.exporting ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Ionicons name="share-outline" size={14} color={colors.textMuted} />
                  )}
                </TouchableOpacity>
              </View>
              {avgExpanded && (
                <View style={[styles.segmentRow, { marginBottom: 12 }]}>
                  {['week', 'month'].map(v => (
                    <TouchableOpacity
                      key={v}
                      onPress={() => setWkViewMode(v)}
                      style={[styles.segmentBtn, { flex: 1, alignItems: 'center' }, wkViewMode === v && styles.segmentBtnActive]}
                    >
                      <Text style={[styles.segmentText, wkViewMode === v && styles.segmentTextActive]}>BY {v.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <AvgWeightSection key={wkViewMode} logs={logs} viewMode={wkViewMode} unit={unit} colors={colors} width={chartWidth} expanded={avgExpanded} hasAccess={hasAccess} onLockedPress={() => setShowPaywall(true)} />
              <TouchableOpacity
                onPress={() => setAvgExpanded(v => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 12 }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.accent }}>
                  {avgExpanded ? 'Collapse' : 'Expand'}
                </Text>
                <Ionicons name={avgExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.accent} />
              </TouchableOpacity>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate
                ref={avgWeightExport.ref}
                title="Avg Weight"
                subtitle={`${wkViewMode === 'month' ? 'Monthly' : 'Weekly'} averages`}
                colors={colors}
                width={340}
              >
                <AvgWeightSection key={`export-${wkViewMode}`} logs={logs} viewMode={wkViewMode} unit={unit} colors={colors} width={300} expanded={true} hasAccess={true} />
              </ExportCardTemplate>
            </View>

            {/* ── History ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>HISTORY</Text>
              {mWeights.length === 0 && <Text style={styles.emptyText}>No weight entries for this month.</Text>}
              {groupByWeek(
                mWeights.map((log, idx) => {
                  const nextLog = mWeights[idx + 1];
                  return { log, delta: nextLog ? +(log.weight - nextLog.weight).toFixed(2) : null };
                }),
                e => e.log.logged_at
              ).map(week => (
                <View key={week.key} style={styles.weekGroupBox}>
                  {week.items.map(({ log, delta }, i) => (
                    <View key={log.id} style={[styles.logRowWrap, i === week.items.length - 1 && { borderBottomWidth: 0 }]}>
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
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
        <View style={{ height: 90 }} />
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={openLogSheet}>
        <Ionicons name="add" size={28} color={colors.bg} />
      </TouchableOpacity>

      <MonthYearPicker
        visible={showMonthPicker}
        month={month}
        year={year}
        onSelect={(m, y) => { setMonth(m); setYear(y); }}
        onClose={() => setShowMonthPicker(false)}
      />

      {/* Log Weight bottom sheet */}
      <BottomSheet visible={showLogSheet} onClose={() => setShowLogSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>LOG WEIGHT</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sheetFieldLabel}>DATE</Text>
        <DatePickerField
          value={logDate}
          onChange={setLogDate}
          colors={colors}
          maxDate={localDateStr(new Date())}
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

      {/* Weight Goal bottom sheet */}
      <BottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>SET WEIGHT GOAL</Text>
          <TouchableOpacity onPress={() => setShowGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{(parseFloat(goalInput) || (goalKg ? toDisp(goalKg, unit) : '—'))}{unit}</Text>
        <Text style={styles.goalBigSub}>target weight</Text>

        <TextInput
          style={styles.sheetInput}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={goalKg ? toDisp(goalKg, unit).toFixed(1) : `Goal (${unit})`}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        {latest && (
          <>
            <Text style={styles.sheetFieldLabel}>QUICK PRESETS</Text>
            <View style={styles.quickAddRow}>
              {[-10, -5, -2, 2, 5, 10].map(delta => {
                const presetVal = +(toDisp(latest.weight, unit) + delta).toFixed(1);
                return (
                  <TouchableOpacity
                    key={delta}
                    style={[styles.quickAddChip, parseFloat(goalInput) === presetVal && { backgroundColor: colors.accent }]}
                    onPress={() => setGoalInput(String(presetVal))}
                  >
                    <Text style={[styles.quickAddChipText, parseFloat(goalInput) === presetVal && { color: colors.bg }]}>
                      {delta > 0 ? '+' : ''}{delta}{unit}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => { if (goalInput) goalMut.mutate(goalInput); }}
          disabled={goalMut.isPending}
        >
          {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Goal</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

function StatCell({ value, label, color, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontFamily: fontFamily.monoBold, color: color || colors.text }}>{value}</Text>
      <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

function WeekStatCell({ value, label, color, colors }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: typography.base, fontFamily: fontFamily.monoBold, color: color || colors.text }}>{value}</Text>
      <Text style={{ fontSize: 9, color: colors.textMuted, fontFamily: fontFamily.bodyBold, letterSpacing: 0.5, marginTop: 2 }}>{label}</Text>
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

  avgViewToggleBtn: { padding: 6, borderRadius: 14, backgroundColor: colors.bgElevated },
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

  logRowWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 9 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logDate: { width: 76, fontSize: 10, color: colors.text, fontFamily: fontFamily.bodyMedium },
  logNote: { fontSize: typography.xs, color: colors.textMuted, paddingLeft: 52, paddingTop: 4 },
  logVal: { fontSize: 12, fontWeight: weight.bold, minWidth: 40, textAlign: 'right', fontFamily: fontFamily.monoBold, color: '#67e8f9' },
  logDelta: { fontSize: 10, fontWeight: weight.bold, minWidth: 36, textAlign: 'right', fontFamily: fontFamily.mono },
  logDelBtn: { padding: 3 },
  weekGroupBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 8, marginBottom: 10 },

  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },
  hmLegendRow: { justifyContent: 'flex-end', marginBottom: 10 },

  heroCard: { backgroundColor: colors.bgCard, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: colors.border, marginBottom: 12, position: 'relative', overflow: 'hidden' },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroNum: { fontSize: 38, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent },
  heroLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  heroSub: { fontSize: typography.sm, color: colors.textDim, marginTop: 4 },

  sectionDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1, fontFamily: fontFamily.mono },
  statTileRowInline: { flexDirection: 'row', alignItems: 'center' },
  statDividerInline: { width: 1, height: 24, backgroundColor: colors.border },

  goalProgressRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  goalEta: { fontSize: 11, color: colors.accent, marginTop: 4 },
  goalRate: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  goalPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accent + '1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent + '66',
  },
  goalPillBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.monoBold },
  goalBigVal: { fontSize: 40, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent, textAlign: 'center', marginTop: 8 },
  goalBigSub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', marginBottom: 16 },
  quickAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  quickAddChip: { backgroundColor: colors.bgElevated, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.border },
  quickAddChipText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.text },


  trendStatsRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 8 },

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
