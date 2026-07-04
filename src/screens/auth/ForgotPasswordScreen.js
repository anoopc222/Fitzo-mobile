import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, ScrollView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { typography, weight } from '../../theme/typography';

export default function ForgotPasswordScreen({ navigation }) {
  const { forgotPassword } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (e) {
      Alert.alert(t('auth.error'), e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={20} color={colors.text} />
      </TouchableOpacity>

      <Text style={styles.logo}>FitZo</Text>
      <Text style={styles.tagline}>{t('auth.tagline')}</Text>

      <View style={styles.form}>
        {sent ? (
          <View style={styles.sentBox}>
            <Text style={styles.sentIcon}>📧</Text>
            <Text style={styles.sentTitle}>{t('auth.resetSent')}</Text>
            <Text style={styles.sentSub}>{t('auth.resetSentSub')}</Text>
            <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
              <Text style={styles.btnText}>{t('auth.backToSignIn')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.title}>{t('auth.forgotPassword')}</Text>
            <Text style={styles.sub}>{t('auth.forgotPasswordSub')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.emailPlaceholder')}
              placeholderTextColor={colors.textDim}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <TouchableOpacity style={styles.btn} onPress={handleSend} disabled={loading}>
              {loading
                ? <ActivityIndicator color={colors.bg} />
                : <Text style={styles.btnText}>{t('auth.sendReset')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <Text style={styles.link}>{t('auth.backToSignIn')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 40,
  },
  backBtn: {
    position: 'absolute',
    top: 56,
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  logo: {
    fontSize: typography.xxxl,
    fontWeight: weight.black,
    color: colors.accent,
    letterSpacing: 2,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: typography.sm,
    marginTop: 6,
    marginBottom: 40,
    letterSpacing: 1,
  },
  form: { width: '100%' },
  title: {
    fontSize: typography.xl,
    fontWeight: weight.bold,
    color: colors.text,
    marginBottom: 8,
  },
  sub: {
    fontSize: typography.sm,
    color: colors.textDim,
    marginBottom: 24,
    lineHeight: 20,
  },
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: typography.base,
    marginBottom: 14,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  btnText: {
    color: colors.bg,
    fontSize: typography.base,
    fontWeight: weight.bold,
  },
  link: {
    color: colors.accent,
    textAlign: 'center',
    fontSize: typography.sm,
    fontWeight: weight.semibold,
  },
  sentBox: { alignItems: 'center', paddingVertical: 20 },
  sentIcon: { fontSize: 48, marginBottom: 16 },
  sentTitle: { fontSize: typography.xl, fontWeight: weight.bold, color: colors.text, marginBottom: 8 },
  sentSub: { fontSize: typography.sm, color: colors.textDim, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
});
