import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useSubscription } from '../context/SubscriptionContext';
import ScreenHeader from '../components/ScreenHeader';
import { typography, weight, fontFamily } from '../theme/typography';

const PRO_FEATURES = [
  { icon: 'trending-up', text: 'Long-range trend charts (60D / 90D / ALL)' },
  { icon: 'calendar', text: 'Month heatmaps for Weight, Steps & Sleep' },
  { icon: 'trophy', text: 'Progress tracking with PR badges & trend insights' },
  { icon: 'body', text: 'Body measurements history' },
  { icon: 'pulse', text: 'Recovery, Cut Score & sleep-debt analysis' },
  { icon: 'calculator', text: 'Full calculator suite' },
  { icon: 'share-social', text: 'Branded export/share cards' },
];

export default function SubscriptionScreen({ navigation }) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
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
      if (!e?.userCancelled) Alert.alert('Purchase failed', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      await restorePurchases();
      Alert.alert('Restored', 'Your purchases have been restored.');
    } catch (e) {
      Alert.alert('Restore failed', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScreenHeader title="GO PRO" colors={colors} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Fitzo <Text style={{ color: colors.accent }}>Pro</Text></Text>
          <Text style={styles.heroSubtitle}>
            {isPro
              ? 'You have full access to every feature.'
              : isInTrial
                ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your free trial`
                : 'Unlock deeper insights into your training, body & recovery'}
          </Text>
        </View>

        <View style={styles.featureList}>
          {PRO_FEATURES.map(f => (
            <View key={f.text} style={styles.featureRow}>
              <View style={styles.featureIconWrap}>
                <Ionicons name={f.icon} size={15} color={colors.accent} />
              </View>
              <Text style={styles.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {isPro ? (
          <View style={styles.proneBadgeRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text style={styles.proneBadgeText}>You're subscribed to Fitzo Pro</Text>
          </View>
        ) : !plan ? (
          <Text style={styles.noOffer}>Subscription plans aren't available yet.</Text>
        ) : (
          <TouchableOpacity style={styles.planBtn} onPress={handlePurchase} disabled={busy} activeOpacity={0.85}>
            <Text style={styles.planTitle}>{plan.product.title || plan.identifier}</Text>
            <Text style={styles.planPrice}>{plan.product.priceString}/mo</Text>
          </TouchableOpacity>
        )}

        {busy && <ActivityIndicator color={colors.accent} style={{ marginTop: 14 }} />}

        {!isPro && (
          <TouchableOpacity onPress={handleRestore} disabled={busy} style={styles.restoreBtn}>
            <Text style={styles.restoreText}>Restore purchases</Text>
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
