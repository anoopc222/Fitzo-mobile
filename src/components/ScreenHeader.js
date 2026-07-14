import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ScrollView, Dimensions, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, weight, fontFamily } from '../theme/typography';
import { useTheme } from '../context/ThemeContext';

const { width: SW } = Dimensions.get('window');
const CARD_ACCENTS = ['#d4ff00', '#a78bfa', '#38bdf8', '#fb923c', '#34d399', '#f472b6', '#facc15'];

// info prop shape:
// { title: string, tagline: string, sections: [{ icon, heading, tip }], footerTip? }
function InfoSheet({ visible, onClose, info, colors }) {
  const [page, setPage] = useState(0);
  const scrollRef = useRef(null);
  if (!info) return null;

  const sections = info.sections ?? [];
  const accent = CARD_ACCENTS[page % CARD_ACCENTS.length];

  const onScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    setPage(idx);
  };

  const goTo = (i) => {
    scrollRef.current?.scrollTo({ x: i * SW, animated: true });
    setPage(i);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: 28, borderTopRightRadius: 28,
          paddingTop: 12, paddingBottom: 0,
          overflow: 'hidden',
        }}>
          {/* Drag handle */}
          <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />

          {/* Title row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginBottom: 4 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text, letterSpacing: -0.3 }}>
              {info.title}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Tagline */}
          {!!info.tagline && (
            <Text style={{ fontSize: 12.5, color: colors.textMuted, paddingHorizontal: 22, marginBottom: 20 }}>
              {info.tagline}
            </Text>
          )}

          {/* Carousel */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onScroll}
            decelerationRate="fast"
          >
            {sections.map((sec, i) => {
              const col = CARD_ACCENTS[i % CARD_ACCENTS.length];
              return (
                <View key={i} style={{ width: SW, paddingHorizontal: 22, paddingBottom: 8, alignItems: 'center' }}>
                  {/* Big icon */}
                  <View style={{
                    width: 88, height: 88, borderRadius: 28,
                    backgroundColor: col + '20',
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 22,
                    borderWidth: 1.5, borderColor: col + '40',
                  }}>
                    <Ionicons name={sec.icon} size={42} color={col} />
                  </View>

                  {/* Step pill */}
                  <View style={{ backgroundColor: col + '18', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 14 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: col, letterSpacing: 1 }}>
                      {String(i + 1).padStart(2, '0')} / {String(sections.length).padStart(2, '0')}
                    </Text>
                  </View>

                  {/* Heading */}
                  <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 12, letterSpacing: -0.4 }}>
                    {sec.heading}
                  </Text>

                  {/* Tip */}
                  <Text style={{ fontSize: 14.5, color: colors.textMuted, textAlign: 'center', lineHeight: 22, paddingHorizontal: 12 }}>
                    {sec.tip}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          {/* Dot nav */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 20, paddingBottom: 10 }}>
            {sections.map((_, i) => (
              <TouchableOpacity key={i} onPress={() => goTo(i)}>
                <View style={{
                  width: page === i ? 20 : 6, height: 6, borderRadius: 3,
                  backgroundColor: page === i ? accent : colors.border,
                }} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Prev / Next */}
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 22, paddingBottom: 4 }}>
            {page > 0 ? (
              <TouchableOpacity onPress={() => goTo(page - 1)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>← Back</Text>
              </TouchableOpacity>
            ) : <View style={{ flex: 1 }} />}
            {page < sections.length - 1 ? (
              <TouchableOpacity onPress={() => goTo(page + 1)}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: accent, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#000' }}>Next →</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={onClose}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 16, backgroundColor: accent, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#000' }}>Got it ✓</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Footer tip */}
          {!!info.footerTip && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 22, marginTop: 10, marginBottom: 6, backgroundColor: colors.card, borderRadius: 12, padding: 12 }}>
              <Ionicons name="bulb-outline" size={15} color={colors.accent} />
              <Text style={{ flex: 1, fontSize: 12, color: colors.textDim, lineHeight: 17 }}>{info.footerTip}</Text>
            </View>
          )}

          {/* Safe area spacer */}
          <SafeAreaView edges={['bottom']} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function ScreenHeader({ title, onBack, colors: colorsProp, right, info }) {
  const { isDark, setIsDark, colors: themeColors } = useTheme();
  const colors = colorsProp ?? themeColors;
  const styles = createStyles(colors);
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.logo}>Fitzo<Text style={styles.logoDot}>•</Text></Text>
        )}
        <Text style={styles.screenLabel}>{title}</Text>
        <View style={styles.headerRight}>
          {right}
          {info && (
            <TouchableOpacity onPress={() => setShowInfo(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setIsDark(!isDark)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name={isDark ? 'moon' : 'sunny'} size={18} color={isDark ? colors.accent : colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <InfoSheet visible={showInfo} onClose={() => setShowInfo(false)} info={info} colors={colors} />
    </>
  );
}

const createStyles = (colors) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  },
  backBtn: { padding: 2, minWidth: 24 },
  logo: { fontSize: typography.lg, fontFamily: fontFamily.displayItalic, fontStyle: 'italic', color: colors.text },
  logoDot: { color: colors.accent },
  screenLabel: { fontSize: typography.xs, fontWeight: weight.bold, letterSpacing: 2, color: colors.textMuted },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 24, justifyContent: 'flex-end' },
});
