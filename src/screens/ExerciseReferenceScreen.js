import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, Image, Modal,
  TouchableOpacity, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';
import { EXERCISE_IMAGES, getExerciseImageUrl } from '../lib/exerciseImages';
import ScreenHeader from '../components/ScreenHeader';

const ALL_EXERCISES = Object.keys(EXERCISE_IMAGES)
  .map(key => ({
    key,
    name: key.replace(/\b\w/g, c => c.toUpperCase()),
    imageUrl: EXERCISE_IMAGES[key],
  }))
  .sort((a, b) => a.key.localeCompare(b.key));

function ExerciseCard({ item, onPress }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
      onPress={() => onPress(item)}
      activeOpacity={0.75}
    >
      <Image
        source={{ uri: item.imageUrl }}
        style={[styles.thumb, { backgroundColor: colors.bg }]}
        resizeMode="contain"
      />
      <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={2}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );
}

function ExerciseModal({ item, onClose, colors }) {
  if (!item) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.modalBackdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <View style={[styles.modalCard, { backgroundColor: colors.bgCard }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>{item.name}</Text>
          <Image
            source={{ uri: item.imageUrl }}
            style={[styles.modalImage, { backgroundColor: colors.bg }]}
            resizeMode="contain"
          />
          <Text style={[styles.modalCredit, { color: colors.textDim }]}>
            Image: wger.de (CC BY 4.0)
          </Text>
          <TouchableOpacity
            onPress={onClose}
            style={[styles.modalClose, { backgroundColor: colors.accent }]}
          >
            <Text style={{ color: '#000', fontWeight: weight.bold, fontSize: 13 }}>Close</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

export default function ExerciseReferenceScreen({ navigation }) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_EXERCISES;
    return ALL_EXERCISES.filter(e => e.key.includes(q));
  }, [query]);

  // Build rows: each row is either a letter header or a pair of exercise items
  const rows = useMemo(() => {
    const result = [];
    let lastLetter = null;
    let pair = [];
    const flush = () => { if (pair.length) { result.push({ type: 'pair', items: pair, key: `pair-${pair[0].key}` }); pair = []; } };
    for (const item of filtered) {
      const letter = item.key[0].toUpperCase();
      if (letter !== lastLetter) {
        flush();
        result.push({ type: 'header', letter, key: `header-${letter}` });
        lastLetter = letter;
      }
      pair.push(item);
      if (pair.length === 2) flush();
    }
    flush();
    return result;
  }, [filtered]);

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <Text style={[styles.sectionHeader, { color: colors.textDim, borderBottomColor: colors.border }]}>
          {item.letter}
        </Text>
      );
    }
    return (
      <View style={styles.columnWrapper}>
        {item.items.map(ex => <ExerciseCard key={ex.key} item={ex} onPress={setSelected} />)}
        {item.items.length === 1 && <View style={{ flex: 1 }} />}
      </View>
    );
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="Exercise Reference" onBack={() => navigation.goBack()} />

      {/* Search */}
      <View style={[styles.searchRow, { backgroundColor: colors.bgCard, borderBottomColor: colors.border }]}>
        <Ionicons name="search" size={16} color={colors.textDim} style={{ marginRight: 8 }} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search exercises…"
          placeholderTextColor={colors.textDim}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={16} color={colors.textDim} />
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.countLabel, { color: colors.textDim }]}>
        {filtered.length} exercise{filtered.length !== 1 ? 's' : ''}
      </Text>

      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
        style={{ flex: 1 }}
      />

      <ExerciseModal item={selected} onClose={() => setSelected(null)} colors={colors} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontSize: typography.sm },
  countLabel: {
    fontSize: 11, fontWeight: weight.medium,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  sectionHeader: {
    width: '100%', fontSize: 13, fontWeight: weight.bold,
    paddingHorizontal: 4, paddingVertical: 6,
    borderBottomWidth: 1, marginBottom: 6,
    letterSpacing: 0.5,
  },
  columnWrapper: { gap: 10, marginBottom: 10 },
  card: {
    flex: 1, borderRadius: 12, borderWidth: 1,
    overflow: 'hidden', alignItems: 'center', paddingBottom: 10,
  },
  thumb: { width: '100%', height: 110, borderRadius: 10 },
  cardName: {
    fontSize: 12, fontWeight: weight.medium,
    textAlign: 'center', marginTop: 6, paddingHorizontal: 6,
  },
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center', justifyContent: 'center',
  },
  modalCard: {
    borderRadius: 16, padding: 16, width: 300, alignItems: 'center',
  },
  modalTitle: {
    fontWeight: weight.bold, fontSize: 15,
    marginBottom: 12, textAlign: 'center',
  },
  modalImage: { width: 268, height: 210, borderRadius: 10 },
  modalCredit: { fontSize: 10, marginTop: 8 },
  modalClose: {
    marginTop: 12, paddingVertical: 8, paddingHorizontal: 24, borderRadius: 8,
  },
});
