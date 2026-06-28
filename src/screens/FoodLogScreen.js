import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, FlatList, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Keyboard, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';
import { typography, weight, fontFamily } from '../theme/typography';
import BottomSheet from '../components/ui/BottomSheet';
import ExportCardTemplate from '../components/ui/ExportCardTemplate';
import PaywallModal from '../components/ui/PaywallModal';
import { useGatedExport } from '../hooks/useGatedExport';
import { useSubscription } from '../context/SubscriptionContext';
import ScreenHeader from '../components/ScreenHeader';
import SkeletonScreen from '../components/Skeleton';
import MonthYearPicker from '../components/ui/MonthYearPicker';
import { useExportCard } from '../hooks/useExportCard';

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const MEAL_ICONS = { Breakfast: 'sunny', Lunch: 'restaurant', Dinner: 'moon', Snack: 'cafe' };
const MEAL_TYPE_I18N_KEYS = { Breakfast: 'foodLog.mealBreakfast', Lunch: 'foodLog.mealLunch', Dinner: 'foodLog.mealDinner', Snack: 'foodLog.mealSnack' };

const MACRO_TARGETS = { calories: 2000, protein: 150, carbs: 250, fats: 65 };

const SOURCE_LABELS = { USDA: 'USDA', CoFID: 'UK CoFID', OFF: 'Open Food Facts', CUSTOM: 'Custom' };
const SOURCE_LABEL_I18N_KEYS = { USDA: 'foodLog.sourceUsda', CoFID: 'foodLog.sourceCofid', OFF: 'foodLog.sourceOff', CUSTOM: 'foodLog.sourceCustom' };

const EMPTY_FORM = { food_name: '', calories: '', protein: '', carbs: '', fats: '' };

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchFoodMonth(userId, year, month) {
  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('food_logs')
    .select('calories, logged_at')
    .eq('user_id', userId)
    .gte('logged_at', `${from}T00:00:00`)
    .lte('logged_at', `${to}T23:59:59`);
  if (error) throw error;
  const byDate = {};
  (data ?? []).forEach(l => {
    const ds = l.logged_at.slice(0, 10);
    byDate[ds] = (byDate[ds] ?? 0) + (l.calories ?? 0);
  });
  return byDate;
}

// ─── Calorie Heatmap — mirrors WeightScreen's quartile-relative heatmap ──────
function CalorieHeatmap({ year, month, caloriesByDate, colors, hasAccess = true, onLockedPress, cardWidth, target, t }) {
  const SCREEN_W = cardWidth ?? require('react-native').Dimensions.get('window').width;
  const cellSize = Math.floor((SCREEN_W - (cardWidth ? 12 : 92)) / 7);
  const firstDay = new Date(year, month, 1).getDay();
  let startDow = firstDay - 1; if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = localDateStr(new Date());
  const cutoffStr = localDateStr(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000));

  // Color cells by how far a day's calories sit from the user's calorie
  // target (not month-relative min/max) — so a single logged day reads
  // the same regardless of how few other days are logged that month.
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push({ key: `e${i}`, empty: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const c = caloriesByDate[ds];
    let lvl = 0;
    if (c && target > 0) {
      const ratio = c / target;
      if (ratio < 0.5) lvl = 1; else if (ratio < 0.85) lvl = 2; else if (ratio < 1.15) lvl = 3; else lvl = 4;
    }
    const locked = !hasAccess && ds < cutoffStr;
    cells.push({ key: ds, day: d, c, lvl, isToday: ds === todayStr, locked });
  }

  const LVL_COLOR = {
    0: colors.dim ?? colors.surface,
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
                  { margin: 2, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dim ?? colors.surface },
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
                {cell.c ? Math.round(cell.c) : '—'}
              </Text>
              {!!cell.c && (
                <Text style={{ fontSize: 6, fontWeight: '600', fontFamily: fontFamily.mono, color: cell.lvl === 0 ? colors.textDim : colors.text, opacity: 0.7 }}>
                  {t ? t('foodLog.calAbbrev') : 'cal'}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

async function fetchFoodLog(userId, date) {
  const [logs, profile] = await Promise.all([
    supabase.from('food_logs')
      .select('id, food_name, calories, protein, carbs, fats, serving_size, meal_type, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', `${date}T00:00:00`)
      .lte('logged_at', `${date}T23:59:59`)
      .order('logged_at', { ascending: true }),
    supabase.from('profiles').select('calorie_target, protein_target, carbs_target, fats_target').eq('id', userId).single(),
  ]);
  return { logs: logs.data ?? [], profile: profile.data };
}

async function searchFoods(query) {
  const { data, error } = await supabase.rpc('search_foods', { q: query, max_results: 25 });
  if (error) throw error;
  return data ?? [];
}

function loggedAtFor(dateStr) {
  const now = new Date();
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return d.toISOString();
}

async function addFood(userId, food, dateStr) {
  const { error } = await supabase.from('food_logs').insert({ user_id: userId, ...food, logged_at: loggedAtFor(dateStr) });
  if (error) throw error;
}

async function deleteFoodLog(id) {
  const { error } = await supabase.from('food_logs').delete().eq('id', id);
  if (error) throw error;
}

async function updateMacroTargets(userId, { protein, carbs, fats, calories }) {
  const { error } = await supabase.from('profiles').update({
    protein_target: protein, carbs_target: carbs, fats_target: fats, calorie_target: calories,
  }).eq('id', userId);
  if (error) throw error;
}

function dateStr(d) {
  return d.toISOString().split('T')[0];
}

function fmtDate(d, t) {
  const today = new Date();
  if (dateStr(d) === dateStr(today)) return t('foodLog.today');
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dateStr(d) === dateStr(yesterday)) return t('foodLog.yesterday');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function MacroBar({ label, value, target, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <View style={styles.macroBarWrap}>
      <View style={styles.macroBarHeader}>
        <Text style={styles.macroBarLabel}>{label}</Text>
        <Text style={[styles.macroBarVal, { color }]}>{value}<Text style={styles.macroBarUnit}> / {target}</Text></Text>
      </View>
      <View style={styles.macroBarBg}>
        <View style={[styles.macroBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.macroBarPct}>{pct}%</Text>
    </View>
  );
}

export default function FoodLogScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const MEAL_COLORS = useMemo(() => ({
    Breakfast: '#fb923c', Lunch: '#22d3ee', Dinner: colors.purple, Snack: colors.success,
  }), [colors]);
  const qc = useQueryClient();
  const { isPro, hasAccess } = useSubscription();
  const [showTargetsPaywall, setShowTargetsPaywall] = useState(false);
  const [showHeatmapPaywall, setShowHeatmapPaywall] = useState(false);
  const [showHeatmapModal, setShowHeatmapModal] = useState(false);
  const summaryExport = useGatedExport();
  const heatmapExport = useExportCard();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showSheet, setShowSheet] = useState(false);
  const [sheetStep, setSheetStep] = useState('search'); // 'search' | 'detail' | 'manual'
  const [selectedMeal, setSelectedMeal] = useState('Breakfast');
  const [form, setForm] = useState(EMPTY_FORM);

  // Search step state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 150);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Detail step state
  const [selectedFood, setSelectedFood] = useState(null);
  const [amountGrams, setAmountGrams] = useState('100');

  // Macro targets sheet state
  const [showTargetsSheet, setShowTargetsSheet] = useState(false);
  const [proteinInput, setProteinInput] = useState('');
  const [carbsInput, setCarbsInput] = useState('');
  const [fatsInput, setFatsInput] = useState('');

  const today = dateStr(currentDate);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['food', user?.id, today],
    queryFn: () => fetchFoodLog(user.id, today),
    enabled: !!user?.id,
  });

  const { data: monthData } = useQuery({
    queryKey: ['foodMonth', user?.id, year, month],
    queryFn: () => fetchFoodMonth(user.id, year, month),
    enabled: !!user?.id,
  });
  const caloriesByDate = monthData ?? {};

  const [manualRefreshing, setManualRefreshing] = useState(false);
  const onRefresh = async () => {
    setManualRefreshing(true);
    await refetch();
    setManualRefreshing(false);
  };

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['foodSearch', debouncedQuery],
    queryFn: () => searchFoods(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60 * 1000,
  });

  const addMut = useMutation({
    mutationFn: (food) => addFood(user.id, food, today),
    onMutate: async (food) => {
      await qc.cancelQueries(['food', user.id, today]);
      const previous = qc.getQueryData(['food', user.id, today]);
      qc.setQueryData(['food', user.id, today], (old) => {
        if (!old) return old;
        const optimisticLog = { id: `optimistic-${Date.now()}`, ...food, serving_size: food.serving_size ?? null, logged_at: loggedAtFor(today) };
        return { ...old, logs: [...old.logs, optimisticLog] };
      });
      closeSheet();
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['food', user.id, today], context.previous);
      Alert.alert(t('foodLog.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['food', user.id, today]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteFoodLog,
    onMutate: async (id) => {
      await qc.cancelQueries(['food', user.id, today]);
      const previous = qc.getQueryData(['food', user.id, today]);
      qc.setQueryData(['food', user.id, today], (old) => {
        if (!old) return old;
        return { ...old, logs: old.logs.filter(l => l.id !== id) };
      });
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['food', user.id, today], context.previous);
      Alert.alert(t('foodLog.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['food', user.id, today]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const targetsMut = useMutation({
    mutationFn: (vals) => updateMacroTargets(user.id, vals),
    onMutate: async (vals) => {
      await qc.cancelQueries(['food', user.id, today]);
      const previous = qc.getQueryData(['food', user.id, today]);
      qc.setQueryData(['food', user.id, today], (old) => {
        if (!old) return old;
        return {
          ...old,
          profile: {
            ...old.profile,
            calorie_target: vals.calories,
            protein_target: vals.protein,
            carbs_target: vals.carbs,
            fats_target: vals.fats,
          },
        };
      });
      setShowTargetsSheet(false);
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['food', user.id, today], context.previous);
      Alert.alert(t('foodLog.errorTitle'), e.message);
    },
    onSettled: () => {
      qc.invalidateQueries(['food', user.id, today]);
      qc.invalidateQueries(['home', user.id]);
    },
  });

  const logs = data?.logs ?? [];
  const profile = data?.profile;
  const targets = {
    calories: profile?.calorie_target ?? MACRO_TARGETS.calories,
    protein: profile?.protein_target ?? MACRO_TARGETS.protein,
    carbs: profile?.carbs_target ?? MACRO_TARGETS.carbs,
    fats: profile?.fats_target ?? MACRO_TARGETS.fats,
  };

  const openTargetsSheet = () => {
    if (!isPro) { setShowTargetsPaywall(true); return; }
    setProteinInput(String(targets.protein));
    setCarbsInput(String(targets.carbs));
    setFatsInput(String(targets.fats));
    setShowTargetsSheet(true);
  };

  const targetProteinG = parseFloat(proteinInput) || 0;
  const targetCarbsG = parseFloat(carbsInput) || 0;
  const targetFatsG = parseFloat(fatsInput) || 0;
  const computedCalories = Math.round(targetProteinG * 4 + targetCarbsG * 4 + targetFatsG * 9);

  const handleSaveTargets = () => {
    if (!proteinInput || !carbsInput || !fatsInput) return Alert.alert(t('foodLog.requiredTitle'), t('foodLog.requiredTargetsMessage'));
    targetsMut.mutate({ protein: targetProteinG, carbs: targetCarbsG, fats: targetFatsG, calories: computedCalories });
  };

  const totals = logs.reduce((acc, l) => ({
    calories: acc.calories + (l.calories ?? 0),
    protein: acc.protein + (l.protein ?? 0),
    carbs: acc.carbs + (l.carbs ?? 0),
    fats: acc.fats + (l.fats ?? 0),
  }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

  const byMeal = {};
  MEAL_TYPES.forEach(m => { byMeal[m] = logs.filter(l => l.meal_type === m); });

  const prevDay = () => setCurrentDate(d => { const next = new Date(d); next.setDate(d.getDate() - 1); return next; });
  const nextDay = () => {
    const tomorrow = new Date(); tomorrow.setDate(new Date().getDate() + 1);
    if (currentDate < tomorrow) setCurrentDate(d => { const next = new Date(d); next.setDate(d.getDate() + 1); return next; });
  };

  const openSheet = (meal) => {
    setSelectedMeal(meal);
    setSheetStep('search');
    setSearchQuery('');
    setDebouncedQuery('');
    setSelectedFood(null);
    setAmountGrams('100');
    setForm(EMPTY_FORM);
    setShowSheet(true);
  };

  const closeSheet = () => {
    Keyboard.dismiss();
    setShowSheet(false);
  };

  const pickFood = (food) => {
    Keyboard.dismiss();
    setSelectedFood(food);
    setAmountGrams(String(food.serving_qty ?? 100));
    setSheetStep('detail');
  };

  const factor = (parseFloat(amountGrams) || 0) / (selectedFood?.serving_qty || 100);
  const scaled = selectedFood ? {
    calories: round1((selectedFood.calories ?? 0) * factor),
    protein: round1((selectedFood.protein ?? 0) * factor),
    carbs: round1((selectedFood.carbs ?? 0) * factor),
    fats: round1((selectedFood.fats ?? 0) * factor),
  } : null;

  const handleLogSelected = () => {
    if (!selectedFood || !amountGrams || parseFloat(amountGrams) <= 0) return;
    addMut.mutate({
      food_name: selectedFood.brand ? `${selectedFood.name} (${selectedFood.brand})` : selectedFood.name,
      calories: scaled.calories,
      protein: scaled.protein,
      carbs: scaled.carbs,
      fats: scaled.fats,
      serving_size: `${amountGrams}${selectedFood.serving_unit || 'g'}`,
      meal_type: selectedMeal,
    });
  };

  const handleAddManual = () => {
    if (!form.food_name.trim() || !form.calories) return Alert.alert(t('foodLog.requiredTitle'), t('foodLog.requiredFoodMessage'));
    addMut.mutate({
      food_name: form.food_name.trim(),
      calories: parseFloat(form.calories) || 0,
      protein: parseFloat(form.protein) || 0,
      carbs: parseFloat(form.carbs) || 0,
      fats: parseFloat(form.fats) || 0,
      meal_type: selectedMeal,
    });
  };

  // Calorie ring percentage
  const calPct = Math.min(100, Math.round((totals.calories / targets.calories) * 100));

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="LOG" colors={colors} />
      {/* Date nav */}
      <View style={styles.dateNav}>
        <TouchableOpacity onPress={prevDay} style={styles.dateArrow}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.dateLabel}>{fmtDate(currentDate, t)}</Text>
        <TouchableOpacity onPress={nextDay} style={styles.dateArrow}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={manualRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
        {isLoading ? <SkeletonScreen cards={5} linesPerCard={2} /> : (
          <>
            {/* Calorie summary */}
            <View>
              <View style={styles.summaryCard}>
                <View style={styles.targetsPillRow}>
                  <TouchableOpacity style={styles.goalPillBtn} onPress={openTargetsSheet}>
                    <Text style={styles.goalPillBtnText}>{t('foodLog.editTargets')}</Text>
                    <Ionicons name={isPro ? 'pencil' : 'lock-closed'} size={11} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={summaryExport.onExportPress}
                    disabled={summaryExport.exporting}
                    style={styles.cardExportBtn}
                  >
                    {summaryExport.exporting ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <Ionicons name="share-outline" size={13} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                </View>
                <View style={styles.calorieRing}>
                  <View style={[styles.ringOuter, { borderColor: calPct >= 100 ? colors.danger : colors.accent }]}>
                    <Text style={[styles.ringNum, { color: calPct >= 100 ? colors.danger : colors.accent }]}>
                      {totals.calories.toFixed(0)}
                    </Text>
                    <Text style={styles.ringLabel}>{t('foodLog.kcal')}</Text>
                  </View>
                  <View style={styles.ringRight}>
                    <Text style={styles.ringTarget}>{t('foodLog.goalKcal', { value: targets.calories })}</Text>
                    <Text style={[styles.ringRemain, { color: calPct >= 100 ? colors.danger : colors.success }]}>
                      {calPct >= 100
                        ? t('foodLog.overAmount', { value: (totals.calories - targets.calories).toFixed(0) })
                        : t('foodLog.remainingAmount', { value: (targets.calories - totals.calories).toFixed(0) })
                      }
                    </Text>
                  </View>
                </View>

                {/* Macro bars */}
                <View style={styles.macroBars}>
                  <MacroBar label={t('foodLog.protein')} value={Math.round(totals.protein)} target={targets.protein} color={colors.success} />
                  <MacroBar label={t('foodLog.carbs')} value={Math.round(totals.carbs)} target={targets.carbs} color="#fb923c" />
                  <MacroBar label={t('foodLog.fats')} value={Math.round(totals.fats)} target={targets.fats} color={colors.warning} />
                </View>
              </View>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={summaryExport.ref} title={t('foodLog.todaysNutrition')} colors={colors} width={340}>
                <View style={styles.calorieRing}>
                  <View style={[styles.ringOuter, { borderColor: calPct >= 100 ? colors.danger : colors.accent }]}>
                    <Text style={[styles.ringNum, { color: calPct >= 100 ? colors.danger : colors.accent }]}>
                      {totals.calories.toFixed(0)}
                    </Text>
                    <Text style={styles.ringLabel}>{t('foodLog.kcal')}</Text>
                  </View>
                  <View style={styles.ringRight}>
                    <Text style={styles.ringTarget}>{t('foodLog.goalKcal', { value: targets.calories })}</Text>
                    <Text style={[styles.ringRemain, { color: calPct >= 100 ? colors.danger : colors.success }]}>
                      {calPct >= 100
                        ? t('foodLog.overAmount', { value: (totals.calories - targets.calories).toFixed(0) })
                        : t('foodLog.remainingAmount', { value: (targets.calories - totals.calories).toFixed(0) })
                      }
                    </Text>
                  </View>
                </View>
                <View style={styles.macroBars}>
                  <MacroBar label={t('foodLog.protein')} value={Math.round(totals.protein)} target={targets.protein} color={colors.success} />
                  <MacroBar label={t('foodLog.carbs')} value={Math.round(totals.carbs)} target={targets.carbs} color="#fb923c" />
                  <MacroBar label={t('foodLog.fats')} value={Math.round(totals.fats)} target={targets.fats} color={colors.warning} />
                </View>
              </ExportCardTemplate>
            </View>

            {/* ── Monthly Calorie Heatmap (opens in popup) ── */}
            <TouchableOpacity style={[styles.card, styles.hmTabRow]} onPress={() => setShowHeatmapModal(true)} activeOpacity={0.8}>
              <View style={styles.hmTabIconWrap}>
                <Ionicons name="calendar" size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{t('foodLog.monthlyCalorieHeatmap')}</Text>
                <Text style={styles.hmTabSub}>{t('foodLog.tapToViewHeatmap')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate
                ref={heatmapExport.ref}
                title={t('foodLog.monthlyCalorieHeatmap')}
                subtitle={`${MONTH_NAMES[month]} ${year}`}
                colors={colors}
                width={340}
              >
                <CalorieHeatmap year={year} month={month} caloriesByDate={caloriesByDate} colors={colors} hasAccess={true} cardWidth={258} target={targets.calories} t={t} />
              </ExportCardTemplate>
            </View>

            {/* Meals by type */}
            {MEAL_TYPES.map(meal => {
              const items = byMeal[meal] ?? [];
              const mealCals = items.reduce((s, l) => s + (l.calories ?? 0), 0);
              const mealColor = MEAL_COLORS[meal];
              return (
                <View key={meal} style={styles.mealCard}>
                  <View style={styles.mealHeader}>
                    <View style={[styles.mealIconWrap, { backgroundColor: mealColor + '22' }]}>
                      <Ionicons name={MEAL_ICONS[meal]} size={18} color={mealColor} />
                    </View>
                    <Text style={styles.mealTitle}>{t(MEAL_TYPE_I18N_KEYS[meal])}</Text>
                    <Text style={[styles.mealCals, { color: mealColor }]}>{t('foodLog.kcalAmount', { value: mealCals.toFixed(0) })}</Text>
                    <TouchableOpacity onPress={() => openSheet(meal)}>
                      <Ionicons name="add-circle-outline" size={22} color={mealColor} />
                    </TouchableOpacity>
                  </View>
                  {items.length === 0 ? (
                    <Text style={styles.mealEmpty}>{t('foodLog.nothingLoggedYet')}</Text>
                  ) : (
                    items.map(item => (
                      <View key={item.id} style={styles.foodItem}>
                        <View style={styles.foodItemLeft}>
                          <Text style={styles.foodName}>{item.food_name}</Text>
                          <View style={styles.macroChips}>
                            {item.serving_size ? <Text style={styles.servingChip}>{item.serving_size}</Text> : null}
                            {item.protein > 0 && <MacroChip label={t('foodLog.macroChipProtein', { value: Math.round(item.protein) })} color={colors.success} />}
                            {item.carbs > 0 && <MacroChip label={t('foodLog.macroChipCarbs', { value: Math.round(item.carbs) })} color="#fb923c" />}
                            {item.fats > 0 && <MacroChip label={t('foodLog.macroChipFats', { value: Math.round(item.fats) })} color={colors.warning} />}
                          </View>
                        </View>
                        <Text style={styles.foodCals}>{t('foodLog.kcalAmount', { value: item.calories })}</Text>
                        <TouchableOpacity onPress={() => Alert.alert(t('foodLog.deleteTitle'), t('foodLog.deleteConfirmMessage', { name: item.food_name }), [
                          { text: t('foodLog.cancel'), style: 'cancel' },
                          { text: t('foodLog.delete'), style: 'destructive', onPress: () => deleteMut.mutate(item.id) },
                        ])}>
                          <Ionicons name="close" size={16} color={colors.textDim} />
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => openSheet('Breakfast')}>
        <Ionicons name="search" size={26} color={colors.bg} />
      </TouchableOpacity>

      {/* Log Food Modal: search -> detail (serving) or manual entry — full-screen pageSheet, mirrors Workout's session modal */}
      <Modal visible={showSheet} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeSheet}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={styles.sheetContainer}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                {sheetStep !== 'search' && (
                  <TouchableOpacity onPress={() => setSheetStep('search')} style={styles.sheetBackBtn}>
                    <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
                <View>
                  <Text style={styles.sheetHeaderTop}>
                    <Text style={styles.sheetHeaderLOG}>{t('foodLog.logPrefix')} </Text>
                    <Text style={styles.sheetHeaderSub}>
                      {sheetStep === 'detail' ? t('foodLog.addServing') : sheetStep === 'manual' ? t('foodLog.customFood') : t('foodLog.food')}
                    </Text>
                  </Text>
                  <Text style={styles.trackLabel}>{t('foodLog.trackWhatYouEat')}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={closeSheet} style={styles.sheetCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Meal type chips (shown on every step) */}
            <View style={[styles.mealChips, { paddingHorizontal: 16 }]}>
              {MEAL_TYPES.map(m => (
                <TouchableOpacity key={m} style={[styles.mealChip, selectedMeal === m && { backgroundColor: MEAL_COLORS[m], borderColor: MEAL_COLORS[m] }]}
                  onPress={() => setSelectedMeal(m)}>
                  <Text style={[styles.mealChipText, selectedMeal === m && { color: '#fff' }]}>{t(MEAL_TYPE_I18N_KEYS[m])}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {sheetStep === 'search' && (
              <View style={[styles.searchStep, { paddingHorizontal: 16 }]}>
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={16} color={colors.textDim} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder={t('foodLog.searchFoodsPlaceholder')}
                    placeholderTextColor={colors.textDim}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoFocus
                  />
                  {searching && <ActivityIndicator size="small" color={colors.accent} />}
                </View>

                <FlatList
                  data={searchResults ?? []}
                  keyExtractor={item => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.resultsList}
                  ListEmptyComponent={
                    debouncedQuery.length < 2 ? (
                      <Text style={styles.searchHint}>{t('foodLog.searchHintMinChars')}</Text>
                    ) : !searching ? (
                      <Text style={styles.searchHint}>{t('foodLog.noMatchesFound')}</Text>
                    ) : null
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.resultRow} onPress={() => pickFood(item)}>
                      <View style={styles.resultLeft}>
                        <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.resultMeta} numberOfLines={1}>
                          {item.brand ? `${item.brand} · ` : ''}{SOURCE_LABEL_I18N_KEYS[item.source] ? t(SOURCE_LABEL_I18N_KEYS[item.source]) : item.source}
                        </Text>
                      </View>
                      <Text style={styles.resultCals}>{t('foodLog.kcalAmount', { value: Math.round(item.calories ?? 0) })}</Text>
                      <Text style={styles.resultUnit}>/{item.serving_qty ?? 100}{item.serving_unit ?? 'g'}</Text>
                    </TouchableOpacity>
                  )}
                />

                <TouchableOpacity style={styles.manualLink} onPress={() => setSheetStep('manual')}>
                  <Ionicons name="create-outline" size={14} color={colors.accent} />
                  <Text style={styles.manualLinkText}>{t('foodLog.cantFindAddCustom')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {sheetStep === 'detail' && selectedFood && (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                <Text style={styles.detailName}>{selectedFood.name}</Text>
                {selectedFood.brand ? <Text style={styles.detailBrand}>{selectedFood.brand}</Text> : null}

                <View style={styles.amountRow}>
                  <Text style={styles.amountLabel}>{t('foodLog.amount')}</Text>
                  <View style={styles.amountInputWrap}>
                    <TextInput
                      style={styles.amountInput}
                      value={amountGrams}
                      onChangeText={setAmountGrams}
                      keyboardType="numeric"
                    />
                    <Text style={styles.amountUnit}>{selectedFood.serving_unit ?? 'g'}</Text>
                  </View>
                </View>

                <View style={styles.scaledMacros}>
                  <ScaledMacro label={t('foodLog.calories')} value={scaled.calories} unit={t('foodLog.kcal')} color={colors.accent} />
                  <ScaledMacro label={t('foodLog.protein')} value={scaled.protein} unit="g" color={colors.success} />
                  <ScaledMacro label={t('foodLog.carbs')} value={scaled.carbs} unit="g" color="#fb923c" />
                  <ScaledMacro label={t('foodLog.fats')} value={scaled.fats} unit="g" color={colors.warning} />
                </View>

                <TouchableOpacity style={styles.saveBtn} onPress={handleLogSelected} disabled={addMut.isPending}>
                  {addMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('foodLog.addToMeal', { meal: t(MEAL_TYPE_I18N_KEYS[selectedMeal]) })}</Text>}
                </TouchableOpacity>
              </ScrollView>
            )}

            {sheetStep === 'manual' && (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                <TextInput style={styles.inputFull} placeholder={t('foodLog.foodNamePlaceholder')}
                  placeholderTextColor={colors.textDim} value={form.food_name}
                  onChangeText={v => setForm(p => ({ ...p, food_name: v }))} />

                <View style={styles.macroInputRow}>
                  <MacroInput label={t('foodLog.calories')} value={form.calories} onChange={v => setForm(p => ({ ...p, calories: v }))} color={colors.accent} />
                  <MacroInput label={t('foodLog.protein')} value={form.protein} onChange={v => setForm(p => ({ ...p, protein: v }))} color={colors.success} />
                  <MacroInput label={t('foodLog.carbs')} value={form.carbs} onChange={v => setForm(p => ({ ...p, carbs: v }))} color="#fb923c" />
                  <MacroInput label={t('foodLog.fats')} value={form.fats} onChange={v => setForm(p => ({ ...p, fats: v }))} color={colors.warning} />
                </View>

                <TouchableOpacity style={styles.saveBtn} onPress={handleAddManual} disabled={addMut.isPending}>
                  {addMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('foodLog.saveFood')}</Text>}
                </TouchableOpacity>
              </ScrollView>
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      <BottomSheet visible={showTargetsSheet} onClose={() => setShowTargetsSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('foodLog.setMacroTargets')}</Text>
          <TouchableOpacity onPress={() => setShowTargetsSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{t('foodLog.kcalAmount', { value: computedCalories })}</Text>
        <Text style={styles.goalBigSub}>{t('foodLog.autoCalculatedCalorieTarget')}</Text>

        <View style={styles.targetsFieldRow}>
          <Text style={styles.sheetFieldLabel}>{t('foodLog.proteinGLabel')}</Text>
          <TextInput style={styles.sheetInput} value={proteinInput} onChangeText={setProteinInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textDim} />
        </View>
        <View style={styles.targetsFieldRow}>
          <Text style={styles.sheetFieldLabel}>{t('foodLog.carbsGLabel')}</Text>
          <TextInput style={styles.sheetInput} value={carbsInput} onChangeText={setCarbsInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textDim} />
        </View>
        <View style={styles.targetsFieldRow}>
          <Text style={styles.sheetFieldLabel}>{t('foodLog.fatsGLabel')}</Text>
          <TextInput style={styles.sheetInput} value={fatsInput} onChangeText={setFatsInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textDim} />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveTargets} disabled={targetsMut.isPending}>
          {targetsMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>{t('foodLog.saveTargets')}</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={summaryExport.showPaywall} onClose={() => summaryExport.setShowPaywall(false)} />
      <PaywallModal visible={showTargetsPaywall} onClose={() => setShowTargetsPaywall(false)} />
      <PaywallModal visible={showHeatmapPaywall} onClose={() => setShowHeatmapPaywall(false)} />

      <MonthYearPicker
        visible={showMonthPicker}
        month={month}
        year={year}
        onSelect={(m, y) => { setMonth(m); setYear(y); }}
        onClose={() => setShowMonthPicker(false)}
      />

      <Modal visible={showHeatmapModal} transparent animationType="fade" onRequestClose={() => setShowHeatmapModal(false)}>
        <View style={styles.hmOverlay}>
          <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFillObject} />
          <View style={styles.hmPopup}>
            <View style={styles.hmPopupHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.hmPopupTitle}>🔥 {t('foodLog.calorieHeatmap')}</Text>
                <Text style={styles.hmPopupSubtitle}>{MONTH_FULL[month]} {year}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowHeatmapModal(false)} style={styles.hmPopupCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
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
                <TouchableOpacity
                  onPress={() => (hasAccess ? heatmapExport.exportCard() : setShowHeatmapPaywall(true))}
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
                <Text style={styles.hmLegendLabel}>{t('foodLog.low')}</Text>
                {['rgba(52,211,153,0.25)', 'rgba(52,211,153,0.5)', 'rgba(251,191,36,0.55)', 'rgba(248,113,113,0.7)'].map((c, i) => (
                  <View key={i} style={[styles.hmLegendSwatch, { backgroundColor: c }]} />
                ))}
                <Text style={styles.hmLegendLabel}>{t('foodLog.high')}</Text>
              </View>
              <CalorieHeatmap year={year} month={month} caloriesByDate={caloriesByDate} colors={colors} hasAccess={hasAccess} onLockedPress={() => setShowHeatmapPaywall(true)} target={targets.calories} t={t} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MacroChip({ label, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text style={[styles.macroChip, { color }]}>{label}</Text>;
}

function ScaledMacro({ label, value, unit, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.scaledMacroWrap}>
      <Text style={[styles.scaledMacroVal, { color }]}>{value}<Text style={styles.scaledMacroUnit}>{unit}</Text></Text>
      <Text style={styles.scaledMacroLabel}>{label}</Text>
    </View>
  );
}

function MacroInput({ label, value, onChange, color }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.macroInputWrap}>
      <Text style={[styles.macroInputLabel, { color }]}>{label}</Text>
      <TextInput
        style={styles.macroInput}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textDim}
      />
    </View>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  dateArrow: { padding: 10 },
  dateLabel: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  content: { paddingHorizontal: 16, paddingBottom: 100, paddingTop: 12 },

  summaryCard: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  targetsPillRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  goalPillBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.accent + '1a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent + '66',
  },
  goalPillBtnText: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent, fontFamily: fontFamily.monoBold },
  goalBigVal: { fontSize: 40, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.accent, textAlign: 'center', marginTop: 8 },
  goalBigSub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', marginBottom: 16 },
  sheetFieldLabel: { fontSize: 10, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 1, marginBottom: 6, fontFamily: fontFamily.mono },
  sheetInput: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, color: colors.text, fontSize: typography.base, borderWidth: 1, borderColor: colors.border },
  targetsFieldRow: { marginBottom: 14 },
  cardExportBtn: { padding: 6, borderRadius: 14, backgroundColor: colors.bgElevated },
  calorieRing: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 14 },
  ringOuter: { width: 90, height: 90, borderRadius: 45, borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgElevated },
  ringNum: { fontSize: typography.xl, fontWeight: weight.black },
  ringLabel: { fontSize: 9, color: colors.textMuted, fontWeight: weight.bold },
  ringRight: { flex: 1 },
  ringTarget: { fontSize: typography.sm, color: colors.textMuted, marginBottom: 4 },
  ringRemain: { fontSize: typography.sm, fontWeight: weight.bold },
  macroBars: { gap: 8 },
  macroBarWrap: { gap: 3 },
  macroBarHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  macroBarLabel: { fontSize: 10, color: colors.textMuted, fontWeight: weight.medium },
  macroBarVal: { fontSize: 10, fontWeight: weight.bold },
  macroBarUnit: { color: colors.textDim, fontWeight: weight.normal },
  macroBarBg: { height: 5, backgroundColor: colors.bgElevated, borderRadius: 3, overflow: 'hidden' },
  macroBarFill: { height: '100%', borderRadius: 3 },
  macroBarPct: { fontSize: 8, color: colors.textDim, textAlign: 'right' },

  fab: {
    position: 'absolute', bottom: 24, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 10,
  },

  mealCard: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  mealHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  mealIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mealTitle: { flex: 1, fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  mealCals: { fontSize: typography.sm, fontWeight: weight.bold, marginRight: 8 },
  mealEmpty: { fontSize: typography.xs, color: colors.textDim, textAlign: 'center', paddingVertical: 8 },
  foodItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.bgElevated, gap: 10 },
  foodItemLeft: { flex: 1 },
  foodName: { fontSize: typography.sm, color: colors.text, fontWeight: weight.medium, marginBottom: 3 },
  macroChips: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  macroChip: { fontSize: 10, fontWeight: weight.bold },
  servingChip: { fontSize: 10, color: colors.textDim, fontWeight: weight.medium },
  foodCals: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent, minWidth: 60, textAlign: 'right' },

  sheetContainer: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetBackBtn: { marginRight: 8, marginTop: 2 },
  sheetHeaderTop: { fontSize: typography.lg },
  sheetHeaderLOG: { fontWeight: weight.black, fontStyle: 'italic', color: colors.text },
  sheetHeaderSub: { fontWeight: weight.bold, fontStyle: 'italic', color: colors.accent },
  trackLabel: { fontSize: 9, fontWeight: weight.bold, color: colors.textDim, letterSpacing: 2, marginTop: 2 },
  sheetCloseBtn: { padding: 6, borderRadius: 18, backgroundColor: colors.card },
  mealChips: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, paddingTop: 14, paddingBottom: 14 },
  mealChip: { flexGrow: 0, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgElevated },
  mealChipText: { fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.semibold },

  searchStep: { flex: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bgElevated, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 10 },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },
  resultsList: { flex: 1 },
  searchHint: { fontSize: typography.xs, color: colors.textDim, textAlign: 'center', paddingVertical: 24 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.bgElevated },
  resultLeft: { flex: 1 },
  resultName: { fontSize: typography.sm, color: colors.text, fontWeight: weight.medium },
  resultMeta: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  resultCals: { fontSize: typography.sm, fontWeight: weight.bold, color: colors.accent },
  resultUnit: { fontSize: 9, color: colors.textDim },
  manualLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  manualLinkText: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.semibold },

  detailStep: { flex: 1 },
  detailName: { fontSize: typography.md, fontWeight: weight.bold, color: colors.text },
  detailBrand: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2, marginBottom: 14 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 18 },
  amountLabel: { fontSize: typography.sm, color: colors.textMuted, fontWeight: weight.medium },
  amountInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.bgElevated, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  amountInput: { color: colors.text, fontSize: typography.base, fontWeight: weight.bold, minWidth: 50, textAlign: 'right' },
  amountUnit: { color: colors.textMuted, fontSize: typography.sm },
  scaledMacros: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.bgElevated, borderRadius: 12, padding: 14, marginBottom: 20 },
  scaledMacroWrap: { alignItems: 'center' },
  scaledMacroVal: { fontSize: typography.base, fontWeight: weight.black },
  scaledMacroUnit: { fontSize: 9, fontWeight: weight.normal, color: colors.textDim },
  scaledMacroLabel: { fontSize: 9, color: colors.textMuted, fontWeight: weight.medium, marginTop: 2 },

  inputFull: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 13, color: colors.text, fontSize: typography.sm, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  macroInputRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  macroInputWrap: { flex: 1 },
  macroInputLabel: { fontSize: 9, fontWeight: weight.bold, marginBottom: 5, letterSpacing: 0.5 },
  macroInput: { backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10, color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border, textAlign: 'center' },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 14, padding: 14, alignItems: 'center' },
  saveBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },

  card: { backgroundColor: colors.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 14 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 10, fontWeight: weight.bold, color: colors.textMuted, letterSpacing: 1.5, fontFamily: fontFamily.mono, marginBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  monthBtn: { padding: 8 },
  monthChevron: { fontSize: 22, color: colors.text, fontWeight: '300' },
  monthLabel: { fontSize: typography.base, fontFamily: fontFamily.displayItalic, color: colors.text, fontStyle: 'italic' },
  avgViewToggleBtn: { padding: 6, borderRadius: 14, backgroundColor: colors.bgElevated },
  hmLegend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hmLegendLabel: { fontSize: 9, color: colors.textDim },
  hmLegendSwatch: { width: 10, height: 10, borderRadius: 2 },
  hmLegendRow: { justifyContent: 'flex-end', marginBottom: 10 },
  hmTabRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hmTabIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  hmTabSub: { fontSize: typography.xs, color: colors.textMuted },

  hmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  hmPopup: { width: '100%', maxWidth: 420, maxHeight: '85%', backgroundColor: colors.bgElevated, borderRadius: 28, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  hmPopupHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  hmPopupTitle: { fontSize: 20, fontWeight: '900', color: colors.text },
  hmPopupSubtitle: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  hmPopupCloseBtn: { padding: 8, borderRadius: 20, backgroundColor: colors.bgCard },
});
