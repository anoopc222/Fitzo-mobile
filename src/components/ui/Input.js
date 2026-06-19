import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { fontFamily } from '../../theme/typography';

// Mirrors web .form-label + .input-field
export default function Input({ label, style, inputStyle, compact = false, ...props }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <Text style={[styles.label, { color: colors.textDim }]}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textDim}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        style={[
          styles.input,
          compact && styles.inputCompact,
          {
            backgroundColor: colors.surface,
            color: colors.text,
            borderColor: focused ? colors.accent : colors.border,
          },
          inputStyle,
        ]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    fontFamily: fontFamily.body,
    fontSize: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  inputCompact: {
    paddingVertical: 9,
    paddingHorizontal: 11,
    fontSize: 13,
  },
});
