import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';

const SCREEN_W = Dimensions.get('window').width;
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function MonthHeatmap({ data = {}, color = '#d4ff00', month, year, containerPad = 32 }) {
  const cellSize = Math.floor((SCREEN_W - containerPad - 2) / 7);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ empty: true, key: `e${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, value: data[dateStr] ?? 0, dateStr, key: dateStr });
  }

  const values = Object.entries(data)
    .filter(([k]) => {
      const [y, m] = k.split('-').map(Number);
      return y === year && m - 1 === month;
    })
    .map(([, v]) => v)
    .filter(v => v > 0);
  const maxVal = values.length > 0 ? Math.max(...values) : 1;

  const hexAlpha = (intensity) =>
    Math.round(Math.max(0.15, intensity) * 220 + 35)
      .toString(16)
      .padStart(2, '0');

  return (
    <View>
      <View style={styles.labelRow}>
        {DAY_LABELS.map((d, i) => (
          <View key={i} style={{ width: cellSize, alignItems: 'center' }}>
            <Text style={styles.dayLabel}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((cell) => {
          if (cell.empty) {
            return <View key={cell.key} style={{ width: cellSize, height: cellSize }} />;
          }
          const isToday =
            cell.day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();
          const intensity = cell.value > 0 ? cell.value / maxVal : 0;

          return (
            <View
              key={cell.key}
              style={[
                styles.dayCell,
                { width: cellSize, height: cellSize, borderRadius: cellSize * 0.2 },
                cell.value > 0
                  ? { backgroundColor: `${color}${hexAlpha(intensity)}` }
                  : { backgroundColor: '#16162a' },
                isToday && { borderWidth: 1.5, borderColor: color },
              ]}
            >
              <Text
                style={[
                  styles.dayNum,
                  cell.value > 0 && { color: '#fff', fontWeight: '600' },
                  isToday && { color },
                ]}
              >
                {cell.day}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { alignItems: 'center', justifyContent: 'center', margin: 1 },
  dayLabel: { fontSize: 9, color: '#555570', fontWeight: '700' },
  dayNum: { fontSize: 10, color: '#555570' },
});
