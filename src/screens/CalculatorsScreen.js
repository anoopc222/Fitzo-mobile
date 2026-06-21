import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import { useSubscription } from '../context/SubscriptionContext';
import PaywallModal from '../components/ui/PaywallModal';

// Some calculator entries below use a theme token name (e.g. 'accent') instead of
// a literal hex value for their `color` field, since CALCULATORS is static module
// data defined outside any component. resolveColor() turns a token into the live
// theme color at render time, and passes literal hex strings straight through.
const resolveColor = (token, colors) => colors[token] ?? token;

// ─── math helpers ────────────────────────────────────────────────────────────
const fmt = (v, d = 1) => isNaN(v) || !isFinite(v) ? '--' : Number(v).toFixed(d);

const ACTIVITY = [
  { label: 'Sedentary', multiplier: 1.2 },
  { label: 'Lightly active (1-3d/wk)', multiplier: 1.375 },
  { label: 'Moderately active (3-5d/wk)', multiplier: 1.55 },
  { label: 'Very active (6-7d/wk)', multiplier: 1.725 },
  { label: 'Extra active (athlete)', multiplier: 1.9 },
];

// ─── calculator definitions ───────────────────────────────────────────────────
const CALCULATORS = [
  {
    id: 'bmi', label: 'BMI', icon: 'scale', color: '#e879f9',
    desc: 'Body Mass Index',
    fields: [
      { key: 'weight', label: 'Weight (kg)', placeholder: '75' },
      { key: 'height', label: 'Height (cm)', placeholder: '175' },
    ],
    compute: ({ weight, height }) => {
      const h = height / 100;
      const bmi = weight / (h * h);
      let cat = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese';
      return [{ label: 'BMI', value: fmt(bmi) }, { label: 'Category', value: cat }];
    },
  },
  {
    id: 'bmr', label: 'BMR', icon: 'flame', color: '#fb923c',
    desc: 'Basal Metabolic Rate (Mifflin-St Jeor)',
    fields: [
      { key: 'weight', label: 'Weight (kg)', placeholder: '75' },
      { key: 'height', label: 'Height (cm)', placeholder: '175' },
      { key: 'age', label: 'Age (years)', placeholder: '30' },
      { key: 'sex', label: 'Sex (M/F)', placeholder: 'M' },
    ],
    compute: ({ weight, height, age, sex }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const bmr = isMale
        ? 10 * weight + 6.25 * height - 5 * age + 5
        : 10 * weight + 6.25 * height - 5 * age - 161;
      return [{ label: 'BMR', value: `${fmt(bmr, 0)} kcal/day` }];
    },
  },
  {
    id: 'tdee', label: 'TDEE', icon: 'restaurant', color: '#fb923c',
    desc: 'Total Daily Energy Expenditure',
    fields: [
      { key: 'weight', label: 'Weight (kg)', placeholder: '75' },
      { key: 'height', label: 'Height (cm)', placeholder: '175' },
      { key: 'age', label: 'Age', placeholder: '30' },
      { key: 'sex', label: 'Sex (M/F)', placeholder: 'M' },
    ],
    hasActivitySelect: true,
    compute: ({ weight, height, age, sex, activity }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const bmr = isMale
        ? 10 * weight + 6.25 * height - 5 * age + 5
        : 10 * weight + 6.25 * height - 5 * age - 161;
      const mult = ACTIVITY[activity ?? 1]?.multiplier ?? 1.55;
      const tdee = bmr * mult;
      return [
        { label: 'TDEE', value: `${fmt(tdee, 0)} kcal` },
        { label: 'Cut (-500)', value: `${fmt(tdee - 500, 0)} kcal` },
        { label: 'Bulk (+300)', value: `${fmt(tdee + 300, 0)} kcal` },
      ];
    },
  },
  {
    id: 'oneRM', label: '1RM', icon: 'barbell', color: 'accent',
    desc: 'One Rep Max (Brzycki formula)',
    fields: [
      { key: 'weight', label: 'Weight lifted (kg)', placeholder: '100' },
      { key: 'reps', label: 'Reps performed', placeholder: '5' },
    ],
    compute: ({ weight, reps }) => {
      const r = parseInt(reps, 10);
      const w = parseFloat(weight);
      const oneRM = w * (36 / (37 - r));
      const epley = w * (1 + r / 30);
      return [
        { label: '1RM (Brzycki)', value: `${fmt(oneRM)} kg` },
        { label: '1RM (Epley)', value: `${fmt(epley)} kg` },
        { label: '90% of 1RM', value: `${fmt(oneRM * 0.9)} kg` },
        { label: '80% of 1RM', value: `${fmt(oneRM * 0.8)} kg` },
      ];
    },
  },
  {
    id: 'bodyFat', label: 'Body Fat %', icon: 'body', color: '#22d3ee', pro: true,
    desc: 'Navy method body fat estimate',
    fields: [
      { key: 'sex', label: 'Sex (M/F)', placeholder: 'M' },
      { key: 'height', label: 'Height (cm)', placeholder: '175' },
      { key: 'neck', label: 'Neck (cm)', placeholder: '38' },
      { key: 'waist', label: 'Waist (cm)', placeholder: '85' },
      { key: 'hips', label: 'Hips cm (F only)', placeholder: '' },
    ],
    compute: ({ sex, height, neck, waist, hips }) => {
      const isMale = sex?.toUpperCase() === 'M';
      let bf;
      if (isMale) {
        bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
      } else {
        bf = 495 / (1.29579 - 0.35004 * Math.log10(parseFloat(waist) + parseFloat(hips || 0) - neck) + 0.22100 * Math.log10(height)) - 450;
      }
      return [{ label: 'Body Fat', value: `${fmt(bf)}%` }];
    },
  },
  {
    id: 'macros', label: 'Macro Split', icon: 'pie-chart', color: 'success',
    desc: 'Calculate macros from TDEE',
    fields: [
      { key: 'calories', label: 'Daily calories (kcal)', placeholder: '2000' },
      { key: 'protein', label: 'Protein % (e.g. 30)', placeholder: '30' },
      { key: 'carbs', label: 'Carbs % (e.g. 45)', placeholder: '45' },
      { key: 'fats', label: 'Fats % (e.g. 25)', placeholder: '25' },
    ],
    compute: ({ calories, protein, carbs, fats }) => {
      const cal = parseFloat(calories);
      const p = (cal * parseFloat(protein) / 100) / 4;
      const c = (cal * parseFloat(carbs) / 100) / 4;
      const f = (cal * parseFloat(fats) / 100) / 9;
      return [
        { label: 'Protein', value: `${fmt(p, 0)}g (${fmt(p * 4, 0)} kcal)` },
        { label: 'Carbs', value: `${fmt(c, 0)}g (${fmt(c * 4, 0)} kcal)` },
        { label: 'Fats', value: `${fmt(f, 0)}g (${fmt(f * 9, 0)} kcal)` },
      ];
    },
  },
  {
    id: 'lbm', label: 'Lean Body Mass', icon: 'fitness', color: 'blue', pro: true,
    desc: 'LBM and fat mass from body fat %',
    fields: [
      { key: 'weight', label: 'Body weight (kg)', placeholder: '80' },
      { key: 'bf', label: 'Body fat %', placeholder: '20' },
    ],
    compute: ({ weight, bf }) => {
      const bfFrac = parseFloat(bf) / 100;
      const lbm = parseFloat(weight) * (1 - bfFrac);
      const fatMass = parseFloat(weight) * bfFrac;
      return [
        { label: 'LBM', value: `${fmt(lbm)} kg` },
        { label: 'Fat Mass', value: `${fmt(fatMass)} kg` },
      ];
    },
  },
  {
    id: 'ffmi', label: 'FFMI', icon: 'barbell', color: 'accent', pro: true,
    desc: 'Fat-Free Mass Index',
    fields: [
      { key: 'weight', label: 'Weight (kg)', placeholder: '80' },
      { key: 'height', label: 'Height (cm)', placeholder: '175' },
      { key: 'bf', label: 'Body fat %', placeholder: '15' },
    ],
    compute: ({ weight, height, bf }) => {
      const lbm = parseFloat(weight) * (1 - parseFloat(bf) / 100);
      const h = parseFloat(height) / 100;
      const ffmi = lbm / (h * h);
      const normalized = ffmi + 6.1 * (1.8 - h);
      let rating = normalized > 25 ? 'Elite/Enhanced' : normalized > 22 ? 'Excellent (natural limit)' : normalized > 20 ? 'Good' : 'Average';
      return [
        { label: 'FFMI', value: fmt(ffmi) },
        { label: 'Normalized FFMI', value: fmt(normalized) },
        { label: 'Rating', value: rating },
      ];
    },
  },
  {
    id: 'idealWeight', label: 'Ideal Body Weight', icon: 'scale', color: '#e879f9', pro: true,
    desc: 'Estimated ideal weight (Devine formula)',
    fields: [
      { key: 'height', label: 'Height (cm)', placeholder: '175' },
      { key: 'sex', label: 'Sex (M/F)', placeholder: 'M' },
    ],
    compute: ({ height, sex }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const hIn = (parseFloat(height) - 152.4) / 2.54;
      const ibw = isMale ? 50 + 2.3 * hIn : 45.5 + 2.3 * hIn;
      const low = ibw * 0.9; const high = ibw * 1.1;
      return [
        { label: 'Ideal Weight', value: `${fmt(ibw)} kg` },
        { label: 'Healthy Range', value: `${fmt(low)}–${fmt(high)} kg` },
      ];
    },
  },
  {
    id: 'hrZones', label: 'HR Zones', icon: 'heart', color: 'danger',
    desc: 'Heart rate training zones',
    fields: [{ key: 'age', label: 'Age (years)', placeholder: '30' }],
    compute: ({ age }) => {
      const maxHR = 220 - parseInt(age, 10);
      const zones = [
        { z: 'Zone 1 (Recovery)', pct: '50-60%', low: 0.5, high: 0.6 },
        { z: 'Zone 2 (Fat burn)', pct: '60-70%', low: 0.6, high: 0.7 },
        { z: 'Zone 3 (Aerobic)', pct: '70-80%', low: 0.7, high: 0.8 },
        { z: 'Zone 4 (Threshold)', pct: '80-90%', low: 0.8, high: 0.9 },
        { z: 'Zone 5 (Max)', pct: '90-100%', low: 0.9, high: 1.0 },
      ];
      return [
        { label: 'Max HR', value: `${maxHR} bpm` },
        ...zones.map(z => ({ label: z.z, value: `${Math.round(z.low * maxHR)}–${Math.round(z.high * maxHR)} bpm` })),
      ];
    },
  },
  {
    id: 'protein', label: 'Protein Needs', icon: 'nutrition', color: 'success',
    desc: 'Daily protein target for your goal',
    fields: [
      { key: 'weight', label: 'Body weight (kg)', placeholder: '80' },
      { key: 'goal', label: 'Goal (build/maintain/cut)', placeholder: 'build' },
    ],
    compute: ({ weight, goal }) => {
      const g = goal?.toLowerCase() ?? 'maintain';
      const mult = g === 'build' ? 2.2 : g === 'cut' ? 2.5 : 1.8;
      const min = parseFloat(weight) * mult;
      const max = parseFloat(weight) * (mult + 0.3);
      return [
        { label: 'Protein target', value: `${fmt(min, 0)}–${fmt(max, 0)}g/day` },
        { label: 'Per meal (4 meals)', value: `${fmt(min / 4, 0)}g/meal` },
      ];
    },
  },
  {
    id: 'hydration', label: 'Hydration', icon: 'water', color: '#22d3ee',
    desc: 'Daily water intake target',
    fields: [
      { key: 'weight', label: 'Body weight (kg)', placeholder: '80' },
      { key: 'activity', label: 'Activity (low/med/high)', placeholder: 'med' },
    ],
    compute: ({ weight, activity }) => {
      const act = activity?.toLowerCase() ?? 'med';
      const mult = act === 'high' ? 45 : act === 'low' ? 30 : 37;
      const ml = parseFloat(weight) * mult;
      return [
        { label: 'Water target', value: `${fmt(ml / 1000, 2)} L/day` },
        { label: 'In cups (250ml)', value: `${fmt(ml / 250, 0)} cups` },
      ];
    },
  },
  {
    id: 'deficit', label: 'Deficit Planner', icon: 'trending-down', color: 'warning', pro: true,
    desc: 'How long to reach your goal weight',
    fields: [
      { key: 'current', label: 'Current weight (kg)', placeholder: '90' },
      { key: 'goal', label: 'Goal weight (kg)', placeholder: '80' },
      { key: 'deficit', label: 'Daily deficit (kcal)', placeholder: '500' },
    ],
    compute: ({ current, goal, deficit }) => {
      const kgToLose = parseFloat(current) - parseFloat(goal);
      const kcalPerKg = 7700;
      const totalKcal = kgToLose * kcalPerKg;
      const days = totalKcal / parseFloat(deficit);
      const weeks = days / 7;
      return [
        { label: 'Weight to lose', value: `${fmt(kgToLose)} kg` },
        { label: 'Estimated time', value: `${fmt(weeks, 0)} weeks (${fmt(days, 0)} days)` },
        { label: 'Rate of loss', value: `${fmt(parseFloat(deficit) / kcalPerKg * 7, 2)} kg/week` },
      ];
    },
  },
  {
    id: 'waistHip', label: 'Waist-Hip Ratio', icon: 'body', color: '#e879f9', pro: true,
    desc: 'Cardiovascular risk indicator',
    fields: [
      { key: 'waist', label: 'Waist (cm)', placeholder: '85' },
      { key: 'hips', label: 'Hips (cm)', placeholder: '95' },
      { key: 'sex', label: 'Sex (M/F)', placeholder: 'M' },
    ],
    compute: ({ waist, hips, sex }) => {
      const ratio = parseFloat(waist) / parseFloat(hips);
      const isMale = sex?.toUpperCase() === 'M';
      const risk = isMale
        ? ratio < 0.9 ? 'Low' : ratio < 1.0 ? 'Moderate' : 'High'
        : ratio < 0.8 ? 'Low' : ratio < 0.85 ? 'Moderate' : 'High';
      return [
        { label: 'WHR', value: fmt(ratio, 2) },
        { label: 'Risk', value: risk },
      ];
    },
  },
  {
    id: 'volumeLoad', label: 'Volume Load', icon: 'layers', color: 'accent', pro: true,
    desc: 'Total training volume for a set',
    fields: [
      { key: 'sets', label: 'Sets', placeholder: '4' },
      { key: 'reps', label: 'Reps per set', placeholder: '8' },
      { key: 'weight', label: 'Weight (kg)', placeholder: '100' },
    ],
    compute: ({ sets, reps, weight }) => {
      const vol = parseInt(sets, 10) * parseInt(reps, 10) * parseFloat(weight);
      const e1rm = parseFloat(weight) * (1 + parseInt(reps, 10) / 30);
      return [
        { label: 'Volume Load', value: `${fmt(vol, 0)} kg` },
        { label: 'Estimated 1RM (Epley)', value: `${fmt(e1rm)} kg` },
      ];
    },
  },
  {
    id: 'wilks', label: 'Wilks Score', icon: 'trophy', color: 'warning', pro: true,
    desc: 'Powerlifting strength standard',
    fields: [
      { key: 'total', label: 'Powerlifting total (kg)', placeholder: '400' },
      { key: 'bw', label: 'Body weight (kg)', placeholder: '75' },
      { key: 'sex', label: 'Sex (M/F)', placeholder: 'M' },
    ],
    compute: ({ total, bw, sex }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const b = parseFloat(bw);
      const coeffs = isMale
        ? [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8]
        : [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8];
      const denom = coeffs[0] + coeffs[1]*b + coeffs[2]*b**2 + coeffs[3]*b**3 + coeffs[4]*b**4 + coeffs[5]*b**5;
      const wilks = (500 / denom) * parseFloat(total);
      return [{ label: 'Wilks Score', value: fmt(wilks) }];
    },
  },
  {
    id: 'sleep', label: 'Sleep Calculator', icon: 'moon', color: 'purple', pro: true,
    desc: 'Optimal wake-up times based on sleep cycles',
    fields: [{ key: 'bedtime', label: 'Bedtime (HH:MM, 24h)', placeholder: '23:00' }],
    compute: ({ bedtime }) => {
      if (!bedtime?.includes(':')) return [{ label: 'Error', value: 'Enter time as HH:MM' }];
      const [h, m] = bedtime.split(':').map(Number);
      const base = h * 60 + m + 14;
      const cycles = [3, 4, 5, 6];
      return cycles.map(c => {
        const total = base + c * 90;
        const wh = Math.floor(total / 60) % 24;
        const wm = total % 60;
        return { label: `${c} cycles (${c * 1.5}h)`, value: `Wake at ${String(wh).padStart(2,'0')}:${String(wm).padStart(2,'0')}` };
      });
    },
  },
  {
    id: 'strengthLevel', label: 'Strength Level', icon: 'barbell', color: 'blue', pro: true,
    desc: 'Strength standard relative to bodyweight',
    fields: [
      { key: 'lift', label: 'Lift (bench/squat/deadlift)', placeholder: 'bench' },
      { key: 'weight', label: 'Weight lifted (kg)', placeholder: '100' },
      { key: 'bw', label: 'Body weight (kg)', placeholder: '80' },
    ],
    compute: ({ lift, weight, bw }) => {
      const ratio = parseFloat(weight) / parseFloat(bw);
      const standards = {
        bench: [0.5, 0.75, 1.0, 1.25, 1.5],
        squat: [0.75, 1.0, 1.25, 1.5, 1.75],
        deadlift: [1.0, 1.25, 1.5, 1.75, 2.0],
      };
      const key = lift?.toLowerCase() in standards ? lift.toLowerCase() : 'bench';
      const [beg, nov, int, adv, eli] = standards[key];
      let level = ratio < beg ? 'Beginner' : ratio < nov ? 'Novice' : ratio < int ? 'Intermediate' : ratio < adv ? 'Advanced' : ratio < eli ? 'Elite' : 'World Class';
      return [
        { label: 'Ratio (lift/BW)', value: fmt(ratio, 2) },
        { label: 'Level', value: level },
      ];
    },
  },
  {
    id: 'caloriesBurned', label: 'Calories Burned', icon: 'flame', color: '#fb923c', pro: true,
    desc: 'Estimate calories burned during exercise',
    fields: [
      { key: 'weight', label: 'Body weight (kg)', placeholder: '80' },
      { key: 'duration', label: 'Duration (minutes)', placeholder: '45' },
      { key: 'met', label: 'MET value (run=8, walk=3.5)', placeholder: '5' },
    ],
    compute: ({ weight, duration, met }) => {
      const kcal = (parseFloat(met) * 3.5 * parseFloat(weight) / 200) * parseFloat(duration);
      return [{ label: 'Calories burned', value: `${fmt(kcal, 0)} kcal` }];
    },
  },
  {
    id: 'plateCalc', label: 'Plate Calculator', icon: 'barbell', color: 'accent',
    desc: 'Plates needed per side for a barbell',
    fields: [
      { key: 'target', label: 'Target weight (kg)', placeholder: '100' },
      { key: 'bar', label: 'Bar weight (kg)', placeholder: '20' },
    ],
    compute: ({ target, bar }) => {
      let remaining = (parseFloat(target) - parseFloat(bar)) / 2;
      const plates = [25, 20, 15, 10, 5, 2.5, 1.25];
      const used = [];
      for (const p of plates) {
        const count = Math.floor(remaining / p);
        if (count > 0) { used.push({ plate: p, count }); remaining -= count * p; }
      }
      if (Math.abs(remaining) > 0.1) used.push({ plate: remaining, count: 1, note: '(non-standard)' });
      return used.map(u => ({ label: `${u.plate}kg plates`, value: `× ${u.count} each side${u.note ? ' ' + u.note : ''}` }));
    },
  },
];

// ─── screen ───────────────────────────────────────────────────────────────────
export default function CalculatorsScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);
  const [inputs, setInputs] = useState({});
  const [activityIdx, setActivityIdx] = useState(1);
  const [results, setResults] = useState({});
  const { hasAccess } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const filtered = CALCULATORS.filter(c =>
    !search || c.label.toLowerCase().includes(search.toLowerCase()) || c.desc.toLowerCase().includes(search.toLowerCase())
  );

  const handleCompute = (calc) => {
    try {
      const inp = inputs[calc.id] ?? {};
      const res = calc.compute({ ...inp, activity: activityIdx });
      setResults(prev => ({ ...prev, [calc.id]: res }));
    } catch (e) {
      setResults(prev => ({ ...prev, [calc.id]: [{ label: 'Error', value: e.message }] }));
    }
  };

  const setInput = (calcId, field, val) => {
    setInputs(prev => ({ ...prev, [calcId]: { ...(prev[calcId] ?? {}), [field]: val } }));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Calculators</Text>
        <Text style={styles.count}>{CALCULATORS.length}</Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textDim} />
        <TextInput style={styles.searchInput} placeholder="Search calculators…" placeholderTextColor={colors.textDim}
          value={search} onChangeText={setSearch} />
        {search ? <TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={16} color={colors.textDim} /></TouchableOpacity> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {filtered.map((calc) => {
          const isOpen = openId === calc.id;
          const calcResults = results[calc.id] ?? [];
          const calcColor = resolveColor(calc.color, colors);

          return (
            <View key={calc.id} style={styles.calcCard}>
              <TouchableOpacity
                style={styles.calcHeader}
                onPress={() => {
                  if (calc.pro && !hasAccess) { setShowPaywall(true); return; }
                  setOpenId(isOpen ? null : calc.id);
                }}
              >
                <View style={[styles.calcIcon, { backgroundColor: calcColor + '22' }]}>
                  <Ionicons name={calc.icon} size={20} color={calcColor} />
                </View>
                <View style={styles.calcInfo}>
                  <Text style={styles.calcLabel}>{calc.label}</Text>
                  <Text style={styles.calcDesc}>{calc.desc}</Text>
                </View>
                {calc.pro && !hasAccess
                  ? <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
                  : <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
                }
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.calcBody}>
                  {/* Fields */}
                  {calc.fields.map(field => (
                    <View key={field.key} style={styles.fieldRow}>
                      <Text style={styles.fieldLabel}>{field.label}</Text>
                      <TextInput
                        style={styles.fieldInput}
                        placeholder={field.placeholder}
                        placeholderTextColor={colors.textDim}
                        value={(inputs[calc.id] ?? {})[field.key] ?? ''}
                        onChangeText={v => setInput(calc.id, field.key, v)}
                        keyboardType={field.key === 'sex' || field.key === 'goal' || field.key === 'activity' || field.key === 'lift' || field.key === 'bedtime' ? 'default' : 'numeric'}
                      />
                    </View>
                  ))}

                  {/* Activity selector (TDEE) */}
                  {calc.hasActivitySelect && (
                    <View style={styles.activityWrap}>
                      <Text style={styles.fieldLabel}>Activity Level</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityRow}>
                        {ACTIVITY.map((a, i) => (
                          <TouchableOpacity key={i} style={[styles.actChip, activityIdx === i && styles.actChipActive]} onPress={() => setActivityIdx(i)}>
                            <Text style={[styles.actChipText, activityIdx === i && { color: colors.bg }]}>{a.label.split(' ')[0]}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Calculate button */}
                  <TouchableOpacity style={[styles.calcBtn, { backgroundColor: calcColor }]} onPress={() => handleCompute(calc)}>
                    <Text style={styles.calcBtnText}>Calculate</Text>
                  </TouchableOpacity>

                  {/* Results */}
                  {calcResults.length > 0 && (
                    <View style={styles.results}>
                      {calcResults.map((r, i) => (
                        <View key={i} style={styles.resultRow}>
                          <Text style={styles.resultLabel}>{r.label}</Text>
                          <Text style={[styles.resultValue, { color: calcColor }]}>{r.value}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}
        <View style={{ height: 20 }} />
      </ScrollView>

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { flex: 1, fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },
  count: { fontSize: typography.xs, color: colors.accent, fontWeight: weight.bold, backgroundColor: colors.accent + '22', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.bgCard, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.sm },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  calcCard: { backgroundColor: colors.bgCard, borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  calcHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  calcIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  calcInfo: { flex: 1 },
  calcLabel: { fontSize: typography.base, fontWeight: weight.semibold, color: colors.text },
  calcDesc: { fontSize: typography.xs, color: colors.textDim, marginTop: 1 },
  calcBody: { padding: 14, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  fieldLabel: { flex: 1, fontSize: typography.xs, color: colors.textMuted, fontWeight: weight.medium },
  fieldInput: { flex: 1, backgroundColor: colors.bgElevated, borderRadius: 10, padding: 10, color: colors.text, fontSize: typography.sm, borderWidth: 1, borderColor: colors.border, textAlign: 'center' },
  activityWrap: { marginBottom: 10 },
  activityRow: { flexDirection: 'row', gap: 6, paddingTop: 6 },
  actChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border },
  actChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  actChipText: { fontSize: 10, color: colors.textMuted, fontWeight: weight.semibold },
  calcBtn: { borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 4, marginBottom: 10 },
  calcBtnText: { color: colors.bg, fontWeight: weight.bold, fontSize: typography.sm },
  results: { backgroundColor: colors.bgElevated, borderRadius: 10, padding: 12, gap: 6 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultLabel: { fontSize: typography.xs, color: colors.textMuted },
  resultValue: { fontSize: typography.sm, fontWeight: weight.bold },
});
