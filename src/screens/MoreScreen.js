import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { typography, weight } from '../theme/typography';

const getSections = (colors) => [
  {
    title: 'BODY & HEALTH',
    items: [
      { label: 'Diet Plan',     icon: 'restaurant',  screen: 'Diet',         color: colors.warning },
      { label: 'Progress',      icon: 'trending-up', screen: 'Progress',     color: colors.success },
      { label: 'Measurements',  icon: 'body',        screen: 'Measurements', color: colors.accent },
      { label: 'Health Log',    icon: 'heart-half',  screen: 'HealthLog',    color: colors.danger },
    ],
  },
  {
    title: 'TOOLS',
    items: [
      { label: 'Calculators',   icon: 'calculator',  screen: 'Calculators',  color: colors.warning },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      { label: 'Profile',       icon: 'person',      screen: 'Profile',      color: colors.blue },
      { label: 'Settings',      icon: 'settings',    screen: 'Settings',     color: colors.textMuted },
    ],
  },
];

export default function MoreScreen({ navigation }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const SECTIONS = useMemo(() => getSections(colors), [colors]);
  const name    = user?.user_metadata?.full_name?.split(' ')[0] ?? 'there';
  const initial = (name[0] ?? 'F').toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>More</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Profile strip */}
      <View style={styles.profileStrip}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>Hello, {name}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('Profile')} style={styles.editBtn}>
          <Ionicons name="pencil" size={16} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map(section => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.grid}>
              {section.items.map(item => (
                <TouchableOpacity
                  key={item.screen}
                  style={styles.tile}
                  onPress={() => navigation.navigate(item.screen)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconWrap, { backgroundColor: item.color + '20' }]}>
                    <Ionicons name={item.icon} size={22} color={item.color} />
                  </View>
                  <Text style={styles.tileLabel}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  title: { fontSize: typography.lg, fontWeight: weight.bold, color: colors.text },

  profileStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
    marginBottom: 8,
  },
  avatarWrap: { padding: 2, borderRadius: 26, borderWidth: 2, borderColor: colors.accent },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: typography.lg, fontWeight: weight.black, color: colors.bg },
  profileInfo: { flex: 1 },
  profileName: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text },
  profileEmail: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },
  editBtn: { padding: 8, borderRadius: 20, backgroundColor: colors.accent + '18' },

  content: { paddingHorizontal: 16, paddingBottom: 32 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11, fontWeight: weight.bold, color: colors.textDim,
    letterSpacing: 1, marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '47%', alignItems: 'center', gap: 8,
    backgroundColor: colors.bgCard, borderRadius: 16, paddingVertical: 18,
    borderWidth: 1, borderColor: colors.border,
  },
  iconWrap: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: typography.sm, fontWeight: weight.medium, color: colors.text, textAlign: 'center' },
});
