import React, { useEffect, useState, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useOnboarding } from '../context/OnboardingContext';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';

const PADDING = 8;

export default function Spotlight() {
  const { tour, next, skip } = useOnboarding();
  const { colors } = useTheme();
  const [box, setBox] = useState(null);

  const step = tour?.steps?.[tour.index];

  const measure = useCallback(() => {
    const node = step?.ref?.current;
    if (!node?.measureInWindow) { setBox(null); return; }
    node.measureInWindow((x, y, width, height) => {
      setBox({ x, y, width, height });
    });
  }, [step]);

  useEffect(() => {
    if (!step) { setBox(null); return; }
    const timer = setTimeout(measure, 50);
    return () => clearTimeout(timer);
  }, [step, measure]);

  if (!tour || !step || !box) return null;

  const { height: screenH, width: screenW } = Dimensions.get('window');
  const highlight = {
    left: box.x - PADDING,
    top: box.y - PADDING,
    width: box.width + PADDING * 2,
    height: box.height + PADDING * 2,
  };
  const showBelow = box.y < screenH / 2;
  const cardStyle = showBelow
    ? { top: Math.min(highlight.top + highlight.height + 16, screenH - 220) }
    : { top: Math.max(highlight.top - 16, 60), transform: [{ translateY: '-100%' }] };

  const isLast = tour.index + 1 >= tour.steps.length;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View
          style={[
            styles.highlight,
            highlight,
            { borderColor: colors.accent ?? '#d4ff00' },
          ]}
          pointerEvents="none"
        />
        <View style={[styles.card, { backgroundColor: colors.card ?? '#15151c', left: 20, right: 20 }, cardStyle]}>
          <Text style={[styles.progress, { color: colors.textSecondary ?? '#888' }]}>
            {tour.index + 1} / {tour.steps.length}
          </Text>
          <Text style={[styles.title, { color: colors.text ?? '#fff' }]}>{step.title}</Text>
          <Text style={[styles.description, { color: colors.textSecondary ?? '#aaa' }]}>{step.description}</Text>
          <View style={styles.actions}>
            <TouchableOpacity onPress={skip} style={styles.skipBtn}>
              <Text style={[styles.skipText, { color: colors.textSecondary ?? '#888' }]}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={next} style={[styles.nextBtn, { backgroundColor: colors.accent ?? '#d4ff00' }]}>
              <Text style={styles.nextText}>{isLast ? 'Done' : 'Next'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: 12,
  },
  card: {
    position: 'absolute',
    borderRadius: 16,
    padding: 18,
  },
  progress: {
    fontSize: typography.xs,
    fontWeight: weight.semibold,
    marginBottom: 4,
  },
  title: {
    fontSize: typography.md,
    fontWeight: weight.bold,
    marginBottom: 6,
  },
  description: {
    fontSize: typography.sm,
    fontWeight: weight.normal,
    lineHeight: 19,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  skipText: {
    fontSize: typography.sm,
    fontWeight: weight.medium,
  },
  nextBtn: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 10,
  },
  nextText: {
    fontSize: typography.sm,
    fontWeight: weight.bold,
    color: '#0c0c0f',
  },
});
