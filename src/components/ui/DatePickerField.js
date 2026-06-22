import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function DatePickerField({ value, onChange, colors, style, placeholder = 'Select date', maxDate, minDate }) {
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === 'web') {
    return React.createElement('input', {
      type: 'date',
      value: value || '',
      max: maxDate,
      min: minDate,
      onChange: (e) => onChange(e.target.value),
      style: {
        backgroundColor: colors.bgElevated,
        color: colors.text,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        padding: 10,
        fontSize: 14,
        width: '100%',
        fontFamily: 'inherit',
        colorScheme: 'dark',
        ...style,
      },
    });
  }

  const DateTimePicker = require('@react-native-community/datetimepicker').default;
  const dateObj = value ? new Date(`${value}T00:00:00`) : new Date();

  const handleChange = (event, selected) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'dismissed') return;
    if (selected) onChange(toDateStr(selected));
  };

  return (
    <View>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.bgElevated, borderColor: colors.border }, style]}
        onPress={() => setShowPicker(true)}
      >
        <Text style={{ color: value ? colors.text : colors.textDim, fontSize: 14 }}>
          {value || placeholder}
        </Text>
        <Ionicons name="calendar-outline" size={16} color={colors.textDim} />
      </TouchableOpacity>
      {showPicker && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleChange}
          maximumDate={maxDate ? new Date(maxDate) : undefined}
          minimumDate={minDate ? new Date(minDate) : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
