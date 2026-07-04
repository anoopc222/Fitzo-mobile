import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { typography, weight } from '../../theme/typography';

export default function RegisterScreen({ navigation }) {
  const { signUp } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const emailMismatch = confirmEmail.length > 0 && email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase();
  const emailMatch = confirmEmail.length > 0 && email.trim().toLowerCase() === confirmEmail.trim().toLowerCase();

  const handleRegister = async () => {
    if (!name || !email || !confirmEmail || !password) {
      return Alert.alert(t('auth.error'), t('auth.allFieldsRequired'));
    }
    if (email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      return Alert.alert(t('auth.error'), t('auth.emailMismatch'));
    }
    if (password.length < 6) {
      return Alert.alert(t('auth.error'), t('auth.passwordTooShort'));
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      Alert.alert(t('auth.success'), t('auth.checkEmailConfirm'));
    } catch (e) {
      Alert.alert(t('auth.signUpFailed'), e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>FitZo</Text>
        <Text style={styles.tagline}>{t('auth.createAccountTagline')}</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder={t('auth.fullNamePlaceholder')}
            placeholderTextColor={colors.textDim}
            value={name}
            onChangeText={setName}
          />

          {/* Email + confirm email pair */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.inputInner}
              placeholder={t('auth.emailPlaceholder')}
              placeholderTextColor={colors.textDim}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={[styles.inputRow, emailMismatch && styles.inputRowError, emailMatch && styles.inputRowOk]}>
            <TextInput
              style={styles.inputInner}
              placeholder={t('auth.confirmEmailPlaceholder')}
              placeholderTextColor={colors.textDim}
              value={confirmEmail}
              onChangeText={setConfirmEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {emailMismatch && <Ionicons name="close-circle" size={18} color={colors.danger} style={styles.statusIcon} />}
            {emailMatch && <Ionicons name="checkmark-circle" size={18} color={colors.success} style={styles.statusIcon} />}
          </View>
          {emailMismatch && (
            <Text style={styles.errorHint}>{t('auth.emailMismatch')}</Text>
          )}

          <View style={[styles.inputRow, { marginTop: emailMismatch ? 0 : 0 }]}>
            <TextInput
              style={styles.inputInner}
              placeholder={t('auth.passwordPlaceholder')}
              placeholderTextColor={colors.textDim}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.statusIcon}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textDim} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.btnText}>{t('auth.createAccount')}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.link}>{t('auth.haveAccount')}<Text style={styles.linkAccent}>{t('auth.signIn')}</Text></Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 40 },
  logo: { fontSize: typography.xxxl, fontWeight: weight.black, color: colors.accent, letterSpacing: 2 },
  tagline: { color: colors.textMuted, fontSize: typography.sm, marginTop: 6, marginBottom: 40, letterSpacing: 1 },
  form: { width: '100%' },
  input: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 16, color: colors.text, fontSize: typography.base, marginBottom: 14,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, marginBottom: 14,
  },
  inputRowError: { borderColor: colors.danger },
  inputRowOk: { borderColor: colors.success },
  inputInner: { flex: 1, padding: 16, color: colors.text, fontSize: typography.base },
  statusIcon: { paddingHorizontal: 12 },
  errorHint: { fontSize: typography.xs, color: colors.danger, marginTop: -10, marginBottom: 12, marginLeft: 4 },
  btn: {
    backgroundColor: colors.accent, borderRadius: 12,
    padding: 16, alignItems: 'center', marginTop: 8, marginBottom: 20,
  },
  btnText: { color: colors.bg, fontSize: typography.base, fontWeight: weight.bold },
  link: { color: colors.textMuted, textAlign: 'center', fontSize: typography.sm },
  linkAccent: { color: colors.accent, fontWeight: weight.semibold },
});
