import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, weight, fontFamily } from '../theme/typography';
import { useTheme } from '../context/ThemeContext';

// info prop shape:
// { title: string, intro: string, sections: [{ icon: string, heading: string, body: string }] }
function InfoModal({ visible, onClose, info, colors }) {
  if (!info) return null;
  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 20, paddingVertical: 14,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="information-circle" size={20} color={colors.accent} />
            </View>
            <Text style={{ fontSize: 16, fontFamily: fontFamily.bodyBold, color: colors.text, fontWeight: '700' }}>
              {info.title}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* Intro */}
          {!!info.intro && (
            <View style={{
              backgroundColor: colors.accent + '14', borderRadius: 14, padding: 16, marginBottom: 24,
              borderLeftWidth: 3, borderLeftColor: colors.accent,
            }}>
              <Text style={{ fontSize: 14, color: colors.text, lineHeight: 21, fontFamily: fontFamily.body }}>
                {info.intro}
              </Text>
            </View>
          )}

          {/* Sections */}
          {(info.sections ?? []).map((sec, i) => (
            <View key={i} style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}>
                  <Ionicons name={sec.icon} size={18} color={colors.accent} />
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, fontFamily: fontFamily.bodyBold, flex: 1 }}>
                  {sec.heading}
                </Text>
              </View>
              <View style={{ paddingLeft: 44 }}>
                {sec.body.split('\n').map((line, li) => {
                  const isBullet = line.startsWith('• ');
                  return (
                    <Text key={li} style={{
                      fontSize: 13.5, color: isBullet ? colors.text : colors.textMuted,
                      lineHeight: 20, fontFamily: fontFamily.body,
                      marginBottom: isBullet ? 4 : 2,
                    }}>
                      {line}
                    </Text>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Footer */}
          <View style={{ marginTop: 12, padding: 14, backgroundColor: colors.card, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="bulb-outline" size={16} color={colors.accent} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.textDim, lineHeight: 17, fontFamily: fontFamily.body }}>
              Tap any stat card or chart to interact with it. Changes you log are reflected across all screens instantly.
            </Text>
          </View>
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
