import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, weight, fontFamily } from '../theme/typography';
import { useTheme } from '../context/ThemeContext';

// Accent colors cycled across section cards
const CARD_ACCENTS = ['#d4ff00', '#a78bfa', '#38bdf8', '#fb923c', '#34d399', '#f472b6', '#facc15'];

// info prop shape:
// { title: string, tagline: string, sections: [{ icon: string, heading: string, tip: string }], footerTip?: string }
function InfoModal({ visible, onClose, info, colors }) {
  if (!info) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>

        {/* Top bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, letterSpacing: -0.3 }}>
            {info.title}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Tagline pill */}
        {!!info.tagline && (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <View style={{ backgroundColor: colors.accent + '18', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.accent + '33' }}>
              <Text style={{ fontSize: 13, color: colors.accent, fontWeight: '700', lineHeight: 19 }}>
                {info.tagline}
              </Text>
            </View>
          </View>
        )}

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* 2-column grid of feature cards */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {(info.sections ?? []).map((sec, i) => {
              const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];
              return (
                <View key={i} style={{
                  width: '47.5%', backgroundColor: colors.card,
                  borderRadius: 16, padding: 14,
                  borderWidth: 1, borderColor: colors.border,
                }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: accent + '22', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                    <Ionicons name={sec.icon} size={20} color={accent} />
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 4, lineHeight: 17 }}>
                    {sec.heading}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>
                    {sec.tip}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Footer tip */}
          {!!info.footerTip && (
            <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border }}>
              <Ionicons name="bulb-outline" size={18} color={colors.accent} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.textMuted, lineHeight: 18 }}>
                {info.footerTip}
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
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

      <InfoModal visible={showInfo} onClose={() => setShowInfo(false)} info={info} colors={colors} />
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
