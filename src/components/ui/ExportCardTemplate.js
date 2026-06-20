import React, { forwardRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fontFamily, weight } from '../../theme/typography';

// Branded frame wrapped around a card's content for sharing to social
// media — logo header + footer are only ever rendered into the
// off-screen capture target, never shown in the normal UI.
const ExportCardTemplate = forwardRef(function ExportCardTemplate(
  { title, subtitle, children, colors, width = 360 },
  ref
) {
  return (
    <View ref={ref} collapsable={false} style={[styles.frame, { backgroundColor: colors.bg, width }]}>
      <View style={styles.header}>
        <Text style={[styles.logo, { color: colors.text }]}>
          Fitzo<Text style={{ color: colors.accent }}>•</Text>
        </Text>
        {title ? <Text style={[styles.title, { color: colors.textMuted }]}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textDim }]}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.body, { backgroundColor: colors.card ?? colors.bgCard, borderColor: colors.border }]}>
        {children}
      </View>
      <Text style={[styles.footer, { color: colors.textDim }]}>Tracked with Fitzo</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { padding: 24, borderRadius: 0 },
  header: { alignItems: 'center', marginBottom: 18 },
  logo: { fontSize: 28, fontStyle: 'italic', fontWeight: weight.black, fontFamily: fontFamily.displayItalic },
  title: { fontSize: 12, letterSpacing: 2, marginTop: 6, fontWeight: weight.bold, textTransform: 'uppercase' },
  subtitle: { fontSize: 11, marginTop: 2 },
  body: { borderRadius: 16, borderWidth: 1, padding: 16 },
  footer: { textAlign: 'center', fontSize: 10, marginTop: 18, letterSpacing: 0.5 },
});

export default ExportCardTemplate;
