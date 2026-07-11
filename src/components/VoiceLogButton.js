import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, Animated,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

// expo-speech-recognition must be installed via:
// npx expo install expo-speech-recognition
// It only works in EAS/standalone builds (not Expo Go).
let ExpoSpeechRecognitionModule = null;
let useSpeechRecognitionEvent = null;
try {
  const mod = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = mod.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = mod.useSpeechRecognitionEvent;
} catch (_) {}

// ─── Parser ──────────────────────────────────────────────────────────────────
// Parses voice transcript into a structured log action.
// Returns null if the transcript doesn't match any known pattern.

const NUM_WORDS = {
  zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
  eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
  eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,
  seventy:70,eighty:80,ninety:90,hundred:100,
};

function parseNumber(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/,/g, ''));
  if (!isNaN(n)) return n;
  const words = str.toLowerCase().split(/\s+/);
  let total = 0, current = 0;
  for (const w of words) {
    if (NUM_WORDS[w] !== undefined) {
      if (NUM_WORDS[w] === 100) { current = (current || 1) * 100; }
      else { current += NUM_WORDS[w]; }
    } else if (w === 'and') {
      // skip
    } else {
      if (current) { total += current; current = 0; }
    }
  }
  return total + current || null;
}

export function parseVoiceTranscript(text) {
  const t = (text || '').toLowerCase().trim();

  // ── Workout set: "bench press 100 kg 5 reps" / "log 3 sets of 8 reps squat 80" ──
  const setMatch =
    t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|lbs?|pounds?)?\s+(\d+)\s*(?:reps?|repetitions?)\s+(?:of\s+)?(.+)/) ||
    t.match(/(.+?)\s+(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|lbs?|pounds?)\s+(\d+)\s*(?:reps?|repetitions?)/) ||
    t.match(/log\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:kg|lbs?)?\s+(?:for\s+)?(\d+)\s*(?:reps?)/);

  if (setMatch) {
    // Try all capture-group orderings
    const tryExercise = (ex, wt, rp) => ex && wt && rp
      ? { type: 'workout_set', exercise: ex.trim().replace(/^(log|do|did|add)\s+/i,''), weight: parseFloat(wt), reps: parseInt(rp) }
      : null;
    const r =
      tryExercise(setMatch[3], setMatch[1], setMatch[2]) ||
      tryExercise(setMatch[1], setMatch[2], setMatch[3]);
    if (r) return r;
  }

  // ── Weight log: "my weight is 75 kg" / "log weight 80.5" ──
  const weightMatch = t.match(/(?:log\s+)?(?:my\s+)?weight(?:\s+is)?\s+(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|lbs?|pounds?)?/);
  if (weightMatch) {
    return { type: 'weight', value: parseFloat(weightMatch[1]) };
  }

  // ── Steps: "log 8000 steps" / "i walked 10000 steps" ──
  const stepsMatch = t.match(/(?:log\s+|walked?\s+|ran?\s+)?(\d[\d,]*)\s*steps?/);
  if (stepsMatch) {
    return { type: 'steps', value: parseInt(stepsMatch[1].replace(/,/g, '')) };
  }

  // ── Sleep: "log 7.5 hours sleep" / "i slept 8 hours" ──
  const sleepMatch = t.match(/(?:log\s+|slept?\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:of\s+)?(?:sleep)?/);
  if (sleepMatch && parseFloat(sleepMatch[1]) <= 24) {
    return { type: 'sleep', hours: parseFloat(sleepMatch[1]) };
  }

  // ── Food: "log 200 calories chicken" / "i ate 500 calories of pizza" ──
  const foodCalMatch = t.match(/(?:log\s+|ate?\s+|eaten?\s+)?(\d+)\s*(?:cal(?:ories?)?|kcal)\s*(?:of\s+)?(.+)?/);
  if (foodCalMatch) {
    return {
      type: 'food',
      calories: parseInt(foodCalMatch[1]),
      food_name: (foodCalMatch[2] || 'Food entry').trim(),
    };
  }

  // ── Food by name: "log chicken breast 200 grams 165 calories" ──
  const foodNameMatch = t.match(/(?:log\s+)(.+?)\s+(\d+)\s*(?:grams?|g)\s+(\d+)\s*(?:cal(?:ories?)?|kcal)/);
  if (foodNameMatch) {
    return {
      type: 'food',
      food_name: foodNameMatch[1].trim(),
      serving: parseInt(foodNameMatch[2]),
      calories: parseInt(foodNameMatch[3]),
    };
  }

  return null;
}

// ─── VoiceLogButton ───────────────────────────────────────────────────────────
// Props:
//   onAction(parsed) — called with the parsed action object when transcript is confirmed
//   size — 'sm' | 'md' (default 'md')
//   style — additional style for the trigger button

export default function VoiceLogButton({ onAction, size = 'md', style }) {
  const { colors } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef(null);

  const startPulse = useCallback(() => {
    pulseRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseRef.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseRef.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  // Wire up speech recognition events when available
  if (useSpeechRecognitionEvent) {
    useSpeechRecognitionEvent('result', (e) => {
      const best = e.results?.[0]?.transcript ?? '';
      setTranscript(best);
      setParsed(parseVoiceTranscript(best));
    });
    useSpeechRecognitionEvent('end', () => {
      setListening(false);
      stopPulse();
    });
    useSpeechRecognitionEvent('error', (e) => {
      setError(e.message || 'Recognition failed');
      setListening(false);
      stopPulse();
    });
  }

  const startListening = async () => {
    setTranscript('');
    setParsed(null);
    setError(null);

    if (!ExpoSpeechRecognitionModule) {
      setError('Speech recognition not available.\nInstall expo-speech-recognition via EAS build.');
      return;
    }

    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      setError('Microphone permission denied.');
      return;
    }

    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: false,
    });
    setListening(true);
    startPulse();
  };

  const stopListening = () => {
    ExpoSpeechRecognitionModule?.stop();
    setListening(false);
    stopPulse();
  };

  const handleConfirm = () => {
    if (!parsed) return;
    onAction?.(parsed);
    setModalVisible(false);
    setTranscript('');
    setParsed(null);
  };

  const handleClose = () => {
    if (listening) stopListening();
    setModalVisible(false);
    setTranscript('');
    setParsed(null);
    setError(null);
  };

  const iconSize = size === 'sm' ? 18 : 24;
  const btnSize = size === 'sm' ? 36 : 48;

  return (
    <>
      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        style={[{
          width: btnSize, height: btnSize, borderRadius: btnSize / 2,
          backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
          alignItems: 'center', justifyContent: 'center',
        }, style]}
        activeOpacity={0.75}
      >
        <Ionicons name="mic-outline" size={iconSize} color={colors.accent} />
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={s.overlay}>
          <View style={[s.sheet, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>

            {/* Header */}
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: colors.text }]}>Voice Log</Text>
              <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[s.hint, { color: colors.textDim }]}>
              Say something like:{'\n'}
              <Text style={{ color: colors.accent }}>"Bench press 100kg 5 reps"</Text>
              {'\n'}"Log 8000 steps" · "Log weight 75" · "I slept 7.5 hours"
            </Text>

            {/* Mic button */}
            <View style={s.micWrap}>
              <Animated.View style={[s.micRing, { borderColor: listening ? colors.accent : colors.border, transform: [{ scale: pulseAnim }] }]}>
                <TouchableOpacity
                  onPress={listening ? stopListening : startListening}
                  style={[s.micBtn, { backgroundColor: listening ? colors.accent : colors.bgElevated }]}
                  activeOpacity={0.8}
                >
                  <Ionicons name={listening ? 'stop' : 'mic'} size={32} color={listening ? colors.bg : colors.accent} />
                </TouchableOpacity>
              </Animated.View>
              <Text style={[s.micLabel, { color: colors.textMuted }]}>
                {listening ? 'Listening… tap to stop' : 'Tap to speak'}
              </Text>
            </View>

            {/* Transcript */}
            {transcript ? (
              <View style={[s.transcriptBox, { backgroundColor: colors.bgElevated, borderColor: colors.border }]}>
                <Text style={[s.transcriptText, { color: colors.text }]}>"{transcript}"</Text>
              </View>
            ) : null}

            {/* Parsed result */}
            {parsed && <ParsedCard parsed={parsed} colors={colors} />}

            {/* Error */}
            {error ? (
              <Text style={[s.errorText, { color: '#ef4444' }]}>{error}</Text>
            ) : null}

            {/* Actions */}
            <View style={s.actions}>
              {parsed && (
                <TouchableOpacity
                  style={[s.confirmBtn, { backgroundColor: colors.accent }]}
                  onPress={handleConfirm}
                >
                  <Text style={[s.confirmBtnText, { color: colors.bg }]}>Log This</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[s.retryBtn, { borderColor: colors.border }]}
                onPress={startListening}
                disabled={listening}
              >
                <Ionicons name="refresh" size={16} color={colors.textMuted} />
                <Text style={[s.retryBtnText, { color: colors.textMuted }]}>Try Again</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>
      </Modal>
    </>
  );
}

function ParsedCard({ parsed, colors }) {
  const typeLabel = {
    workout_set: '🏋️ Workout Set',
    weight: '⚖️ Weight Log',
    steps: '👟 Steps',
    sleep: '😴 Sleep',
    food: '🥗 Food',
  }[parsed.type] ?? 'Entry';

  const details = [];
  if (parsed.type === 'workout_set') {
    details.push(`Exercise: ${parsed.exercise}`);
    details.push(`Weight: ${parsed.weight} kg`);
    details.push(`Reps: ${parsed.reps}`);
  } else if (parsed.type === 'weight') {
    details.push(`Weight: ${parsed.value} kg`);
  } else if (parsed.type === 'steps') {
    details.push(`Steps: ${parsed.value.toLocaleString()}`);
  } else if (parsed.type === 'sleep') {
    details.push(`Hours: ${parsed.hours}`);
  } else if (parsed.type === 'food') {
    details.push(`Food: ${parsed.food_name}`);
    details.push(`Calories: ${parsed.calories} kcal`);
    if (parsed.serving) details.push(`Serving: ${parsed.serving}g`);
  }

  return (
    <View style={[s.parsedCard, { backgroundColor: colors.bgElevated, borderColor: colors.accent + '44' }]}>
      <Text style={[s.parsedType, { color: colors.accent }]}>{typeLabel}</Text>
      {details.map((d, i) => (
        <Text key={i} style={[s.parsedDetail, { color: colors.text }]}>{d}</Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderBottomWidth: 0,
    padding: 20, paddingBottom: 36,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  hint: { fontSize: 12, lineHeight: 20, marginBottom: 20 },
  micWrap: { alignItems: 'center', marginBottom: 20 },
  micRing: { width: 90, height: 90, borderRadius: 45, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  micBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  micLabel: { fontSize: 12, fontWeight: '600' },
  transcriptBox: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 12 },
  transcriptText: { fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  parsedCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 16, gap: 4 },
  parsedType: { fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  parsedDetail: { fontSize: 14, fontWeight: '500' },
  errorText: { fontSize: 12, textAlign: 'center', marginBottom: 12, lineHeight: 18 },
  actions: { gap: 10 },
  confirmBtn: { borderRadius: 14, padding: 14, alignItems: 'center' },
  confirmBtnText: { fontWeight: '800', fontSize: 15 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, borderWidth: 1, padding: 12 },
  retryBtnText: { fontSize: 13, fontWeight: '600' },
});
