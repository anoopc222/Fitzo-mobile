import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { fontFamily, weight } from '../../theme/typography';
import BottomSheet from './BottomSheet';

const PRO_FEATURES = [
  'Long-range trend charts (60D / 90D / ALL)',
  'Month heatmaps for Weight, Steps & Sleep',
  'Progress tracking with PR badges & trend insights',
  'Body measurements & blood health log history',
  'Recovery, Cut Score & sleep-debt analysis',
  'Full calculator suite',
  'Branded export/share cards',
];

export default function PaywallModal({ visible, onClose }) {
  const { colors } = useTheme();
  const { isInTrial, trialDaysLeft, offering, purchasePackage, restorePurchases } = useSubscription();
  const [busy, setBusy] = useState(false);
  const styles = createStyles(colors);

  const packages = offering?.availablePackages ?? [];

  const handlePurchase = async (pkg) => {
    setBusy(true);
    try {
      await purchasePackage(pkg);
      onClose?.();
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
      onClose?.();
    } catch (e) {
      Alert.alert('Restore failed', e?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>Fitzo <Text style={{ color: colors.accent }}>Pro</Text></Text>
        <Text style={styles.subtitle}>
          {isInTrial
            ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left in your free trial`
            : 'Your free trial has ended — subscribe to keep your insights'}
        </Text>
      </View>

      <View style={styles.featureList}>
        {PRO_FEATURES.map(f => (
          <View key={f} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      {packages.length === 0 ? (
        <Text style={styles.noOffer}>Subscription plans aren't available yet.</Text>
      ) : (
        <View style={styles.plans}>
          {packages.map(pkg => (
            <TouchableOpacity
              key={pkg.identifier}
              style={styles.planBtn}
              onPress={() => handlePurchase(pkg)}
              disabled={busy}
            >
              <Text style={styles.planTitle}>{pkg.product.title || pkg.identifier}</Text>
              <Text style={styles.planPrice}>{pkg.product.priceString}/mo</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {busy && <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />}

      <TouchableOpacity onPress={handleRestore} disabled={busy} style={styles.restoreBtn}>
        <Text style={styles.restoreText}>Restore purchases</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

const createStyles = (colors) => StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: weight.black, color: colors.text, fontFamily: fontFamily.displayItalic },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 6, textAlign: 'center' },
  featureList: { gap: 10, marginBottom: 18 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { fontSize: 13, color: colors.text, flex: 1 },
  noOffer: { fontSize: 12, color: colors.textDim, textAlign: 'center', marginBottom: 16 },
  plans: { gap: 10, marginBottom: 8 },
  planBtn: {
    backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  planTitle: { fontSize: 14, fontWeight: weight.bold, color: colors.bg },
  planPrice: { fontSize: 12, color: colors.bg, marginTop: 2 },
  restoreBtn: { alignItems: 'center', paddingVertical: 12 },
  restoreText: { fontSize: 12, color: colors.textMuted, textDecorationLine: 'underline' },
});
