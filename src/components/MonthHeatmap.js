import React from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';

const SCREEN_W = Dimensions.get('window').width;
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function MonthHeatmap({ data = {}, color = '#d4ff00', month, year, containerPad = 32, onDayPress, typeColors = {}, emptyCellColor = '#16162a', mutedTextColor = '#555570' }) {
  // Each day occupies a fixed-width slot; the colored box is inset within
  // the slot (no margins) so every row/column lines up exactly, including
  // with the day-of-week label row above.
  const slotSize = Math.floor((SCREEN_W - containerPad) / 7);
  const cellSize = slotSize - 4;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push({ empty: true, key: `e${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, value: data[dateStr] ?? 0, dateStr, key: dateStr });
  }
  while (cells.length % 7 !== 0) cells.push({ empty: true, key: `t${cells.length}` });

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

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
          <View key={i} style={{ width: slotSize, alignItems: 'center' }}>
            <Text style={[styles.dayLabel, { color: mutedTextColor }]}>{d}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.weekRow}>
          {week.map((cell) => {
            if (cell.empty) {
              return <View key={cell.key} style={{ width: slotSize, height: slotSize }} />;
            }
            const isToday =
              cell.day === today.getDate() &&
              month === today.getMonth() &&
              year === today.getFullYear();
            const hasSession = cell.value > 0 || cell.dateStr in typeColors;
            const intensity = cell.value > 0 ? cell.value / maxVal : 0;
            const cellColor = typeColors[cell.dateStr] || color;

            const Wrapper = onDayPress ? TouchableOpacity : View;
            return (
              <View key={cell.key} style={{ width: slotSize, height: slotSize, alignItems: 'center', justifyContent: 'center' }}>
                <Wrapper
                  activeOpacity={onDayPress ? 0.7 : undefined}
                  onPress={onDayPress ? () => onDayPress(cell.dateStr, cell.value) : undefined}
                  style={[
                    styles.dayCell,
                    { width: cellSize, height: cellSize, borderRadius: cellSize * 0.2 },
                    hasSession
                      ? { backgroundColor: `${cellColor}${hexAlpha(intensity)}` }
                      : { backgroundColor: emptyCellColor },
                    isToday && { borderWidth: 1.5, borderColor: cellColor },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayNum,
                      { color: mutedTextColor },
                      isToday && { color: cellColor },
                      hasSession && { color: '#fff', fontWeight: '600' },
                    ]}
                  >
                    {cell.day}
                  </Text>
                </Wrapper>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', marginBottom: 4 },
  weekRow: { flexDirection: 'row' },
  dayCell: { alignItems: 'center', justifyContent: 'center' },
  dayLabel: { fontSize: 9, fontWeight: '700' },
  dayNum: { fontSize: 10 },
});
