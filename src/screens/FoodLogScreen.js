import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, FlatList, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const MEAL_ICONS = { Breakfast: 'sunny', Lunch: 'restaurant', Dinner: 'moon', Snack: 'cafe' };

const MACRO_TARGETS = { calories: 2000, protein: 150, carbs: 250, fats: 65 };

const SOURCE_LABELS = { USDA: 'USDA', CoFID: 'UK CoFID', OFF: 'Open Food Facts', CUSTOM: 'Custom' };

const EMPTY_FORM = { food_name: '', calories: '', protein: '', carbs: '', fats: '' };

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

async function addFood(userId, food) {
  const { error } = await supabase.from('food_logs').insert({ user_id: userId, ...food, logged_at: new Date().toISOString() });
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

function fmtDate(d) {
  const today = new Date();
  if (dateStr(d) === dateStr(today)) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (dateStr(d) === dateStr(yesterday)) return 'Yesterday';
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
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const MEAL_COLORS = useMemo(() => ({
    Breakfast: '#fb923c', Lunch: '#22d3ee', Dinner: colors.purple, Snack: colors.success,
  }), [colors]);
  const qc = useQueryClient();
  const { isPro } = useSubscription();
  const [showTargetsPaywall, setShowTargetsPaywall] = useState(false);
  const summaryExport = useGatedExport();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showSheet, setShowSheet] = useState(false);
  const [sheetStep, setSheetStep] = useState('search'); // 'search' | 'detail' | 'manual'
  const [selectedMeal, setSelectedMeal] = useState('Breakfast');
  const [form, setForm] = useState(EMPTY_FORM);

  // Search step state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
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

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['food', user?.id, today],
    queryFn: () => fetchFoodLog(user.id, today),
    enabled: !!user?.id,
  });

  const { data: searchResults, isLoading: searching } = useQuery({
    queryKey: ['foodSearch', debouncedQuery],
    queryFn: () => searchFoods(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60 * 1000,
  });

  const addMut = useMutation({
    mutationFn: (food) => addFood(user.id, food),
    onMutate: async (food) => {
      await qc.cancelQueries(['food', user.id, today]);
      const previous = qc.getQueryData(['food', user.id, today]);
      qc.setQueryData(['food', user.id, today], (old) => {
        if (!old) return old;
        const optimisticLog = { id: `optimistic-${Date.now()}`, ...food, serving_size: food.serving_size ?? null, logged_at: new Date().toISOString() };
        return { ...old, logs: [...old.logs, optimisticLog] };
      });
      closeSheet();
      return { previous };
    },
    onError: (e, vars, context) => {
      if (context?.previous) qc.setQueryData(['food', user.id, today], context.previous);
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
    if (!proteinInput || !carbsInput || !fatsInput) return Alert.alert('Required', 'Enter protein, carbs, and fats targets');
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
    if (!form.food_name.trim() || !form.calories) return Alert.alert('Required', 'Enter food name and calories');
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
        <Text style={styles.dateLabel}>{fmtDate(currentDate)}</Text>
        <TouchableOpacity onPress={nextDay} style={styles.dateArrow}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.accent} />}>
        {isLoading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} /> : (
          <>
            {/* Calorie summary */}
            <View>
              <View style={styles.summaryCard}>
                <View style={styles.targetsPillRow}>
                  <TouchableOpacity style={styles.goalPillBtn} onPress={openTargetsSheet}>
                    <Text style={styles.goalPillBtnText}>Edit Targets</Text>
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
                    <Text style={styles.ringLabel}>kcal</Text>
                  </View>
                  <View style={styles.ringRight}>
                    <Text style={styles.ringTarget}>Goal: {targets.calories} kcal</Text>
                    <Text style={[styles.ringRemain, { color: calPct >= 100 ? colors.danger : colors.success }]}>
                      {calPct >= 100
                        ? `+${(totals.calories - targets.calories).toFixed(0)} over`
                        : `${(targets.calories - totals.calories).toFixed(0)} remaining`
                      }
                    </Text>
                  </View>
                </View>

                {/* Macro bars */}
                <View style={styles.macroBars}>
                  <MacroBar label="Protein" value={Math.round(totals.protein)} target={targets.protein} color={colors.success} />
                  <MacroBar label="Carbs" value={Math.round(totals.carbs)} target={targets.carbs} color="#fb923c" />
                  <MacroBar label="Fats" value={Math.round(totals.fats)} target={targets.fats} color={colors.warning} />
                </View>
              </View>
            </View>

            <View style={{ position: 'absolute', top: -9999, left: -9999 }} pointerEvents="none">
              <ExportCardTemplate ref={summaryExport.ref} title="Today's Nutrition" colors={colors} width={340}>
                <View style={styles.calorieRing}>
                  <View style={[styles.ringOuter, { borderColor: calPct >= 100 ? colors.danger : colors.accent }]}>
                    <Text style={[styles.ringNum, { color: calPct >= 100 ? colors.danger : colors.accent }]}>
                      {totals.calories.toFixed(0)}
                    </Text>
                    <Text style={styles.ringLabel}>kcal</Text>
                  </View>
                  <View style={styles.ringRight}>
                    <Text style={styles.ringTarget}>Goal: {targets.calories} kcal</Text>
                    <Text style={[styles.ringRemain, { color: calPct >= 100 ? colors.danger : colors.success }]}>
                      {calPct >= 100
                        ? `+${(totals.calories - targets.calories).toFixed(0)} over`
                        : `${(targets.calories - totals.calories).toFixed(0)} remaining`
                      }
                    </Text>
                  </View>
                </View>
                <View style={styles.macroBars}>
                  <MacroBar label="Protein" value={Math.round(totals.protein)} target={targets.protein} color={colors.success} />
                  <MacroBar label="Carbs" value={Math.round(totals.carbs)} target={targets.carbs} color="#fb923c" />
                  <MacroBar label="Fats" value={Math.round(totals.fats)} target={targets.fats} color={colors.warning} />
                </View>
              </ExportCardTemplate>
            </View>

            {/* Log food button */}
            <TouchableOpacity style={styles.addBtn} onPress={() => openSheet('Breakfast')}>
              <Ionicons name="search" size={18} color={colors.bg} />
              <Text style={styles.addBtnText}>Log Food</Text>
            </TouchableOpacity>

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
                    <Text style={styles.mealTitle}>{meal}</Text>
                    <Text style={[styles.mealCals, { color: mealColor }]}>{mealCals.toFixed(0)} kcal</Text>
                    <TouchableOpacity onPress={() => openSheet(meal)}>
                      <Ionicons name="add-circle-outline" size={22} color={mealColor} />
                    </TouchableOpacity>
                  </View>
                  {items.length === 0 ? (
                    <Text style={styles.mealEmpty}>Nothing logged yet</Text>
                  ) : (
                    items.map(item => (
                      <View key={item.id} style={styles.foodItem}>
                        <View style={styles.foodItemLeft}>
                          <Text style={styles.foodName}>{item.food_name}</Text>
                          <View style={styles.macroChips}>
                            {item.serving_size ? <Text style={styles.servingChip}>{item.serving_size}</Text> : null}
                            {item.protein > 0 && <MacroChip label={`${Math.round(item.protein)}P`} color={colors.success} />}
                            {item.carbs > 0 && <MacroChip label={`${Math.round(item.carbs)}C`} color="#fb923c" />}
                            {item.fats > 0 && <MacroChip label={`${Math.round(item.fats)}F`} color={colors.warning} />}
                          </View>
                        </View>
                        <Text style={styles.foodCals}>{item.calories} kcal</Text>
                        <TouchableOpacity onPress={() => Alert.alert('Delete', `Remove "${item.food_name}"?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(item.id) },
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

      {/* Log Food Sheet: search -> detail (serving) or manual entry */}
      <BottomSheet visible={showSheet} onClose={closeSheet} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          {sheetStep !== 'search' ? (
            <TouchableOpacity onPress={() => setSheetStep('search')} style={styles.sheetBackBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          ) : <View style={styles.sheetBackBtn} />}
          <Text style={styles.sheetTitle}>
            {sheetStep === 'detail' ? 'Add Serving' : sheetStep === 'manual' ? 'Custom Food' : 'Log Food'}
          </Text>
          <TouchableOpacity onPress={closeSheet}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Meal type chips (shown on every step) */}
        <View style={styles.mealChips}>
          {MEAL_TYPES.map(m => (
            <TouchableOpacity key={m} style={[styles.mealChip, selectedMeal === m && { backgroundColor: MEAL_COLORS[m], borderColor: MEAL_COLORS[m] }]}
              onPress={() => setSelectedMeal(m)}>
              <Text style={[styles.mealChipText, selectedMeal === m && { color: '#fff' }]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {sheetStep === 'search' && (
          <View style={styles.searchStep}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={colors.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search 39,000+ foods (e.g. chicken breast)"
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
                  <Text style={styles.searchHint}>Type at least 2 characters to search</Text>
                ) : !searching ? (
                  <Text style={styles.searchHint}>No matches found</Text>
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.resultRow} onPress={() => pickFood(item)}>
                  <View style={styles.resultLeft}>
                    <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.resultMeta} numberOfLines={1}>
                      {item.brand ? `${item.brand} · ` : ''}{SOURCE_LABELS[item.source] ?? item.source}
                    </Text>
                  </View>
                  <Text style={styles.resultCals}>{Math.round(item.calories ?? 0)} kcal</Text>
                  <Text style={styles.resultUnit}>/{item.serving_qty ?? 100}{item.serving_unit ?? 'g'}</Text>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity style={styles.manualLink} onPress={() => setSheetStep('manual')}>
              <Ionicons name="create-outline" size={14} color={colors.accent} />
              <Text style={styles.manualLinkText}>Can't find it? Add a custom food</Text>
            </TouchableOpacity>
          </View>
        )}

        {sheetStep === 'detail' && selectedFood && (
          <View style={styles.detailStep}>
            <Text style={styles.detailName}>{selectedFood.name}</Text>
            {selectedFood.brand ? <Text style={styles.detailBrand}>{selectedFood.brand}</Text> : null}

            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Amount</Text>
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
              <ScaledMacro label="Calories" value={scaled.calories} unit="kcal" color={colors.accent} />
              <ScaledMacro label="Protein" value={scaled.protein} unit="g" color={colors.success} />
              <ScaledMacro label="Carbs" value={scaled.carbs} unit="g" color="#fb923c" />
              <ScaledMacro label="Fats" value={scaled.fats} unit="g" color={colors.warning} />
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleLogSelected} disabled={addMut.isPending}>
              {addMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Add to {selectedMeal}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {sheetStep === 'manual' && (
          <View>
            <TextInput style={styles.inputFull} placeholder="Food name (e.g. Chicken breast 100g)"
              placeholderTextColor={colors.textDim} value={form.food_name}
              onChangeText={v => setForm(p => ({ ...p, food_name: v }))} />

            <View style={styles.macroInputRow}>
              <MacroInput label="Calories" value={form.calories} onChange={v => setForm(p => ({ ...p, calories: v }))} color={colors.accent} />
              <MacroInput label="Protein" value={form.protein} onChange={v => setForm(p => ({ ...p, protein: v }))} color={colors.success} />
              <MacroInput label="Carbs" value={form.carbs} onChange={v => setForm(p => ({ ...p, carbs: v }))} color="#fb923c" />
              <MacroInput label="Fats" value={form.fats} onChange={v => setForm(p => ({ ...p, fats: v }))} color={colors.warning} />
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleAddManual} disabled={addMut.isPending}>
              {addMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Food</Text>}
            </TouchableOpacity>
          </View>
        )}
      </BottomSheet>

      <BottomSheet visible={showTargetsSheet} onClose={() => setShowTargetsSheet(false)}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>SET MACRO TARGETS</Text>
          <TouchableOpacity onPress={() => setShowTargetsSheet(false)}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.goalBigVal}>{computedCalories} kcal</Text>
        <Text style={styles.goalBigSub}>auto-calculated calorie target</Text>

        <View style={styles.targetsFieldRow}>
          <Text style={styles.sheetFieldLabel}>PROTEIN (G)</Text>
          <TextInput style={styles.sheetInput} value={proteinInput} onChangeText={setProteinInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textDim} />
        </View>
        <View style={styles.targetsFieldRow}>
          <Text style={styles.sheetFieldLabel}>CARBS (G)</Text>
          <TextInput style={styles.sheetInput} value={carbsInput} onChangeText={setCarbsInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textDim} />
        </View>
        <View style={styles.targetsFieldRow}>
          <Text style={styles.sheetFieldLabel}>FATS (G)</Text>
          <TextInput style={styles.sheetInput} value={fatsInput} onChangeText={setFatsInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.textDim} />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveTargets} disabled={targetsMut.isPending}>
          {targetsMut.isPending ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.saveBtnText}>Save Targets</Text>}
        </TouchableOpacity>
      </BottomSheet>

      <PaywallModal visible={summaryExport.showPaywall} onClose={() => summaryExport.setShowPaywall(false)} />
      <PaywallModal visible={showTargetsPaywall} onClose={() => setShowTargetsPaywall(false)} />
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
  content: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12 },

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

  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 14, padding: 14, marginBottom: 14 },
  addBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.base },

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

  sheet: { paddingBottom: 16, height: '88%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetBackBtn: { width: 22 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  mealChips: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, paddingBottom: 14 },
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
});
