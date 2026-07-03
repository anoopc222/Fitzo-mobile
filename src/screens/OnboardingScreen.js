import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../lib/supabase';

const GOALS = [
  { key: 'lose_weight', label: '🏋️ Lose weight' },
  { key: 'build_muscle', label: '💪 Build muscle' },
  { key: 'get_healthier', label: '🧘 Get healthier' },
  { key: 'improve_fitness', label: '🏃 Improve fitness' },
];

const SEX_OPTIONS = ['Male', 'Female', 'Other'];

export default function OnboardingScreen({ onComplete }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1
  const [goal, setGoal] = useState(null);

  // Step 2
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [sex, setSex] = useState(null);

  // Step 3
  const [stepGoal, setStepGoal] = useState('10000');
  const [sleepGoal, setSleepGoal] = useState('8');
  const [calorieTarget, setCalorieTarget] = useState('2000');

  async function handleFinish() {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      await supabase.from('profiles').upsert({
        id: user.id,
        goal,
        height_cm: height ? parseFloat(height) : null,
        sex,
        weight_goal_kg: weight ? parseFloat(weight) : null,
        step_goal: stepGoal ? parseInt(stepGoal, 10) : 10000,
        sleep_goal_hours: sleepGoal ? parseFloat(sleepGoal) : 8,
        calorie_target: calorieTarget ? parseInt(calorieTarget, 10) : 2000,
      });

      if (weight) {
        await supabase.from('weight_logs').insert({
          user_id: user.id,
          weight: parseFloat(weight),
          logged_at: new Date().toISOString(),
        });
      }

      await AsyncStorage.setItem('fitzo:onboarded', 'true');
      onComplete();
    } catch (err) {
      console.error('Onboarding save error:', err);
      setSaving(false);
    }
  }

  function renderDots() {
    return (
      <View style={s.dotsRow}>
        {[1, 2, 3].map(n => (
          <View
            key={n}
            style={[s.dot, n === step && s.dotActive]}
          />
        ))}
      </View>
    );
  }

  function renderStep1() {
    return (
      <View style={s.stepContainer}>
        <Text style={s.title}>What's your main goal?</Text>
        <Text style={s.subtitle}>Pick the one that matters most right now.</Text>
        <View style={s.optionsGrid}>
          {GOALS.map(g => (
            <TouchableOpacity
              key={g.key}
              style={[s.goalCard, goal === g.key && s.goalCardActive]}
              onPress={() => setGoal(g.key)}
              activeOpacity={0.7}
            >
              <Text style={[s.goalLabel, goal === g.key && s.goalLabelActive]}>
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function renderStep2() {
    return (
      <View style={s.stepContainer}>
        <Text style={s.title}>Tell us about yourself</Text>
        <Text style={s.subtitle}>Helps us personalise your experience.</Text>

        <Text style={s.fieldLabel}>Weight (kg)</Text>
        <TextInput
          style={s.input}
          keyboardType="numeric"
          placeholder="e.g. 75"
          placeholderTextColor={colors.textDim}
          value={weight}
          onChangeText={setWeight}
          returnKeyType="next"
        />

        <Text style={s.fieldLabel}>Height (cm)</Text>
        <TextInput
          style={s.input}
          keyboardType="numeric"
          placeholder="e.g. 175"
          placeholderTextColor={colors.textDim}
          value={height}
          onChangeText={setHeight}
          returnKeyType="done"
        />

        <Text style={s.fieldLabel}>Sex</Text>
        <View style={s.chipsRow}>
          {SEX_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[s.chip, sex === opt && s.chipActive]}
              onPress={() => setSex(opt)}
              activeOpacity={0.7}
            >
              <Text style={[s.chipLabel, sex === opt && s.chipLabelActive]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function renderStep3() {
    return (
      <View style={s.stepContainer}>
        <Text style={s.title}>Set your daily targets</Text>
        <Text style={s.subtitle}>You can change these anytime in Settings.</Text>

        <Text style={s.fieldLabel}>Daily step goal</Text>
        <TextInput
          style={s.input}
          keyboardType="numeric"
          placeholder="10000"
          placeholderTextColor={colors.textDim}
          value={stepGoal}
          onChangeText={setStepGoal}
        />

        <Text style={s.fieldLabel}>Sleep goal (hours)</Text>
        <TextInput
          style={s.input}
          keyboardType="numeric"
          placeholder="8"
          placeholderTextColor={colors.textDim}
          value={sleepGoal}
          onChangeText={setSleepGoal}
        />

        <Text style={s.fieldLabel}>Daily calorie target</Text>
        <TextInput
          style={s.input}
          keyboardType="numeric"
          placeholder="2000"
          placeholderTextColor={colors.textDim}
          value={calorieTarget}
          onChangeText={setCalorieTarget}
        />
      </View>
    );
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderDots()}

          <View style={s.card}>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
          </View>

          <View style={s.navRow}>
            {step > 1 ? (
              <TouchableOpacity style={s.backBtn} onPress={() => setStep(s => s - 1)}>
                <Text style={[s.backBtnText, { color: colors.textMuted }]}>← Back</Text>
              </TouchableOpacity>
            ) : (
              <View style={s.backBtn} />
            )}

            {step < 3 ? (
              <TouchableOpacity
                style={[s.nextBtn, { backgroundColor: colors.accent }]}
                onPress={() => setStep(s => s + 1)}
                activeOpacity={0.8}
              >
                <Text style={[s.nextBtnText, { color: colors.accentText }]}>Next →</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.nextBtn, { backgroundColor: colors.accent, opacity: saving ? 0.6 : 1 }]}
                onPress={handleFinish}
                disabled={saving}
                activeOpacity={0.8}
              >
                <Text style={[s.nextBtnText, { color: colors.accentText }]}>
                  {saving ? 'Saving…' : 'Finish 🎉'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(colors) {
  return StyleSheet.create({
    safe: { flex: 1 },
    flex: { flex: 1 },
    scroll: {
      flexGrow: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 40,
    },
    dotsRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      marginBottom: 28,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.border,
    },
    dotActive: {
      width: 24,
      backgroundColor: colors.accent,
    },
    card: {
      backgroundColor: colors.bgCard || colors.card,
      borderRadius: 20,
      padding: 24,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 28,
    },
    stepContainer: {},
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textMuted,
      marginBottom: 24,
    },
    optionsGrid: {
      gap: 12,
    },
    goalCard: {
      paddingVertical: 16,
      paddingHorizontal: 20,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    goalCardActive: {
      borderColor: colors.accent,
      backgroundColor: `${colors.accent}18`,
    },
    goalLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textMuted,
    },
    goalLabelActive: {
      color: colors.accent,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 8,
      marginTop: 16,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    input: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
    },
    chipsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    chip: {
      flex: 1,
      paddingVertical: 12,
      alignItems: 'center',
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.bg,
    },
    chipActive: {
      borderColor: colors.accent,
      backgroundColor: `${colors.accent}18`,
    },
    chipLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textMuted,
    },
    chipLabelActive: {
      color: colors.accent,
    },
    navRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    backBtn: {
      padding: 12,
      minWidth: 80,
    },
    backBtnText: {
      fontSize: 16,
      fontWeight: '600',
    },
    nextBtn: {
      paddingVertical: 14,
      paddingHorizontal: 28,
      borderRadius: 14,
      minWidth: 120,
      alignItems: 'center',
    },
    nextBtnText: {
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
