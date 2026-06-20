import React, { useState, useEffect, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { typography, weight, fontFamily } from '../../theme/typography';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Tappable month label opens this to jump to any month/year directly,
// instead of stepping one month at a time with the chevrons.
export default function MonthYearPicker({ visible, month, year, onSelect, onClose }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [viewYear, setViewYear] = useState(year);

  useEffect(() => { if (visible) setViewYear(year); }, [visible, year]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.popup} onPress={() => {}}>
          <View style={styles.yearRow}>
            <TouchableOpacity onPress={() => setViewYear(y => y - 1)} style={styles.yearBtn}>
              <Text style={styles.yearChevron}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.yearLabel}>{viewYear}</Text>
            <TouchableOpacity onPress={() => setViewYear(y => y + 1)} style={styles.yearBtn}>
              <Text style={styles.yearChevron}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.grid}>
            {MONTH_SHORT.map((m, i) => {
              const isSel = i === month && viewYear === year;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.cell, isSel && styles.cellSel]}
                  onPress={() => { onSelect(i, viewYear); onClose(); }}
                >
                  <Text style={[styles.cellText, isSel && styles.cellTextSel]}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const createStyles = (colors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  popup: {
    width: '100%', maxWidth: 360,
    backgroundColor: colors.bgElevated, borderRadius: 24,
    borderWidth: 1, borderColor: colors.border, padding: 18,
  },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginBottom: 16 },
  yearBtn: { padding: 8 },
  yearChevron: { fontSize: 22, color: colors.text, fontWeight: '300' },
  yearLabel: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text, fontFamily: fontFamily.monoBold, minWidth: 64, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    width: '30%', paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  cellSel: { backgroundColor: colors.accent, borderColor: colors.accent },
  cellText: { fontSize: typography.sm, fontWeight: weight.semibold, color: colors.text, fontFamily: fontFamily.bodyBold },
  cellTextSel: { color: colors.bg },
});
