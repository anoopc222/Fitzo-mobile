import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Svg, { Line, Circle, Path, Defs, LinearGradient, Stop, Text as SvgText, Polygon } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
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
import EmptyState from '../components/EmptyState';

// ─── Constants ──────────────────────────────────────────────────────────────
const KG_TO_LBS = 2.20462;
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];
const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function linearTrend(logs) {
  // logs: array of {logged_at: string, weight: number}, sorted oldest first
  if (logs.length < 3) return null;
  const n = logs.length;
  const xs = logs.map((_, i) => i);
  const ys = logs.map(l => l.weight);
  const xMean = xs.reduce((a,b) => a+b,0)/n;
  const yMean = ys.reduce((a,b) => a+b,0)/n;
  const slope = xs.reduce((s,x,i)=>s+(x-xMean)*(ys[i]-yMean),0)/xs.reduce((s,x)=>s+(x-xMean)**2,0);
  // slope is kg per log entry — convert to per week using average days between logs
  const days = (new Date(logs[n-1].logged_at) - new Date(logs[0].logged_at)) / 86400000;
  const daysPerEntry = days / (n - 1) || 1;
  const kgPerWeek = slope * (7 / daysPerEntry);
  return { kgPerWeek: Math.round(kgPerWeek * 100) / 100, latest: ys[n-1] };
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
  // Normalise to date string; deduplicate keeping the most-recent entry per day
  const seen = new Set();
  const normLogs = (logs.data ?? [])
    .map(l => ({ ...l, logged_at: l.logged_at.slice(0, 10) }))
    .filter(l => {
      if (seen.has(l.logged_at)) return false;
      seen.add(l.logged_at);
      return true;
    });
  return { logs: normLogs, profile: profile.data };
}

async function logWeight(userId, { date, weight: weightKg, note }) {
  // Find any existing log(s) on the same calendar day using a date range
  const { data: existing, error: fetchErr } = await supabase
    .from('weight_logs')
    .select('id')
    .eq('user_id', userId)
    .gte('logged_at', `${date}T00:00:00`)
    .lte('logged_at', `${date}T23:59:59`)
    .order('logged_at', { ascending: false });
  if (fetchErr) throw fetchErr;

  const fields = { weight: weightKg, notes: note || null };

  if (existing && existing.length > 0) {
    // Update the most-recent entry and delete any accidental duplicates
    const [keep, ...dupes] = existing;
    const { error } = await supabase.from('weight_logs').update(fields).eq('id', keep.id);
    if (error) throw error;
    if (dupes.length > 0) {
      await supabase.from('weight_logs').delete().in('id', dupes.map(d => d.id));
    }
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
function WeightHeatmap({ year, month, logsByDate, colors, unit, hasAccess = true, onLockedPress, onDayPress, cardWidth }) {
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
          const CellWrapper = onDayPress ? TouchableOpacity : View;
          return (
            <CellWrapper
              key={cell.key}
              activeOpacity={onDayPress ? 0.7 : undefined}
              onPress={onDayPress ? () => onDayPress(cell.key, cell.w) : undefined}
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
            </CellWrapper>
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
  const { t } = useTranslation();
  const H = 170;
  const P = { t: 18, r: 8, b: 22, l: 30 };
  const pw = width - P.l - P.r;
  const ph = H - P.t - P.b;

  if (data.length < 2) {
    return (
      <View style={{ height: H, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textDim, fontSize: typography.sm }}>{t('weight.notEnoughData')}</Text>
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

  // Scale the Y-axis from the actual readings only — pulling the goal weight
  // into this range (when it's far from current weight) would compress real
  // day-to-day variation into an unreadable sliver. The goal line is instead
  // clamped into view with an off-screen indicator below.
  const dataVals = [...rawVals, ...avgVals, rangeAvgVal];
  const dataMin = Math.min(...dataVals);
  const dataMax = Math.max(...dataVals);
  const dataPad = Math.max((dataMax - dataMin) * 0.12, 0.3);
  const minV = dataMin - dataPad;
  const maxV = dataMax + dataPad;
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
  const goalOffScreen = goalDisp != null && (goalDisp < minV || goalDisp > maxV);
  const goalY = goalDisp != null ? Math.min(Math.max(toY(goalDisp), P.t), P.t + ph) : null;
  const lastAvg = avgPts[avgPts.length - 1];
  const yLabelFmt = v => v.toFixed(v % 1 === 0 ? 0 : 1);

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
        const v = maxV - (range / 3) * i;
        return (
          <React.Fragment key={i}>
            <Line x1={P.l} y1={y} x2={width - P.r} y2={y} stroke={colors.border} strokeWidth={1} />
            <SvgText x={P.l - 4} y={y + 3} fontSize={9} fill={colors.textDim} textAnchor="end">{yLabelFmt(v)}</SvgText>
          </React.Fragment>
        );
      })}

      {goalY != null && (
        <>
          <Line x1={P.l} y1={goalY} x2={width - P.r} y2={goalY} stroke="#34d399" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4,4" />
          {goalOffScreen && (
            <Polygon
              points={
                goalDisp < minV
                  ? `${width - P.r - 5},${goalY - 5} ${width - P.r + 5},${goalY - 5} ${width - P.r},${goalY + 4}`
                  : `${width - P.r - 5},${goalY + 5} ${width - P.r + 5},${goalY + 5} ${width - P.r},${goalY - 4}`
              }
              fill="#34d399"
            />
          )}
        </>
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
function trendPillFor(row, colors, t) {
  if (row.isFirst) return { bg: 'rgba(148,163,184,0.12)', color: colors.textMuted, label: t('weight.trendStart') };
  if (Math.abs(row.delta) < 0.05) return { bg: 'rgba(148,163,184,0.12)', color: colors.textMuted, label: t('weight.trendFlat') };
  if (row.delta < 0) return { bg: 'rgba(52,211,153,0.15)', color: colors.good, label: t('weight.trendDown', { value: Math.abs(row.delta).toFixed(1) }) };
  return { bg: 'rgba(248,113,113,0.15)', color: colors.danger, label: t('weight.trendUp', { value: Math.abs(row.delta).toFixed(1) }) };
}

function AvgWeightRow({ row, unit, colors }) {
  const { t } = useTranslation();
  const pill = trendPillFor(row, colors, t);
  const barColor = row.isFirst || Math.abs(row.delta) < 0.05
    ? colors.textMuted
    : row.delta < 0 ? colors.good : colors.danger;
  return (
    <View style={[
      { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
      row.isLast && { backgroundColor: colors.dim, borderRadius: 8, paddingHorizontal: 6 },
    ]}>
      <View style={{ flex: 0.85 }}>
        <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>
          {row.periodLabel}{row.isLast ? <Text style={{ color: colors.accent, fontWeight: '700' }}> {t('weight.nowLabel')}</Text> : null}
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
  const { t } = useTranslation();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flex: 0.85 }}>
        <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>{periodLabel}</Text>
      </View>
      <View style={{ flex: 0.95 }}>
        <Text style={{ fontSize: 13, fontFamily: fontFamily.monoBold, color: colors.textDim }}>{t('weight.lockedValuePlaceholder')}</Text>
      </View>
      <View style={{ flex: 0.85 }}>
        <View style={{ alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(148,163,184,0.12)' }}>
          <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, color: colors.textDim }}>{t('weight.lockedTrendPlaceholder')}</Text>
        </View>
      </View>
      <View style={{ flex: 1.3, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
        <Ionicons name="lock-closed" size={11} color={colors.textDim} />
        <Text style={{ fontSize: 10, fontFamily: fontFamily.mono, color: colors.textDim }}>{t('weight.proLabel')}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Avg Weight: full section (collapsed summary or expanded chart+table) ──
function AvgWeightSection({ logs, viewMode, unit, colors, width, expanded, hasAccess, onLockedPress }) {
  const { t } = useTranslation();
  const { allDisp, rows } = useMemo(() => computeAvgWeightRows(logs, viewMode, unit), [logs, viewMode, unit]);

  if (rows.length === 0) {
    return <Text style={{ color: colors.textDim, fontSize: typography.sm, textAlign: 'center', paddingVertical: 20 }}>{t('weight.notEnoughData')}</Text>;
  }

  const lastRow = rows[rows.length - 1];

  if (!expanded) {
    const pill = trendPillFor(lastRow, colors, t);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, fontFamily: fontFamily.mono, color: colors.textMuted }}>
            {lastRow.periodLabel} <Text style={{ color: colors.accent, fontWeight: '700' }}>{t('weight.nowLabel')}</Text>
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
          {viewMode === 'month' ? t('weight.colMonth') : t('weight.colWeek')}
        </Text>
        <Text style={{ flex: 0.95, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim }}>{t('weight.colAvgWeight')}</Text>
        <Text style={{ flex: 0.85, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim }}>{t('weight.colTrend')}</Text>
        <Text style={{ flex: 1.3, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: fontFamily.mono, color: colors.textDim, textAlign: 'right' }}>{t('weight.colTotalLost')}</Text>
      </View>
      {(hasAccess ? rows : rows.slice(0, 4)).map(row => <AvgWeightRow key={row.key} row={row} unit={unit} colors={colors} />)}
      {!hasAccess && rows.slice(4).map(row => (
        <AvgWeightLockedRow key={row.key} periodLabel={row.periodLabel} colors={colors} onPress={onLockedPress} />
      ))}
    </View>
  );
}

// ─── History row — ports the Sleep/Steps log-row design (colored side bar +
// status pill) so weight entries are as readable as those screens. ─────────
function WeightLogRow({ log, delta, goalVal, unit, barMin, barMax, colors, onDelete, isLast, t }) {
  const value = toDisp(log.weight, unit);
  const span = barMax - barMin || 1;
  const pct = Math.min(100, Math.max(0, ((value - barMin) / span) * 100));
  const absDiff = goalVal != null ? Math.abs(+(value - goalVal).toFixed(1)) : null;

  let statusLabel, statusBg, statusTxt, barColor;
  if (absDiff == null) {
    statusLabel = null; barColor = '#67e8f9';
  } else if (absDiff <= 0.5) {
    statusLabel = t('weight.goalHit'); statusBg = 'rgba(52,211,153,0.10)'; statusTxt = '#34d399'; barColor = '#34d399';
  } else if (absDiff <= 2) {
    statusLabel = t('weight.close'); statusBg = 'rgba(251,191,36,0.10)'; statusTxt = '#fbbf24'; barColor = '#fbbf24';
  } else {
    statusLabel = t('weight.kgToGo', { value: absDiff, unit }); statusBg = 'rgba(248,113,113,0.10)'; statusTxt = '#f87171'; barColor = '#f87171';
  }

  return (
    <View style={[styles_weightLogRow, { borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border }]}>
      <View style={{ width: 3, height: 30, borderRadius: 2, backgroundColor: barColor }} />
      <Text style={{ width: 64, fontSize: 11, color: colors.textMuted, fontFamily: fontFamily.mono, fontWeight: '700' }}>{fmtDateShort(log.logged_at)}</Text>
      <Text style={{ fontSize: typography.base, fontWeight: '800', fontFamily: fontFamily.monoBold, color: barColor }}>{value.toFixed(1)}</Text>
      <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.dim, overflow: 'hidden' }}>
        <View style={{ height: '100%', borderRadius: 3, width: `${pct}%`, backgroundColor: barColor }} />
      </View>
      {delta != null && (
        <Text style={{ fontSize: 10, fontWeight: '700', fontFamily: fontFamily.mono, minWidth: 32, textAlign: 'right', color: delta > 0 ? colors.danger : colors.good }}>
          {delta > 0 ? '+' : ''}{toDisp(delta, unit).toFixed(1)}
        </Text>
      )}
      {statusLabel && (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: statusBg }}>
          <Text style={{ fontSize: 9, fontWeight: '700', fontFamily: fontFamily.mono, letterSpacing: 0.2, color: statusTxt }}>{statusLabel}</Text>
        </View>
      )}
      <TouchableOpacity onPress={onDelete} style={{ padding: 3 }}>
        <Ionicons name="close" size={14} color={colors.textDim} />
      </TouchableOpacity>
    </View>
  );
}
const styles_weightLogRow = { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10 };

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function WeightScreen({ embedded = false } = {}) {
  const { t } = useTranslation();
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
      t('weight.reminderTitle'), t('weight.reminderBody'));
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
      Alert.alert(t('weight.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['weight', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const goalMut = useMutation({
    mutationFn: (goal) => updateWeightGoal(user.id, fromDisp(parseFloat(goal), unit)),
    onMutate: async (goal) => {
      await qc.cancelQueries(['weight', user.id]);
      const previous = qc.getQueryData(['weight', user.id]);
      const goalKgVal = fromDisp(parseFloat(goal), unit);
      qc.setQueryData(['weight', user.id], (old) => {
        if (!old) return old;
        return { ...old, profile: { ...old.profile, weight_goal_kg: goalKgVal } };
      });
      setGoalInput('');
      setShowGoalSheet(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['weight', user.id], context.previous);
      Alert.alert(t('weight.errorTitle'), e.message);
    },
    onSettled: () => { qc.invalidateQueries(['weight', user.id]); },
  });

  const deleteMut = useMutation({
    mutationFn: deleteWeightLog,
    onMutate: async (id) => {
      await qc.cancelQueries(['weight', user.id]);
      const previous = qc.getQueryData(['weight', user.id]);
      qc.setQueryData(['weight', user.id], (old) => {
        if (!old) return old;
        return { ...old, logs: old.logs.filter(l => l.id !== id) };
      });
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['weight', user.id], context.previous);
      Alert.alert(t('weight.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['weight', user.id]);
      qc.invalidateQueries(['home', user.id]);
    },
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
    if (Math.abs(toGo) < 0.05) etaText = t('weight.goalReached');
    else if (ratePerDay > 0 && toGo > 0) {
      const etaDays = Math.round(toGo / ratePerDay);
      const etaDate = new Date(); etaDate.setDate(etaDate.getDate() + etaDays);
      etaText = t('weight.etaEstimate', { month: MONTH_NAMES[etaDate.getMonth()], day: etaDate.getDate() });
    }
    const rateWk = Math.abs(ratePerDay * 7);
    const rateText = ratePerDay > 0
      ? t('weight.ratePerWeekLosing', { value: toDisp(rateWk, unit).toFixed(1), unit })
      : t('weight.ratePerWeekGaining', { value: toDisp(rateWk, unit).toFixed(1), unit });
    return { pct, curKg, startKg, toGo, etaText, rateText };
  }, [goalKg, sortedAsc, sortedDesc, unit, t]);

  // Body weight always sits close to its own all-time max, so scaling the
  // history bar from 0..max clamps almost every dot to the same spot. Scale
  // from the actual min/max range (plus padding) instead, so day-to-day
  // differences are visible.
  const historyBarRange = useMemo(() => {
    if (!logs.length) return { min: 0, max: 1 };
    const vals = logs.map(w => w.weight);
    if (goalKg) vals.push(goalKg);
    const min = Math.min(...vals), max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.15, 0.5);
    return { min: min - pad, max: max + pad };
  }, [logs, goalKg]);

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

  const trendPrediction = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = localDateStr(cutoff);
    const last30Asc = sortedAsc.filter(l => l.logged_at >= cutoffStr);
    const trend = linearTrend(last30Asc);
    if (!trend || !goalKg) return null;
    const { kgPerWeek, latest } = trend;
    const toGo = latest - goalKg;
    const rateDisp = toDisp(Math.abs(kgPerWeek), unit);
    const dirLabel = kgPerWeek < 0 ? `-${rateDisp.toFixed(2)} ${unit}/week` : `+${rateDisp.toFixed(2)} ${unit}/week`;
    let etaWeeks = null;
    let awayFromGoal = false;
    if (Math.abs(toGo) < 0.1) {
      etaWeeks = 0;
    } else if (kgPerWeek !== 0 && Math.sign(kgPerWeek) === -Math.sign(toGo)) {
      etaWeeks = Math.round(Math.abs(toGo / kgPerWeek));
    } else {
      awayFromGoal = true;
    }
    return { dirLabel, etaWeeks, awayFromGoal };
  }, [sortedAsc, goalKg, unit]);

  const logDateSet = useMemo(() => new Set(logs.map(l => l.logged_at)), [logs]);

  const weightConsistency = useMemo(() => {
    const todayD = new Date();
    const todayStr = localDateStr(todayD);

    let currentStreak = 0;
    for (let i = 0; i < 365; i++) {
      const d = localDateStr(new Date(todayD.getTime() - i * 86400000));
      if (logDateSet.has(d)) currentStreak++;
      else if (d !== todayStr) break;
    }

    let longestStreak = 0, run = 0;
    for (let i = 364; i >= 0; i--) {
      const d = localDateStr(new Date(todayD.getTime() - i * 86400000));
      if (logDateSet.has(d)) { run++; longestStreak = Math.max(longestStreak, run); }
      else run = 0;
    }

    const countInWindow = (startDaysAgo, endDaysAgo) => {
      let c = 0;
      for (let i = endDaysAgo; i < startDaysAgo; i++) {
        const d = localDateStr(new Date(todayD.getTime() - i * 86400000));
        if (logDateSet.has(d)) c++;
      }
      return c;
    };
    const last8WkLogged = countInWindow(56, 0);
    const prev8WkLogged = countInWindow(112, 56);
    const consistencyPct = Math.round((last8WkLogged / 56) * 100);
    const prevConsistencyPct = Math.round((prev8WkLogged / 56) * 100);

    // Weekday pattern: avg deviation from overall mean weight, per day-of-week
    const overallVals = sortedAsc.map(l => l.weight);
    const overallAvg = overallVals.length ? overallVals.reduce((a, b) => a + b, 0) / overallVals.length : null;
    let bestDow = null, bestDowDelta = 0;
    if (overallAvg != null) {
      const dowSums = Array(7).fill(0), dowCounts = Array(7).fill(0);
      for (const l of sortedAsc) {
        const dow = new Date(l.logged_at + 'T00:00:00').getDay();
        dowSums[dow] += l.weight - overallAvg;
        dowCounts[dow]++;
      }
      let maxAbs = 0;
      for (let i = 0; i < 7; i++) {
        if (dowCounts[i] < 2) continue;
        const avgDelta = dowSums[i] / dowCounts[i];
        if (Math.abs(avgDelta) > maxAbs) { maxAbs = Math.abs(avgDelta); bestDow = i; bestDowDelta = avgDelta; }
      }
    }

    // Plateau detection over trailing 14 days
    const last14 = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 13 * 86400000)));
    const last14Vals = last14.map(l => l.weight);
    const last14Range = last14Vals.length >= 3 ? Math.max(...last14Vals) - Math.min(...last14Vals) : null;

    // Day-to-day volatility: avg absolute delta between consecutive entries
    let volatility = null;
    if (sortedAsc.length >= 3) {
      let sum = 0;
      for (let i = 1; i < sortedAsc.length; i++) sum += Math.abs(sortedAsc[i].weight - sortedAsc[i - 1].weight);
      volatility = sum / (sortedAsc.length - 1);
    }

    // Weekend vs weekday average, relative to overall mean
    let weekendDelta = null;
    if (overallAvg != null) {
      const weekendVals = sortedAsc.filter(l => [0, 6].includes(new Date(l.logged_at + 'T00:00:00').getDay())).map(l => l.weight);
      const weekdayVals = sortedAsc.filter(l => ![0, 6].includes(new Date(l.logged_at + 'T00:00:00').getDay())).map(l => l.weight);
      if (weekendVals.length >= 2 && weekdayVals.length >= 2) {
        const weekendAvg = weekendVals.reduce((a, b) => a + b, 0) / weekendVals.length;
        const weekdayAvg = weekdayVals.reduce((a, b) => a + b, 0) / weekdayVals.length;
        weekendDelta = weekendAvg - weekdayAvg;
      }
    }

    // Momentum: rate of change over the last 14 days vs the prior 14 days
    const last14Entries = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 13 * 86400000)));
    const prev14Entries = sortedAsc.filter(l =>
      l.logged_at >= localDateStr(new Date(todayD.getTime() - 27 * 86400000)) &&
      l.logged_at < localDateStr(new Date(todayD.getTime() - 13 * 86400000))
    );
    let momentumDelta = null;
    if (last14Entries.length >= 2 && prev14Entries.length >= 2) {
      const rateOf = (entries) => entries[entries.length - 1].weight - entries[0].weight;
      momentumDelta = rateOf(last14Entries) - rateOf(prev14Entries);
    }

    // Biggest single-log-to-log jump in the last 30 days
    const last30 = sortedAsc.filter(l => l.logged_at >= localDateStr(new Date(todayD.getTime() - 29 * 86400000)));
    let biggestJump = null;
    if (last30.length >= 2) {
      for (let i = 1; i < last30.length; i++) {
        const delta = last30[i].weight - last30[i - 1].weight;
        if (biggestJump == null || Math.abs(delta) > Math.abs(biggestJump.delta)) {
          biggestJump = { delta, date: last30[i].logged_at };
        }
      }
    }

    // Days since last log
    const lastLogDate = sortedDesc[0]?.logged_at ?? null;
    const daysSinceLastLog = lastLogDate
      ? Math.floor((todayD.getTime() - new Date(lastLogDate + 'T00:00:00').getTime()) / 86400000)
      : null;

    return {
      currentStreak, longestStreak, consistencyPct, prevConsistencyPct,
      bestDow, bestDowDelta, last14Range, volatility,
      weekendDelta, momentumDelta, biggestJump, daysSinceLastLog,
    };
  }, [logDateSet, sortedAsc, sortedDesc]);

  const weightInsights = useMemo(() => {
    const out = [];
    const c = weightConsistency;
    if (c.consistencyPct > c.prevConsistencyPct) {
      out.push({ icon: '📈', text: t('weight.insightConsistencyUpText'), bold: `${c.consistencyPct - c.prevConsistencyPct}%`, rest: t('weight.insightConsistencyUpRest') });
    } else if (c.consistencyPct < c.prevConsistencyPct) {
      out.push({ icon: '📉', text: t('weight.insightConsistencyDownText'), bold: `${c.prevConsistencyPct - c.consistencyPct}%`, rest: t('weight.insightConsistencyDownRest') });
    }
    if (c.currentStreak >= c.longestStreak && c.currentStreak > 0) {
      out.push({ icon: '🔥', text: t('weight.insightBestStreakText'), bold: t('weight.insightBestStreakBold'), rest: t('weight.insightBestStreakRest', { count: c.currentStreak }) });
    } else if (c.longestStreak > c.currentStreak && c.currentStreak > 0) {
      out.push({ icon: '🎯', text: t('weight.insightTiesRecordText', { count: c.longestStreak - c.currentStreak }), bold: t('weight.insightTiesRecordBold'), rest: t('weight.insightTiesRecordRest', { count: c.longestStreak }) });
    }
    if (c.last14Range != null) {
      if (c.last14Range < 0.6) {
        out.push({ icon: '⏸️', text: t('weight.insightPlateauingText'), bold: t('weight.insightPlateauingBold'), rest: t('weight.insightPlateauingRest', { value: toDisp(c.last14Range, unit).toFixed(1), unit }) });
      }
    }
    if (c.bestDow != null && Math.abs(c.bestDowDelta) > 0.15) {
      out.push({
        icon: '📅',
        text: t('weight.insightBestDowText', { day: DOW_FULL[c.bestDow] }),
        bold: `${c.bestDowDelta >= 0 ? '+' : ''}${toDisp(c.bestDowDelta, unit).toFixed(1)}${unit}`,
        rest: t('weight.insightBestDowRest'),
      });
    }
    if (c.volatility != null) {
      if (c.volatility >= 0.8) {
        out.push({ icon: '〜', text: t('weight.insightVolatilityText'), bold: `±${toDisp(c.volatility, unit).toFixed(1)}${unit}`, rest: t('weight.insightVolatilityRest') });
      }
    }
    if (c.weekendDelta != null && Math.abs(c.weekendDelta) > 0.2) {
      out.push({
        icon: '🍔',
        text: t('weight.insightWeekendText'),
        bold: `${c.weekendDelta >= 0 ? '+' : ''}${toDisp(c.weekendDelta, unit).toFixed(1)}${unit}`,
        rest: t('weight.insightWeekendRest'),
      });
    }
    if (c.momentumDelta != null && Math.abs(c.momentumDelta) > 0.3) {
      if (c.momentumDelta < 0) {
        out.push({ icon: '🚀', text: t('weight.insightMomentumBuildingText'), bold: '', rest: t('weight.insightMomentumBuildingRest', { value: toDisp(Math.abs(c.momentumDelta), unit).toFixed(1), unit }) });
      } else {
        out.push({ icon: '🐢', text: t('weight.insightProgressSlowedText'), bold: '', rest: t('weight.insightProgressSlowedRest', { value: toDisp(c.momentumDelta, unit).toFixed(1), unit }) });
      }
    }
    if (c.biggestJump && Math.abs(c.biggestJump.delta) >= 1) {
      out.push({
        icon: '⚡',
        text: t('weight.insightBiggestJumpText'),
        bold: `${c.biggestJump.delta >= 0 ? '+' : ''}${toDisp(c.biggestJump.delta, unit).toFixed(1)}${unit}`,
        rest: t('weight.insightBiggestJumpRest', { date: new Date(c.biggestJump.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }),
      });
    }
    if (c.daysSinceLastLog != null && c.daysSinceLastLog >= 3) {
      out.push({ icon: '⚠️', text: t('weight.insightDaysSinceLastLogText'), bold: t('weight.insightDaysSinceLastLogBold', { count: c.daysSinceLastLog }), rest: t('weight.insightDaysSinceLastLogRest') });
    }
    return out;
  }, [weightConsistency, unit, t]);

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

  const openLogSheetForDate = (dateStr) => {
    if (dateStr > localDateStr(new Date())) return;
    const existing = logs.find(l => l.logged_at === dateStr);
    setLogDate(dateStr);
    setWeightInput(existing ? toDisp(existing.weight, unit).toFixed(1) : '');
    setNote(existing?.notes ?? '');
    setShowLogSheet(true);
  };

  const Wrap = embedded ? View : SafeAreaView;
  const wrapProps = embedded ? {} : { edges: ['top'] };

  return (
    <Wrap {...wrapProps} style={styles.safe}>
      {!embedded && <ScreenHeader title={t('weight.screenTitle')} colors={colors} />}

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
        ) : logs.length === 0 ? (
          <EmptyState
            emoji="⚖️"
            title="No weight logged yet"
            subtitle="Start tracking to see your progress here"
            actionLabel="Log Weight"
            onAction={() => setShowLogSheet(true)}
          />
        ) : (
          <>
            {/* ── Hero + Goal Progress + Stats (merged) ── */}
            <View style={styles.heroCard}>
              <View style={styles.heroTopRow}>
                <View>
                  <Text style={styles.heroNum}>{latest ? toDisp(latest.weight, unit).toFixed(1) : '—'}</Text>
                  <Text style={styles.heroLabel}>{t('weight.latestEntryLabel', { unit: unit.toUpperCase() })}</Text>
                  <Text style={[styles.heroSub, vsPrev != null && { color: vsPrev <= 0 ? colors.good : colors.danger }]}>
                    {vsPrev != null ? t('weight.vsPrevWithValue', { arrow: vsPrev <= 0 ? '▼' : '▲', value: Math.abs(toDisp(vsPrev, unit)).toFixed(1) }) : t('weight.vsPrevEmpty')}
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
                  label={t('weight.toGoLabel')}
                  valueStyle={{ color: colors.text }}
                  labelStyle={{ color: colors.textMuted }}
                />
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <View style={styles.statTileRowInline}>
                    <StatCell value={goalProgress ? `${toDisp(goalProgress.curKg, unit).toFixed(1)}${unit}` : '—'} label={t('weight.nowLabel')} colors={colors} />
                    <View style={styles.statDividerInline} />
                    <StatCell value={goalKg ? `${toDisp(goalKg, unit).toFixed(1)}${unit}` : '—'} label={t('weight.targetLabel')} colors={colors} />
                    <View style={styles.statDividerInline} />
                    <StatCell value={goalProgress ? `${Math.abs(toDisp(goalProgress.toGo, unit)).toFixed(1)}${unit}` : '—'} label={t('weight.toGoLabel')} colors={colors} />
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
                <StatCell value={mMax != null ? toDisp(mMax, unit).toFixed(1) : '—'} label={t('weight.peakLabel')} colors={colors} />
                <View style={styles.statDividerInline} />
                <StatCell value={mMin != null ? toDisp(mMin, unit).toFixed(1) : '—'} label={t('weight.lowLabel')} color={colors.good} colors={colors} />
                <View style={styles.statDividerInline} />
                <StatCell value={mAvg != null ? toDisp(mAvg, unit).toFixed(1) : '—'} label={t('weight.avgLabel')} colors={colors} />
              </View>

              <View style={styles.sectionDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerLabel}>{t('weight.allTimeLabel')}</Text>
                <View style={styles.dividerLine} />
              </View>
              <View style={styles.statTileRowInline}>
                <StatCell value={allTimeStats ? toDisp(allTimeStats.first.weight, unit).toFixed(1) : '—'} label={t('weight.startLabel')} colors={colors} />
                <View style={styles.statDividerInline} />
                <StatCell
                  value={allTimeStats ? `${allTimeStats.lost >= 0 ? '−' : '+'}${Math.abs(toDisp(allTimeStats.lost, unit)).toFixed(1)}` : '—'}
                  label={t('weight.changeLabel')} color={allTimeStats && allTimeStats.lost >= 0 ? colors.good : colors.danger} colors={colors}
                />
                <View style={styles.statDividerInline} />
                <StatCell
                  value={allTimeStats ? `${toDisp(allTimeStats.rateKgWk, unit).toFixed(2)}` : '—'}
                  label={t('weight.unitPerWeekLabel', { unit: unit.toUpperCase() })} color={allTimeStats && allTimeStats.rateKgWk <= 0 ? colors.good : colors.danger} colors={colors}
                />
              </View>
            </View>

            {/* ── Analysis & Insights — Pro ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('weight.analysisInsightsTitle')}</Text>
                <View style={styles.proBadge}><Text style={styles.proBadgeText}>{t('weight.proLabel')}</Text></View>
              </View>

              {/* Stat tiles — always visible, values hidden when locked */}
              <View style={styles.tileRow}>
                <View style={styles.tile}>
                  <Text style={styles.tileVal}>{hasAccess ? weightConsistency.longestStreak : '●●'}</Text>
                  <Text style={styles.tileLbl}>{t('weight.bestStreakLabel')}</Text>
                </View>
                <View style={styles.tileColDivider} />
                <View style={styles.tile}>
                  <Text style={styles.tileVal}>{hasAccess ? `${weightConsistency.consistencyPct}%` : '●●%'}</Text>
                  <Text style={styles.tileLbl}>{t('weight.eightWkConsistencyLabel')}</Text>
                </View>
                <View style={styles.tileColDivider} />
                <View style={styles.tile}>
                  <Text style={styles.tileVal}>{hasAccess ? (weightConsistency.volatility != null ? `±${toDisp(weightConsistency.volatility, unit).toFixed(1)}` : '—') : '±●.●'}</Text>
                  <Text style={styles.tileLbl}>{t('weight.volatilityWithUnitLabel', { unit: unit.toUpperCase() })}</Text>
                </View>
              </View>

              {hasAccess ? (
                weightInsights.length > 0 && (
                  <View style={styles.insightsList}>
                    {weightInsights.map((ins, i) => (
                      <View key={i} style={styles.insightRow}>
                        <Text style={styles.insightIcon}>{ins.icon}</Text>
                        <Text style={styles.insightText}>
                          {ins.text}<Text style={styles.insightBold}>{ins.bold}</Text>{ins.rest}
                        </Text>
                      </View>
                    ))}
                  </View>
                )
              ) : (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPaywall(true)}>
                  <View style={styles.insightsList}>
                    {weightInsights.slice(0, 1).map((ins, i) => (
                      <View key={`real-${i}`} style={styles.insightRow}>
                        <Text style={styles.insightIcon}>{ins.icon}</Text>
                        <Text style={styles.insightText}>
                          {ins.text}<Text style={styles.insightBold}>{ins.bold}</Text>{ins.rest}
                        </Text>
                      </View>
                    ))}
                    {(weightInsights.length > 1
                      ? weightInsights.slice(1)
                      : [['📈', 0.92], ['📅', 0.68], ['⚡', 0.8]].slice(weightInsights.length)
                    ).map((ins, i) => (
                      <View key={`locked-${i}`} style={styles.insightRow}>
                        <Text style={styles.insightIcon}>{Array.isArray(ins) ? ins[0] : ins.icon}</Text>
                        <View style={[styles.skeletonBar, { width: `${Array.isArray(ins) ? ins[1] * 100 : 80}%` }]} />
                      </View>
                    ))}
                  </View>
                  <Text style={styles.lockedHint}>
                    {t('weight.lockedInsightsHint')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* ── Monthly Heatmap ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('weight.monthlyHeatmapTitle')}</Text>
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
                <Text style={styles.hmLegendLabel}>{t('weight.lowLegendLabel')}</Text>
                {['rgba(52,211,153,0.25)', 'rgba(52,211,153,0.5)', 'rgba(251,191,36,0.55)', 'rgba(248,113,113,0.7)'].map((c, i) => (
                  <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                ))}
                <Text style={styles.hmLegendLabel}>{t('weight.highLegendLabel')}</Text>
              </View>
              <WeightHeatmap year={year} month={month} logsByDate={logsByDate} colors={colors} unit={unit} hasAccess={hasAccess} onLockedPress={() => setShowPaywall(true)} onDayPress={openLogSheetForDate} />
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate
                ref={heatmapExport.ref}
                title={t('weight.monthlyHeatmapExportTitle')}
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
                <Text style={styles.cardTitle}>{t('weight.weightTrendTitle')}</Text>
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
                      <Text style={[styles.segmentText, trendRangeDays === d && styles.segmentTextActive]}>{d === 0 ? t('weight.allRangeLabel') : t('weight.daysRangeLabel', { days: d })}{d !== 30 && !hasAccess ? ' 🔒' : ''}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.legendRow}>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#67e8f9' }]} /><Text style={styles.legendLabel}>{t('weight.dailyLegendLabel')}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#f59e0b' }]} /><Text style={styles.legendLabel}>{t('weight.legend7dAvg')}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#c4b5fd' }]} /><Text style={styles.legendLabel}>{trendRangeDays === 0 ? t('weight.legendRangeAvgAll') : t('weight.legendRangeAvgDays', { value: trendRangeDays })}</Text></View>
                <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: '#34d399' }]} /><Text style={styles.legendLabel}>{t('weight.legendGoal')}</Text></View>
              </View>
              <WeightTrendChart data={trendData} unit={unit} goalKg={goalKg} colors={colors} width={chartWidth} />
              {trendStats && (
                <View style={styles.trendStatsRow}>
                  <WeekStatCell value={trendStats.avg.toFixed(1)} label={t('weight.avgStatLabel')} color={colors.accent} colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={`${trendStats.loggedDays}/${trendStats.totalDays}`} label={t('weight.loggedDaysStatLabel')} color={colors.good} colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={trendStats.best.toFixed(1)} label={t('weight.bestStatLabel')} color="#22d3ee" colors={colors} />
                  <View style={styles.statDividerInline} />
                  <WeekStatCell value={`${trendStats.change >= 0 ? '+' : ''}${trendStats.change.toFixed(1)}`} label={t('weight.changeStatLabel')} color={trendStats.change <= 0 ? colors.good : colors.danger} colors={colors} />
                </View>
              )}
            </View>

            {/* ── Trend Prediction ── */}
            {trendPrediction && (
              <View style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 18 }}>{trendPrediction.awayFromGoal ? '📉' : '🎯'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, fontFamily: fontFamily.mono, marginBottom: 2 }}>30-DAY TREND PREDICTION</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: trendPrediction.awayFromGoal ? colors.danger : colors.accent }}>
                    {trendPrediction.dirLabel}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    {trendPrediction.awayFromGoal
                      ? 'Trending away from goal'
                      : trendPrediction.etaWeeks === 0
                        ? 'You\'ve reached your goal!'
                        : `At this rate you'll reach your goal in ~${trendPrediction.etaWeeks} week${trendPrediction.etaWeeks !== 1 ? 's' : ''}`
                    }
                  </Text>
                </View>
              </View>
            )}

            {/* ── Avg Weight (weekly/monthly) ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{t('weight.avgWeightTitle')}</Text>
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
                      <Text style={[styles.segmentText, wkViewMode === v && styles.segmentTextActive]}>{v === 'week' ? t('weight.byWeekLabel') : t('weight.byMonthLabel')}</Text>
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
                  {avgExpanded ? t('weight.collapseLabel') : t('weight.expandLabel')}
                </Text>
                <Ionicons name={avgExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.accent} />
              </TouchableOpacity>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate
                ref={avgWeightExport.ref}
                title={t('weight.avgWeightExportTitle')}
                subtitle={wkViewMode === 'month' ? t('weight.avgWeightExportSubtitleMonthly') : t('weight.avgWeightExportSubtitleWeekly')}
                colors={colors}
                width={340}
              >
                <AvgWeightSection key={`export-${wkViewMode}`} logs={logs} viewMode={wkViewMode} unit={unit} colors={colors} width={300} expanded={true} hasAccess={true} />
              </ExportCardTemplate>
            </View>

            {/* ── History ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('weight.historyTitle')}</Text>
              {mWeights.length === 0 && (
                <EmptyState emoji="⚖️" title={t('weight.noEntriesThisMonth')} subtitle="Tap + to log your weight for today" />
              )}
              {groupByWeek(
                mWeights.map((log, idx) => {
                  const nextLog = mWeights[idx + 1];
                  return { log, delta: nextLog ? +(log.weight - nextLog.weight).toFixed(2) : null };
                }),
                e => e.log.logged_at
              ).map(week => (
                <View key={week.key} style={styles.weekGroupBox}>
                  {week.items.map(({ log, delta }, i) => (
                    <View key={log.id}>
                      <WeightLogRow
                        log={log}
                        delta={delta}
                        goalVal={goalKg ? toDisp(goalKg, unit) : null}
                        unit={unit}
                        barMin={toDisp(historyBarRange.min, unit)}
                        barMax={toDisp(historyBarRange.max, unit)}
                        colors={colors}
                        t={t}
                        isLast={i === week.items.length - 1 && !log.notes}
                        onDelete={() => Alert.alert(t('weight.deleteAlertTitle'), t('weight.deleteAlertMessage', { date: fmtDateShort(log.logged_at) }), [
                          { text: t('weight.cancel'), style: 'cancel' },
                          { text: t('weight.delete'), style: 'destructive', onPress: () => deleteMut.mutate(log.id) },
                        ])}
                      />
                      {log.notes ? (
                        <Text style={[styles.logNote, { paddingLeft: 80, borderBottomWidth: i === week.items.length - 1 ? 0 : 1, borderBottomColor: colors.border, paddingBottom: 8 }]}>{log.notes}</Text>
                      ) : null}
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
          <Text style={styles.sheetTitle}>{t('weight.logWeightSheetTitle')}</Text>
          <TouchableOpacity onPress={() => setShowLogSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sheetFieldLabel}>{t('weight.dateLabel')}</Text>
        <DatePickerField
          value={logDate}
          onChange={setLogDate}
          colors={colors}
          maxDate={localDateStr(new Date())}
        />

        <View style={{ height: 16 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={styles.sheetFieldLabel}>{t('weight.weightUnitFieldLabel', { unit: unit.toUpperCase() })}</Text>
          {latest && <Text style={styles.lastHint}>{t('weight.lastHint', { value: toDisp(latest.weight, unit).toFixed(1), unit })}</Text>}
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
        <Text style={styles.sheetFieldLabel}>{t('weight.noteOptionalLabel')}</Text>
        <TextInput
          style={styles.sheetNoteInput}
          value={note}
          onChangeText={setNote}
          placeholder={t('weight.notePlaceholder')}
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
          {logMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('weight.saveWeightButton')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      {/* Weight Goal bottom sheet */}
      <BottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('weight.setWeightGoalSheetTitle')}</Text>
          <TouchableOpacity onPress={() => setShowGoalSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{(parseFloat(goalInput) || (goalKg ? toDisp(goalKg, unit) : '—'))}{unit}</Text>
        <Text style={styles.goalBigSub}>{t('weight.targetWeightLabel')}</Text>

        <TextInput
          style={styles.sheetInput}
          value={goalInput}
          onChangeText={setGoalInput}
          placeholder={goalKg ? toDisp(goalKg, unit).toFixed(1) : t('weight.goalPlaceholder', { unit })}
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        {latest && (
          <>
            <Text style={styles.sheetFieldLabel}>{t('weight.quickPresetsLabel')}</Text>
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
          {goalMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('weight.saveGoalButton')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </Wrap>
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

  tileRow: { flexDirection: 'row' },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tileColDivider: { width: 1, backgroundColor: colors.border },
  tileVal: { fontSize: 18, fontWeight: weight.black, color: colors.text },
  tileLbl: { fontSize: 10, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2, textAlign: 'center' },
  proBadge: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  proBadgeText: { fontSize: 9, fontWeight: weight.black, color: colors.bg, letterSpacing: 0.5 },
  lockedHint: { fontSize: 12, color: colors.textMuted, marginTop: 12, lineHeight: 17 },
  insightsList: { marginTop: 14, gap: 10 },
  insightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  insightIcon: { fontSize: 14, marginTop: 1 },
  insightText: { flex: 1, fontSize: 12.5, color: colors.textMuted, lineHeight: 18 },
  skeletonBar: { flex: 0, height: 12, marginTop: 3, borderRadius: 4, backgroundColor: colors.dim, borderWidth: 1, borderColor: colors.border },
  insightBold: { fontWeight: weight.bold, color: colors.text },

  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 3, borderRadius: 2 },
  legendLabel: { fontSize: 11, color: colors.textMuted },

  emptyText: { textAlign: 'center', color: colors.textDim, paddingVertical: 20, fontSize: typography.sm },

  logNote: { fontSize: typography.xs, color: colors.textMuted, paddingTop: 4 },
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
