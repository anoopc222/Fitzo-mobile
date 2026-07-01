import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { typography, weight } from '../../theme/typography';

export default function ResetPasswordScreen() {
  const { updatePassword } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!password || password.length < 6) {
      return Alert.alert(t('auth.error'), t('auth.passwordTooShort'));
    }
    if (password !== confirm) {
      return Alert.alert(t('auth.error'), t('auth.passwordMismatch'));
    }
    setLoading(true);
    try {
      await updatePassword(password);
      // isRecovering cleared by updatePassword — AppNavigator switches back to the app automatically
    } catch (e) {
      Alert.alert(t('auth.error'), e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.iconWrap}>
        <Ionicons name="lock-open-outline" size={48} color={colors.accent} />
      </View>
      <Text style={styles.title}>{t('auth.setNewPassword')}</Text>
      <Text style={styles.sub}>{t('auth.setNewPasswordSub')}</Text>

      <View style={styles.form}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={t('auth.newPasswordPlaceholder')}
            placeholderTextColor={colors.textDim}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(v => !v)}>
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textDim} />
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.inputStandalone}
          placeholder={t('auth.confirmPasswordPlaceholder')}
          placeholderTextColor={colors.textDim}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
        />

        <TouchableOpacity style={styles.btn} onPress={handleReset} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.btnText}>{t('auth.updatePassword')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.accent + '18',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  title: {
    fontSize: typography.xl, fontWeight: weight.bold,
    color: colors.text, textAlign: 'center', marginBottom: 8,
  },
  sub: {
    fontSize: typography.sm, color: colors.textMuted,
    textAlign: 'center', lineHeight: 20, marginBottom: 32,
  },
  form: { width: '100%' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, marginBottom: 14,
  },
  input: {
    flex: 1, padding: 16, color: colors.text, fontSize: typography.base,
  },
  eyeBtn: { paddingHorizontal: 14 },
  inputStandalone: {
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 16, color: colors.text,
    fontSize: typography.base, marginBottom: 20,
  },
  btn: {
    backgroundColor: colors.accent, borderRadius: 12,
    padding: 16, alignItems: 'center',
  },
  btnText: {
    color: colors.bg, fontSize: typography.base, fontWeight: weight.bold,
  },
});
