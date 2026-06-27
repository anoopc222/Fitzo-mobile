import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { typography, weight, fontFamily } from '../theme/typography';
import { useFreezeForDate } from '../lib/streakFreeze';

// Local calendar date as YYYY-MM-DD, matching HomeScreen's localDateStr.
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function StreakFreezeControl({ userId, home }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const qc = useQueryClient();
  const [showDetail, setShowDetail] = useState(false);

  const freezesAvailable = home?.freezesAvailable ?? 0;
  const canUseToday = freezesAvailable > 0 && !home?.todayStepsLogged;

  const useFreezeMut = useMutation({
    mutationFn: () => useFreezeForDate(userId, todayStr()),
    onSuccess: () => {
      setShowDetail(false);
      qc.invalidateQueries(['home', userId]);
    },
    onError: (e) => Alert.alert('Error', e.message),
  });

  return (
    <>
      <TouchableOpacity style={styles.pill} onPress={() => setShowDetail(true)} activeOpacity={0.8}>
        <Text style={styles.pillIcon}>🧊</Text>
        <Text style={styles.pillText}>{freezesAvailable}</Text>
      </TouchableOpacity>

      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowDetail(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetIcon}>🧊</Text>
            <Text style={styles.sheetTitle}>{t('gamification.streakFreezesTitle')}</Text>
            <Text style={styles.sheetCount}>{t('gamification.freezesAvailableCount', { count: freezesAvailable })}</Text>
            <Text style={styles.sheetBody}>{t('gamification.freezeDescription')}</Text>
            {canUseToday ? (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => useFreezeMut.mutate()}
                disabled={useFreezeMut.isPending}
              >
                <Text style={styles.actionBtnText}>
                  {useFreezeMut.isPending ? t('gamification.freezeUsing') : t('gamification.useFreezeToday')}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.closeBtn} onPress={() => setShowDetail(false)}>
                <Text style={styles.closeBtnText}>{t('gamification.gotIt')}</Text>
              </TouchableOpacity>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (colors) => StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: colors.surface, alignSelf: 'flex-start', marginLeft: 8,
  },
  pillIcon: { fontSize: 12 },
  pillText: { fontSize: typography.xs, fontFamily: fontFamily.bodySemibold, color: colors.textMuted },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  sheet: {
    width: '100%', maxWidth: 360, borderRadius: 20, padding: 24,
    alignItems: 'center', backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.border,
  },
  sheetIcon: { fontSize: 36, marginBottom: 8 },
  sheetTitle: { fontSize: typography.lg, fontWeight: weight.bold, fontFamily: fontFamily.bodyBold, color: colors.text },
  sheetCount: { fontSize: typography.sm, color: colors.accent, fontFamily: fontFamily.bodySemibold, marginBottom: 12 },
  sheetBody: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  actionBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 14, backgroundColor: colors.accent },
  actionBtnText: { fontSize: typography.base, fontWeight: weight.bold, color: colors.bg },
  closeBtn: { paddingVertical: 12, paddingHorizontal: 32, borderRadius: 14, backgroundColor: colors.surface },
  closeBtnText: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text },
});
