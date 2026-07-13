import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, Image, Modal,
  TouchableOpacity, StyleSheet, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import { EXERCISE_IMAGES } from '../lib/exerciseImages';
import ScreenHeader from '../components/ScreenHeader';

const { width: SCREEN_W } = Dimensions.get('window');
const COLS = 3;
const GAP = 10;
const H_PAD = 14;
const CARD_W = (SCREEN_W - H_PAD * 2 - GAP * (COLS - 1)) / COLS;

const ALL_EXERCISES = Object.keys(EXERCISE_IMAGES)
  .map(key => ({
    key,
    name: key.replace(/\b\w/g, c => c.toUpperCase()),
    imageUrl: EXERCISE_IMAGES[key],
  }))
  .sort((a, b) => a.key.localeCompare(b.key));

function ExerciseModal({ item, onClose, colors, t }) {
  if (!item) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={[styles.modalCard, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>{item.name}</Text>
          <Image
            source={{ uri: item.imageUrl }}
            style={[styles.modalImage, { backgroundColor: colors.bg }]}
            resizeMode="contain"
          />
          <Text style={[styles.modalCredit, { color: colors.textDim }]}>
            {t('exerciseRef.imageCredit')}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.modalClose, { backgroundColor: colors.accent }]}
          >
            <Text style={{ color: '#000', fontWeight: weight.bold, fontSize: 13 }}>{t('exerciseRef.close')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function ExerciseReferenceScreen({ navigation }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_EXERCISES;
    return ALL_EXERCISES.filter(e => e.key.includes(q));
  }, [query]);

  // Build rows: letter header | triple of cards
  const rows = useMemo(() => {
    const result = [];
    let lastLetter = null;
    let group = [];
    const flush = () => {
      if (!group.length) return;
      result.push({ type: 'row', items: group, key: `row-${group[0].key}` });
      group = [];
    };
    for (const item of filtered) {
      const letter = item.key[0].toUpperCase();
      if (letter !== lastLetter) {
        flush();
        result.push({ type: 'header', letter, key: `hdr-${letter}` });
        lastLetter = letter;
      }
      group.push(item);
      if (group.length === COLS) flush();
    }
    flush();
    return result;
  }, [filtered]);

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <Text style={[styles.sectionHeader, { color: colors.accent, borderBottomColor: colors.border }]}>
          {item.letter}
        </Text>
      );
    }
    return (
      <View style={styles.row}>
        {item.items.map(ex => (
          <TouchableOpacity
            key={ex.key}
            style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border, width: CARD_W }]}
            onPress={() => setSelected(ex)}
            activeOpacity={0.75}
          >
            <Image
              source={{ uri: ex.imageUrl }}
              style={[styles.thumb, { backgroundColor: colors.bg, width: CARD_W }]}
              resizeMode="contain"
            />
            <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={2}>
              {ex.name}
            </Text>
          </TouchableOpacity>
        ))}
        {/* Fill empty slots so last row aligns left */}
        {item.items.length < COLS && Array.from({ length: COLS - item.items.length }).map((_, i) => (
          <View key={`empty-${i}`} style={{ width: CARD_W }} />
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={t('exerciseRef.title')} onBack={() => navigation.goBack()} />

      {/* Search — matches ProgressScreen style */}
      <View style={[styles.searchWrap, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        <Ionicons name="search" size={16} color={colors.textDim} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={t('exerciseRef.searchPlaceholder')}
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={16} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.countLabel, { color: colors.textDim }]}>
        {t('exerciseRef.exerciseCount', { count: filtered.length })}
      </Text>

      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: H_PAD, paddingBottom: 40 }}
        style={{ flex: 1 }}
      />

      <ExerciseModal item={selected} onClose={() => setSelected(null)} colors={colors} t={t} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 14, marginTop: 10, marginBottom: 4,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: typography.sm },

  countLabel: {
    fontSize: 11, fontWeight: weight.medium,
    paddingHorizontal: 16, paddingVertical: 5,
  },

  sectionHeader: {
    width: '100%',
    fontSize: 12, fontWeight: weight.black,
    paddingHorizontal: 2, paddingTop: 14, paddingBottom: 6,
    borderBottomWidth: 1,
    letterSpacing: 1.2,
    marginBottom: 8,
  },

  row: {
    flexDirection: 'row',
    gap: GAP,
    marginBottom: GAP,
  },

  card: {
    borderRadius: 12, borderWidth: 1,
    overflow: 'hidden', alignItems: 'center',
    paddingBottom: 8,
  },
  thumb: { height: 90 },
  cardName: {
    fontSize: 11, fontWeight: weight.medium,
    textAlign: 'center', marginTop: 6,
    paddingHorizontal: 5, lineHeight: 15,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCard: {
    borderRadius: 18, padding: 18, width: 300, alignItems: 'center',
    borderWidth: 1,
  },
  modalTitle: {
    fontWeight: weight.bold, fontSize: 15,
    marginBottom: 12, textAlign: 'center',
  },
  modalImage: { width: 264, height: 210, borderRadius: 10 },
  modalCredit: { fontSize: 10, marginTop: 8 },
  modalClose: {
    marginTop: 14, paddingVertical: 9, paddingHorizontal: 28, borderRadius: 9,
  },
});
