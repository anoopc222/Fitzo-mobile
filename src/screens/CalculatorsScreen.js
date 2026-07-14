import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import { useSubscription } from '../context/SubscriptionContext';
import PaywallModal from '../components/ui/PaywallModal';
import ScreenHeader from '../components/ScreenHeader';

// Some calculator entries below use a theme token name (e.g. 'accent') instead of
// a literal hex value for their `color` field, since CALCULATORS is static module
// data defined outside any component. resolveColor() turns a token into the live
// theme color at render time, and passes literal hex strings straight through.
const resolveColor = (token, colors) => colors[token] ?? token;

// ─── math helpers ────────────────────────────────────────────────────────────
const fmt = (v, d = 1) => isNaN(v) || !isFinite(v) ? '--' : Number(v).toFixed(d);

const ACTIVITY_KEYS = [
  { full: 'activitySedentary', short: 'activitySedentaryShort' },
  { full: 'activityLight', short: 'activityLightShort' },
  { full: 'activityModerate', short: 'activityModerateShort' },
  { full: 'activityVery', short: 'activityVeryShort' },
  { full: 'activityExtra', short: 'activityExtraShort' },
];

// ─── calculator definitions (factory; needs `t` for translated strings) ──────
const buildCalculators = (t, ACTIVITY) => [
  {
    id: 'bmi', label: 'BMI', icon: 'scale', color: '#e879f9',
    desc: t('calculators.bmiDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldWeightKg'), placeholder: '75' },
      { key: 'height', label: t('calculators.fieldHeightCm'), placeholder: '175' },
    ],
    compute: ({ weight, height }) => {
      const h = height / 100;
      const bmi = weight / (h * h);
      let cat = bmi < 18.5 ? t('calculators.categoryUnderweight') : bmi < 25 ? t('calculators.categoryNormal') : bmi < 30 ? t('calculators.categoryOverweight') : t('calculators.categoryObese');
      return [{ label: t('calculators.resultBmi'), value: fmt(bmi) }, { label: t('calculators.resultCategory'), value: cat }];
    },
  },
  {
    id: 'bmr', label: 'BMR', icon: 'flame', color: '#fb923c',
    desc: t('calculators.bmrDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldWeightKg'), placeholder: '75' },
      { key: 'height', label: t('calculators.fieldHeightCm'), placeholder: '175' },
      { key: 'age', label: t('calculators.fieldAgeYears'), placeholder: '30' },
      { key: 'sex', label: t('calculators.fieldSex'), placeholder: 'M' },
    ],
    compute: ({ weight, height, age, sex }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const bmr = isMale
        ? 10 * weight + 6.25 * height - 5 * age + 5
        : 10 * weight + 6.25 * height - 5 * age - 161;
      return [{ label: t('calculators.resultBmr'), value: t('calculators.valueKcalPerDay', { value: fmt(bmr, 0) }) }];
    },
  },
  {
    id: 'tdee', label: 'TDEE', icon: 'restaurant', color: '#fb923c',
    desc: t('calculators.tdeeDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldWeightKg'), placeholder: '75' },
      { key: 'height', label: t('calculators.fieldHeightCm'), placeholder: '175' },
      { key: 'age', label: t('calculators.fieldAge'), placeholder: '30' },
      { key: 'sex', label: t('calculators.fieldSex'), placeholder: 'M' },
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
        { label: t('calculators.resultTdee'), value: t('calculators.valueKcal', { value: fmt(tdee, 0) }) },
        { label: t('calculators.resultCut'), value: t('calculators.valueKcal', { value: fmt(tdee - 500, 0) }) },
        { label: t('calculators.resultBulk'), value: t('calculators.valueKcal', { value: fmt(tdee + 300, 0) }) },
      ];
    },
  },
  {
    id: 'oneRM', label: '1RM', icon: 'barbell', color: 'accent',
    desc: t('calculators.oneRmDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldWeightLifted'), placeholder: '100' },
      { key: 'reps', label: t('calculators.fieldRepsPerformed'), placeholder: '5' },
    ],
    compute: ({ weight, reps }) => {
      const r = parseInt(reps, 10);
      const w = parseFloat(weight);
      const oneRM = w * (36 / (37 - r));
      const epley = w * (1 + r / 30);
      return [
        { label: t('calculators.resultOneRmBrzycki'), value: t('calculators.valueKg', { value: fmt(oneRM) }) },
        { label: t('calculators.resultOneRmEpley'), value: t('calculators.valueKg', { value: fmt(epley) }) },
        { label: t('calculators.resultNinetyPercent'), value: t('calculators.valueKg', { value: fmt(oneRM * 0.9) }) },
        { label: t('calculators.resultEightyPercent'), value: t('calculators.valueKg', { value: fmt(oneRM * 0.8) }) },
      ];
    },
  },
  {
    id: 'bodyFat', label: t('calculators.labelBodyFat'), icon: 'body', color: '#22d3ee', pro: true,
    desc: t('calculators.bodyFatDesc'),
    fields: [
      { key: 'sex', label: t('calculators.fieldSex'), placeholder: 'M' },
      { key: 'height', label: t('calculators.fieldHeightCm'), placeholder: '175' },
      { key: 'neck', label: t('calculators.fieldNeckCm'), placeholder: '38' },
      { key: 'waist', label: t('calculators.fieldWaistCm'), placeholder: '85' },
      { key: 'hips', label: t('calculators.fieldHipsCmFemaleOnly'), placeholder: '' },
    ],
    compute: ({ sex, height, neck, waist, hips }) => {
      const isMale = sex?.toUpperCase() === 'M';
      let bf;
      if (isMale) {
        bf = 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
      } else {
        bf = 495 / (1.29579 - 0.35004 * Math.log10(parseFloat(waist) + parseFloat(hips || 0) - neck) + 0.22100 * Math.log10(height)) - 450;
      }
      return [{ label: t('calculators.resultBodyFat'), value: `${fmt(bf)}%` }];
    },
  },
  {
    id: 'macros', label: t('calculators.labelMacroSplit'), icon: 'pie-chart', color: 'success',
    desc: t('calculators.macrosDesc'),
    fields: [
      { key: 'calories', label: t('calculators.fieldDailyCalories'), placeholder: '2000' },
      { key: 'protein', label: t('calculators.fieldProteinPercent'), placeholder: '30' },
      { key: 'carbs', label: t('calculators.fieldCarbsPercent'), placeholder: '45' },
      { key: 'fats', label: t('calculators.fieldFatsPercent'), placeholder: '25' },
    ],
    compute: ({ calories, protein, carbs, fats }) => {
      const cal = parseFloat(calories);
      const p = (cal * parseFloat(protein) / 100) / 4;
      const c = (cal * parseFloat(carbs) / 100) / 4;
      const f = (cal * parseFloat(fats) / 100) / 9;
      return [
        { label: t('calculators.resultProtein'), value: t('calculators.valueGramsKcal', { grams: fmt(p, 0), kcal: fmt(p * 4, 0) }) },
        { label: t('calculators.resultCarbs'), value: t('calculators.valueGramsKcal', { grams: fmt(c, 0), kcal: fmt(c * 4, 0) }) },
        { label: t('calculators.resultFats'), value: t('calculators.valueGramsKcal', { grams: fmt(f, 0), kcal: fmt(f * 9, 0) }) },
      ];
    },
  },
  {
    id: 'lbm', label: t('calculators.labelLeanBodyMass'), icon: 'fitness', color: 'blue', pro: true,
    desc: t('calculators.lbmDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldBodyWeight'), placeholder: '80' },
      { key: 'bf', label: t('calculators.fieldBodyFatPercent'), placeholder: '20' },
    ],
    compute: ({ weight, bf }) => {
      const bfFrac = parseFloat(bf) / 100;
      const lbm = parseFloat(weight) * (1 - bfFrac);
      const fatMass = parseFloat(weight) * bfFrac;
      return [
        { label: t('calculators.resultLbm'), value: t('calculators.valueKg', { value: fmt(lbm) }) },
        { label: t('calculators.resultFatMass'), value: t('calculators.valueKg', { value: fmt(fatMass) }) },
      ];
    },
  },
  {
    id: 'ffmi', label: 'FFMI', icon: 'barbell', color: 'accent', pro: true,
    desc: t('calculators.ffmiDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldWeightKg'), placeholder: '80' },
      { key: 'height', label: t('calculators.fieldHeightCm'), placeholder: '175' },
      { key: 'bf', label: t('calculators.fieldBodyFatPercent'), placeholder: '15' },
    ],
    compute: ({ weight, height, bf }) => {
      const lbm = parseFloat(weight) * (1 - parseFloat(bf) / 100);
      const h = parseFloat(height) / 100;
      const ffmi = lbm / (h * h);
      const normalized = ffmi + 6.1 * (1.8 - h);
      let rating = normalized > 25 ? t('calculators.ratingEliteEnhanced') : normalized > 22 ? t('calculators.ratingExcellentNaturalLimit') : normalized > 20 ? t('calculators.ratingGood') : t('calculators.ratingAverage');
      return [
        { label: t('calculators.resultFfmi'), value: fmt(ffmi) },
        { label: t('calculators.resultNormalizedFfmi'), value: fmt(normalized) },
        { label: t('calculators.resultRating'), value: rating },
      ];
    },
  },
  {
    id: 'idealWeight', label: t('calculators.labelIdealBodyWeight'), icon: 'scale', color: '#e879f9', pro: true,
    desc: t('calculators.idealWeightDesc'),
    fields: [
      { key: 'height', label: t('calculators.fieldHeightCm'), placeholder: '175' },
      { key: 'sex', label: t('calculators.fieldSex'), placeholder: 'M' },
    ],
    compute: ({ height, sex }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const hIn = (parseFloat(height) - 152.4) / 2.54;
      const ibw = isMale ? 50 + 2.3 * hIn : 45.5 + 2.3 * hIn;
      const low = ibw * 0.9; const high = ibw * 1.1;
      return [
        { label: t('calculators.resultIdealWeight'), value: t('calculators.valueKg', { value: fmt(ibw) }) },
        { label: t('calculators.resultHealthyRange'), value: t('calculators.valueRangeKg', { low: fmt(low), high: fmt(high) }) },
      ];
    },
  },
  {
    id: 'hrZones', label: 'HR Zones', icon: 'heart', color: 'danger',
    desc: t('calculators.hrZonesDesc'),
    fields: [{ key: 'age', label: t('calculators.fieldAgeYears'), placeholder: '30' }],
    compute: ({ age }) => {
      const maxHR = 220 - parseInt(age, 10);
      const zones = [
        { z: t('calculators.zoneRecovery'), low: 0.5, high: 0.6 },
        { z: t('calculators.zoneFatBurn'), low: 0.6, high: 0.7 },
        { z: t('calculators.zoneAerobic'), low: 0.7, high: 0.8 },
        { z: t('calculators.zoneThreshold'), low: 0.8, high: 0.9 },
        { z: t('calculators.zoneMax'), low: 0.9, high: 1.0 },
      ];
      return [
        { label: t('calculators.resultMaxHr'), value: t('calculators.valueBpm', { value: maxHR }) },
        ...zones.map(z => ({ label: z.z, value: t('calculators.valueRangeBpm', { low: Math.round(z.low * maxHR), high: Math.round(z.high * maxHR) }) })),
      ];
    },
  },
  {
    id: 'protein', label: t('calculators.labelProteinNeeds'), icon: 'nutrition', color: 'success',
    desc: t('calculators.proteinDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldBodyWeight'), placeholder: '80' },
      { key: 'goal', label: t('calculators.fieldGoalBuildMaintainCut'), placeholder: 'build' },
    ],
    compute: ({ weight, goal }) => {
      const g = goal?.toLowerCase() ?? 'maintain';
      const mult = g === 'build' ? 2.2 : g === 'cut' ? 2.5 : 1.8;
      const min = parseFloat(weight) * mult;
      const max = parseFloat(weight) * (mult + 0.3);
      return [
        { label: t('calculators.resultProteinTarget'), value: t('calculators.valueRangeGramsPerDay', { low: fmt(min, 0), high: fmt(max, 0) }) },
        { label: t('calculators.resultPerMeal'), value: t('calculators.valueGramsPerMeal', { value: fmt(min / 4, 0) }) },
      ];
    },
  },
  {
    id: 'hydration', label: t('calculators.labelHydration'), icon: 'water', color: '#22d3ee',
    desc: t('calculators.hydrationDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldBodyWeight'), placeholder: '80' },
      { key: 'activity', label: t('calculators.fieldActivityLowMedHigh'), placeholder: 'med' },
    ],
    compute: ({ weight, activity }) => {
      const act = activity?.toLowerCase() ?? 'med';
      const mult = act === 'high' ? 45 : act === 'low' ? 30 : 37;
      const ml = parseFloat(weight) * mult;
      return [
        { label: t('calculators.resultWaterTarget'), value: t('calculators.valueLitersPerDay', { value: fmt(ml / 1000, 2) }) },
        { label: t('calculators.resultInCups'), value: t('calculators.valueCups', { value: fmt(ml / 250, 0) }) },
      ];
    },
  },
  {
    id: 'deficit', label: t('calculators.labelDeficitPlanner'), icon: 'trending-down', color: 'warning', pro: true,
    desc: t('calculators.deficitDesc'),
    fields: [
      { key: 'current', label: t('calculators.fieldCurrentWeight'), placeholder: '90' },
      { key: 'goal', label: t('calculators.fieldGoalWeight'), placeholder: '80' },
      { key: 'deficit', label: t('calculators.fieldDailyDeficit'), placeholder: '500' },
    ],
    compute: ({ current, goal, deficit }) => {
      const kgToLose = parseFloat(current) - parseFloat(goal);
      const kcalPerKg = 7700;
      const totalKcal = kgToLose * kcalPerKg;
      const days = totalKcal / parseFloat(deficit);
      const weeks = days / 7;
      return [
        { label: t('calculators.resultWeightToLose'), value: t('calculators.valueKg', { value: fmt(kgToLose) }) },
        { label: t('calculators.resultEstimatedTime'), value: t('calculators.valueWeeksDays', { weeks: fmt(weeks, 0), days: fmt(days, 0) }) },
        { label: t('calculators.resultRateOfLoss'), value: t('calculators.valueKgPerWeek', { value: fmt(parseFloat(deficit) / kcalPerKg * 7, 2) }) },
      ];
    },
  },
  {
    id: 'waistHip', label: t('calculators.labelWaistHipRatio'), icon: 'body', color: '#e879f9', pro: true,
    desc: t('calculators.waistHipDesc'),
    fields: [
      { key: 'waist', label: t('calculators.fieldWaistCm'), placeholder: '85' },
      { key: 'hips', label: t('calculators.fieldHipsCm'), placeholder: '95' },
      { key: 'sex', label: t('calculators.fieldSex'), placeholder: 'M' },
    ],
    compute: ({ waist, hips, sex }) => {
      const ratio = parseFloat(waist) / parseFloat(hips);
      const isMale = sex?.toUpperCase() === 'M';
      const risk = isMale
        ? ratio < 0.9 ? t('calculators.riskLow') : ratio < 1.0 ? t('calculators.riskModerate') : t('calculators.riskHigh')
        : ratio < 0.8 ? t('calculators.riskLow') : ratio < 0.85 ? t('calculators.riskModerate') : t('calculators.riskHigh');
      return [
        { label: t('calculators.resultWhr'), value: fmt(ratio, 2) },
        { label: t('calculators.resultRisk'), value: risk },
      ];
    },
  },
  {
    id: 'volumeLoad', label: t('calculators.labelVolumeLoad'), icon: 'layers', color: 'accent', pro: true,
    desc: t('calculators.volumeLoadDesc'),
    fields: [
      { key: 'sets', label: t('calculators.fieldSets'), placeholder: '4' },
      { key: 'reps', label: t('calculators.fieldRepsPerSet'), placeholder: '8' },
      { key: 'weight', label: t('calculators.fieldWeightKg'), placeholder: '100' },
    ],
    compute: ({ sets, reps, weight }) => {
      const vol = parseInt(sets, 10) * parseInt(reps, 10) * parseFloat(weight);
      const e1rm = parseFloat(weight) * (1 + parseInt(reps, 10) / 30);
      return [
        { label: t('calculators.resultVolumeLoad'), value: t('calculators.valueKg', { value: fmt(vol, 0) }) },
        { label: t('calculators.resultEstimatedOneRmEpley'), value: t('calculators.valueKg', { value: fmt(e1rm) }) },
      ];
    },
  },
  {
    id: 'wilks', label: 'Wilks Score', icon: 'trophy', color: 'warning', pro: true,
    desc: t('calculators.wilksDesc'),
    fields: [
      { key: 'total', label: t('calculators.fieldPowerliftingTotal'), placeholder: '400' },
      { key: 'bw', label: t('calculators.fieldBodyWeight'), placeholder: '75' },
      { key: 'sex', label: t('calculators.fieldSex'), placeholder: 'M' },
    ],
    compute: ({ total, bw, sex }) => {
      const isMale = sex?.toUpperCase() === 'M';
      const b = parseFloat(bw);
      const coeffs = isMale
        ? [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-6, -1.291e-8]
        : [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-5, -9.054e-8];
      const denom = coeffs[0] + coeffs[1]*b + coeffs[2]*b**2 + coeffs[3]*b**3 + coeffs[4]*b**4 + coeffs[5]*b**5;
      const wilks = (500 / denom) * parseFloat(total);
      return [{ label: t('calculators.resultWilksScore'), value: fmt(wilks) }];
    },
  },
  {
    id: 'sleep', label: t('calculators.labelSleepCalculator'), icon: 'moon', color: 'purple', pro: true,
    desc: t('calculators.sleepDesc'),
    fields: [{ key: 'bedtime', label: t('calculators.fieldBedtime'), placeholder: '23:00' }],
    compute: ({ bedtime }) => {
      if (!bedtime?.includes(':')) return [{ label: t('calculators.resultError'), value: t('calculators.errorEnterTimeFormat') }];
      const [h, m] = bedtime.split(':').map(Number);
      const base = h * 60 + m + 14;
      const cycles = [3, 4, 5, 6];
      return cycles.map(c => {
        const total = base + c * 90;
        const wh = Math.floor(total / 60) % 24;
        const wm = total % 60;
        return { label: t('calculators.cyclesLabel', { cycles: c, hours: c * 1.5 }), value: t('calculators.wakeAt', { time: `${String(wh).padStart(2,'0')}:${String(wm).padStart(2,'0')}` }) };
      });
    },
  },
  {
    id: 'strengthLevel', label: t('calculators.labelStrengthLevel'), icon: 'barbell', color: 'blue', pro: true,
    desc: t('calculators.strengthLevelDesc'),
    fields: [
      { key: 'lift', label: t('calculators.fieldLiftType'), placeholder: 'bench' },
      { key: 'weight', label: t('calculators.fieldWeightLifted'), placeholder: '100' },
      { key: 'bw', label: t('calculators.fieldBodyWeight'), placeholder: '80' },
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
      let level = ratio < beg ? t('calculators.levelBeginner') : ratio < nov ? t('calculators.levelNovice') : ratio < int ? t('calculators.levelIntermediate') : ratio < adv ? t('calculators.levelAdvanced') : ratio < eli ? t('calculators.levelElite') : t('calculators.levelWorldClass');
      return [
        { label: t('calculators.resultRatioLiftBw'), value: fmt(ratio, 2) },
        { label: t('calculators.resultLevel'), value: level },
      ];
    },
  },
  {
    id: 'caloriesBurned', label: t('calculators.labelCaloriesBurned'), icon: 'flame', color: '#fb923c', pro: true,
    desc: t('calculators.caloriesBurnedDesc'),
    fields: [
      { key: 'weight', label: t('calculators.fieldBodyWeight'), placeholder: '80' },
      { key: 'duration', label: t('calculators.fieldDurationMinutes'), placeholder: '45' },
      { key: 'met', label: t('calculators.fieldMetValue'), placeholder: '5' },
    ],
    compute: ({ weight, duration, met }) => {
      const kcal = (parseFloat(met) * 3.5 * parseFloat(weight) / 200) * parseFloat(duration);
      return [{ label: t('calculators.resultCaloriesBurned'), value: t('calculators.valueKcal', { value: fmt(kcal, 0) }) }];
    },
  },
  {
    id: 'fitnessAge', label: 'Fitness Age', icon: 'heart-circle', color: '#34d399',
    desc: 'Estimates your biological fitness age from activity, sleep, and resting heart rate.',
    fields: [
      { key: 'age', label: 'Chronological Age (yrs)', placeholder: '30' },
      { key: 'stepsPerDay', label: 'Avg Daily Steps', placeholder: '8000' },
      { key: 'sleepHours', label: 'Avg Sleep (hours)', placeholder: '7.5' },
      { key: 'restingHR', label: 'Resting Heart Rate (bpm)', placeholder: '65' },
      { key: 'workoutsPerWeek', label: 'Workouts per Week', placeholder: '3' },
    ],
    compute: ({ age, stepsPerDay, sleepHours, restingHR, workoutsPerWeek }) => {
      const a = parseFloat(age), steps = parseFloat(stepsPerDay);
      const sleep = parseFloat(sleepHours), hr = parseFloat(restingHR), wk = parseFloat(workoutsPerWeek);
      if ([a, steps, sleep, hr, wk].some(v => isNaN(v))) return [{ label: 'Fill all fields', value: '' }];
      // Step score: 10k = baseline 0, each 1k above = -0.3, each 1k below = +0.5
      const stepAdj = steps >= 10000 ? -((steps - 10000) / 1000) * 0.3 : ((10000 - steps) / 1000) * 0.5;
      // Sleep score: 7-9h = 0, outside = penalty
      const sleepAdj = sleep >= 7 && sleep <= 9 ? 0 : sleep < 7 ? (7 - sleep) * 1.5 : (sleep - 9) * 0.5;
      // HR score: 60 = -1, 70 = 0, each 5bpm above 70 = +1.5
      const hrAdj = hr <= 60 ? -2 : hr <= 70 ? (hr - 60) * 0.2 - 2 : ((hr - 70) / 5) * 1.5;
      // Workouts: 4+ = -2, 3 = -1, 2 = 0, 1 = +1, 0 = +3
      const wkAdj = wk >= 4 ? -2 : wk >= 3 ? -1 : wk >= 2 ? 0 : wk >= 1 ? 1 : 3;
      const fitnessAge = Math.round(a + stepAdj + sleepAdj + hrAdj + wkAdj);
      const diff = fitnessAge - a;
      const status = diff <= -3 ? '🏆 Excellent — well below your age!'
        : diff <= 0 ? '✅ Good — at or below your age'
        : diff <= 3 ? '⚠️ Fair — slightly above your age'
        : '🔴 High — well above your age';
      return [
        { label: 'Fitness Age', value: `${Math.max(10, fitnessAge)} yrs` },
        { label: 'vs Actual Age', value: `${diff > 0 ? '+' : ''}${diff} yrs` },
        { label: 'Status', value: status },
      ];
    },
  },
  {
    id: 'plateCalc', label: t('calculators.labelPlateCalculator'), icon: 'barbell', color: 'accent',
    desc: t('calculators.plateCalcDesc'),
    fields: [
      { key: 'target', label: t('calculators.fieldTargetWeight'), placeholder: '100' },
      { key: 'bar', label: t('calculators.fieldBarWeight'), placeholder: '20' },
    ],
    compute: ({ target, bar }) => {
      let remaining = (parseFloat(target) - parseFloat(bar)) / 2;
      const plates = [25, 20, 15, 10, 5, 2.5, 1.25];
      const used = [];
      for (const p of plates) {
        const count = Math.floor(remaining / p);
        if (count > 0) { used.push({ plate: p, count }); remaining -= count * p; }
      }
      if (Math.abs(remaining) > 0.1) used.push({ plate: remaining, count: 1, note: t('calculators.nonStandard') });
      return used.map(u => ({ label: t('calculators.platesLabel', { plate: u.plate }), value: t('calculators.eachSideValue', { count: u.count, note: u.note ? ' ' + u.note : '' }) }));
    },
  },
];

// ─── screen ───────────────────────────────────────────────────────────────────
const CALC_GUIDE = {
  title: 'Calculators Guide',
  tagline: '🧮 20 science-backed tools — no guesswork needed.',
  sections: [
    { icon: 'body-outline',        heading: 'BMI',               tip: 'Body Mass Index — a quick weight-to-height ratio. Best used alongside body fat %.' },
    { icon: 'flame-outline',       heading: 'TDEE',              tip: 'Total Daily Energy Expenditure — your true calorie burn based on weight, age & activity.' },
    { icon: 'barbell-outline',     heading: '1RM Calculator',    tip: 'Estimate your one-rep max from any set. Useful for programming training percentages.' },
    { icon: 'pie-chart-outline',   heading: 'Macros',            tip: 'Split your calorie target into protein, carbs, and fat based on your goal.' },
    { icon: 'heart-outline',       heading: 'HR Zones',          tip: 'Heart rate training zones from your max HR — target fat burn, aerobic, or peak zones.' },
    { icon: 'trophy-outline',      heading: 'Wilks Score',       tip: 'Compare powerlifting strength across different body weights — the gold standard metric.' },
  ],
  footerTip: 'Tap any calculator title to expand it. All results update instantly as you type.',
};

export default function CalculatorsScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [openId, setOpenId] = useState(null);
  const [inputs, setInputs] = useState({});
  const [activityIdx, setActivityIdx] = useState(1);
  const [results, setResults] = useState({});
  const { hasAccess } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  const ACTIVITY = useMemo(() => ACTIVITY_KEYS.map(k => ({ label: t(`calculators.${k.full}`), shortLabel: t(`calculators.${k.short}`) })), [t]);
  const CALCULATORS = useMemo(() => buildCalculators(t, ACTIVITY), [t, ACTIVITY]);

  const handleCompute = (calc) => {
    try {
      const inp = inputs[calc.id] ?? {};
      const res = calc.compute({ ...inp, activity: activityIdx });
      setResults(prev => ({ ...prev, [calc.id]: res }));
    } catch (e) {
      setResults(prev => ({ ...prev, [calc.id]: [{ label: t('calculators.resultError'), value: e.message }] }));
    }
  };

  const setInput = (calcId, field, val) => {
    setInputs(prev => ({ ...prev, [calcId]: { ...(prev[calcId] ?? {}), [field]: val } }));
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title={t('calculators.screenTitle')}
        colors={colors}
        onBack={() => navigation.goBack()}
        info={CALC_GUIDE}
        right={<Text style={styles.count}>{CALCULATORS.length}</Text>}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {CALCULATORS.map((calc) => {
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
                      <Text style={styles.fieldLabel}>{t('calculators.activityLevel')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityRow}>
                        {ACTIVITY.map((a, i) => (
                          <TouchableOpacity key={i} style={[styles.actChip, activityIdx === i && styles.actChipActive]} onPress={() => setActivityIdx(i)}>
                            <Text style={[styles.actChipText, activityIdx === i && { color: colors.bg }]}>{a.shortLabel}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}

                  {/* Calculate button */}
                  <TouchableOpacity style={[styles.calcBtn, { backgroundColor: calcColor }]} onPress={() => handleCompute(calc)}>
                    <Text style={styles.calcBtnText}>{t('calculators.calculateButton')}</Text>
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
