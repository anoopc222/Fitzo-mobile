import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

/**
 * Wraps PRO-gated content with consistent visual treatment:
 * - hasAccess=true  → renders children normally
 * - hasAccess=false → fades children to 0.55 opacity, overlays a PRO badge
 *                     top-right, and fires onUnlock on tap
 */
export default function ProLock({ hasAccess, onUnlock, colors, children }) {
  if (hasAccess) return <>{children}</>;
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onUnlock} style={{ position: 'relative' }}>
      <View style={{ opacity: 0.55 }} pointerEvents="none">
        {children}
      </View>
      <View style={{
        position: 'absolute', top: 10, right: 10,
        backgroundColor: colors.accent, borderRadius: 5,
        paddingHorizontal: 7, paddingVertical: 2,
      }}>
        <Text style={{ fontSize: 8, fontWeight: '800', color: '#000', letterSpacing: 1 }}>PRO</Text>
      </View>
    </TouchableOpacity>
  );
}
