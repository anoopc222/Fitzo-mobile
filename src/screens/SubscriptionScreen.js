import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import ScreenHeader from '../components/ScreenHeader';
import { typography, weight, fontFamily } from '../theme/typography';

const PRO_FEATURE_KEYS = [
  { icon: 'trending-up', key: 'featureTrendCharts' },
  { icon: 'calendar', key: 'featureMonthHeatmaps' },
  { icon: 'trophy', key: 'featureProgressTracking' },
  { icon: 'body', key: 'featureBodyMeasurements' },
  { icon: 'pulse', key: 'featureRecoveryAnalysis' },
  { icon: 'calculator', key: 'featureCalculatorSuite' },
  { icon: 'share-social', key: 'featureExportCards' },
];

export default function SubscriptionScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const { t } = useTranslation();
  const {
    isPro, isInTrial, trialDaysLeft, offering, purchasePackage, restorePurchases,
  } = useSubscription();
  const [busy, setBusy] = useState(false);

  const plan = offering?.availablePackages?.[0] ?? null;

  const handlePurchase = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await purchasePackage(plan);
      navigation.goBack();
    } catch (e) {
      if (!e?.userCancelled) Alert.alert(t('subscription.purchaseFailed'), e?.message ?? t('subscription.tryAgain'));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      await restorePurchases();
      Alert.alert(t('subscription.restored'), t('subscription.restoredMessage'));
    } catch (e) {
      Alert.alert(t('subscription.restoreFailed'), e?.message ?? t('subscription.tryAgain'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title={t('subscription.goPro')} colors={colors} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{t('subscription.fitzo')} <Text style={{ color: colors.accent }}>{t('subscription.pro')}</Text></Text>
          <Text style={styles.heroSubtitle}>
            {isPro
              ? t('subscription.fullAccess')
              : isInTrial
                ? t('subscription.trialDaysLeft', { count: trialDaysLeft })
                : t('subscription.unlockInsights')}
          </Text>
        </View>

        <View style={styles.featureList}>
          {PRO_FEATURE_KEYS.map(f => (
            <View key={f.key} style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name={f.icon} size={15} color={colors.accent} />
              </View>
              <Text style={styles.featureText}>{t(`subscription.${f.key}`)}</Text>
            </View>
          ))}
        </View>

        {isPro ? (
          <View style={styles.proneBadgeRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.proneBadgeText}>{t('subscription.subscribedBadge')}</Text>
          </View>
        ) : !plan ? (
          <Text style={styles.noOffer}>{t('subscription.noPlansAvailable')}</Text>
        ) : (
          <TouchableOpacity style={styles.planBtn} onPress={handlePurchase} disabled={busy} activeOpacity={0.85}>
            <Text style={styles.planTitle}>{plan.product.title || plan.identifier}</Text>
            <Text style={styles.planPrice}>{t('subscription.pricePerMonth', { price: plan.product.priceString })}</Text>
          </TouchableOpacity>
        )}

        {busy && <ActivityIndicator color={colors.accent} style={{ marginTop: 14 }} />}

        {!isPro && (
          <TouchableOpacity onPress={handleRestore} disabled={busy} style={styles.restoreBtn}>
            <Text style={styles.restoreText}>{t('subscription.restorePurchases')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 8 },
  hero: { alignItems: 'center', marginTop: 12, marginBottom: 28 },
  heroTitle: { fontSize: 28, fontWeight: weight.black, color: colors.text, fontFamily: fontFamily.displayItalic },
  heroSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
  featureList: { gap: 14, marginBottom: 28 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIconWrap: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: colors.accent + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  featureText: { fontSize: 13, color: colors.text, flex: 1 },
  noOffer: { fontSize: 12, color: colors.textDim, textAlign: 'center', marginBottom: 16 },
  planBtn: {
    backgroundColor: colors.accent, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
  },
  planTitle: { fontSize: 15, fontWeight: weight.bold, color: colors.accentText },
  planPrice: { fontSize: 12, color: colors.accentText, marginTop: 2 },
  proneBadgeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.success + '14', borderRadius: 14, paddingVertical: 14,
  },
  proneBadgeText: { fontSize: 13, fontWeight: weight.bold, color: colors.success },
  restoreBtn: { alignItems: 'center', paddingVertical: 16 },
  restoreText: { fontSize: 12, color: colors.textMuted, textDecorationLine: 'underline' },
});
