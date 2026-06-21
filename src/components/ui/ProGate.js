import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useSubscription } from '../../context/SubscriptionContext';
import PaywallModal from './PaywallModal';

// Wrap any premium section with <ProGate>...</ProGate>. While the user has
// access (active trial or "pro" entitlement) children render normally;
// otherwise a locked placeholder is shown that opens the paywall on tap.
export default function ProGate({ children, label = 'Pro feature' }) {
  const { colors } = useTheme();
  const { hasAccess } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);

  if (hasAccess) return <>{children}</>;

  return (
    <>
      <TouchableOpacity style={styles(colors).locked} onPress={() => setShowPaywall(true)} activeOpacity={0.8}>
        <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
        <Text style={styles(colors).lockedText}>{label} — unlock with Fitzo Pro</Text>
      </TouchableOpacity>
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </>
  );
}

const styles = (colors) => StyleSheet.create({
  locked: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.bgElevated, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 22, marginVertical: 4,
  },
  lockedText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
});
