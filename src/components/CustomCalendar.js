import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { darkColors, lightColors } from '../theme/colors';
import { typography, weight } from '../theme/typography';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export default function CustomCalendar({
  month = new Date().getMonth(),
  year = new Date().getFullYear(),
  onMonthChange,
  data = {},
  isDark = true,
  hideNavigation = false,
}) {
  const colorScheme = useColorScheme();
  const colors = isDark ? darkColors : lightColors;
  const styles = makeStyles(colors, isDark);

  const getDaysInMonth = (m, y) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (m, y) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(month, year);
  const firstDay = getFirstDayOfMonth(month, year);
  const adjustedFirst = firstDay === 0 ? 6 : firstDay - 1;

  const days = [];
  for (let i = 0; i < adjustedFirst; i++) {
    days.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const today = new Date();
  const isCurrentMonth = month === today.getMonth() && year === today.getFullYear();
  const todayDate = today.getDate();

  const handlePrevMonth = () => {
    if (onMonthChange) {
      if (month === 0) {
        onMonthChange({ month: 11, year: year - 1 });
      } else {
        onMonthChange({ month: month - 1, year });
      }
    }
  };

  const handleNextMonth = () => {
    if (onMonthChange) {
      if (month === 11) {
        onMonthChange({ month: 0, year: year + 1 });
      } else {
        onMonthChange({ month: month + 1, year });
      }
    }
  };

  const getDateKey = (d) => {
    const dateObj = new Date(year, month, d);
    return dateObj.toISOString().split('T')[0];
  };

  const getActivityColor = (dateKey) => {
    const value = data[dateKey];
    if (!value) return null;

    // Return the color object for this date
    return value;
  };

  return (
    <View style={styles.container}>
      {!hideNavigation && (
        <View style={styles.header}>
          <TouchableOpacity onPress={handlePrevMonth} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.monthContainer}>
            <Text style={styles.monthLabel}>
              {MONTHS[month]} {year}
            </Text>
          </View>

          <TouchableOpacity onPress={handleNextMonth} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((day, idx) => (
          <Text key={idx} style={styles.weekdayText}>{day}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day, idx) => {
          const isToday = isCurrentMonth && day === todayDate;
          const dateKey = day ? getDateKey(day) : null;
          const activity = day ? getActivityColor(dateKey) : null;

          return (
            <View
              key={idx}
              style={[
                styles.dayCell,
                isToday && styles.todayCell,
                activity && { borderColor: activity.color, borderWidth: 2 },
              ]}
            >
              {day ? (
                <>
                  <Text style={[styles.dayNumber, isToday && styles.todayText]}>
                    {day}
                  </Text>
                  {activity && (
                    <View
                      style={[
                        styles.activityDot,
                        { backgroundColor: activity.color },
                      ]}
                    />
                  )}
                </>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function makeStyles(colors, isDark) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingVertical: 16,
      backgroundColor: colors.bgCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    navBtn: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    monthContainer: {
      flex: 1,
      alignItems: 'center',
    },
    monthLabel: {
      fontSize: typography.md,
      fontWeight: weight.bold,
      color: colors.text,
      fontStyle: 'italic',
    },
    weekdayRow: {
      flexDirection: 'row',
      marginBottom: 8,
      gap: 4,
    },
    weekdayText: {
      flex: 1,
      textAlign: 'center',
      fontSize: 11,
      fontWeight: weight.semibold,
      color: colors.textMuted,
      paddingVertical: 6,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
    },
    dayCell: {
      width: '14.28%',
      aspectRatio: 1,
      borderRadius: 10,
      backgroundColor: colors.bgElevated,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      position: 'relative',
    },
    todayCell: {
      backgroundColor: isDark ? '#0a1535' : '#e6f0ff',
      borderColor: '#3b82f6',
      borderWidth: 2,
    },
    dayNumber: {
      fontSize: typography.sm,
      fontWeight: weight.semibold,
      color: colors.text,
    },
    todayText: {
      color: '#60a5fa',
      fontWeight: weight.bold,
    },
    activityDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      position: 'absolute',
      bottom: 4,
    },
  });
}
