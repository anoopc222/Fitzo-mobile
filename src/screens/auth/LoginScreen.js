import React, { useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { typography, weight } from '../../theme/typography';

export default function LoginScreen({ navigation }) {
  const { signIn, forgotPassword } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotVisible, setForgotVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert(t('auth.error'), t('auth.emailPasswordRequired'));
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      Alert.alert(t('auth.loginFailed'), e.message);
    } finally {
      setLoading(false);
    }
  };

  const openForgot = () => {
    setForgotEmail(email);
    setForgotVisible(true);
  };

  const handleForgot = async () => {
    if (!forgotEmail.trim()) return;
    setForgotLoading(true);
    try {
      await forgotPassword(forgotEmail);
      setForgotVisible(false);
      Alert.alert(t('auth.resetSent'), t('auth.resetSentSub'));
    } catch (e) {
      Alert.alert(t('auth.error'), e.message);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>FitZo</Text>
      <Text style={styles.tagline}>{t('auth.tagline')}</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder={t('auth.emailPlaceholder')}
          placeholderTextColor={colors.textDim}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder={t('auth.passwordPlaceholder')}
          placeholderTextColor={colors.textDim}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.forgotBtn} onPress={openForgot}>
          <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.btnText}>{t('auth.signIn')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Register')}>
          <Text style={styles.link}>{t('auth.noAccount')}<Text style={styles.linkAccent}>{t('auth.signUp')}</Text></Text>
        </TouchableOpacity>
      </View>

      {/* Cross-platform forgot password modal */}
      <Modal visible={forgotVisible} transparent animationType="fade" onRequestClose={() => setForgotVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{t('auth.forgotPassword')}</Text>
            <Text style={styles.dialogSub}>{t('auth.forgotPasswordSub')}</Text>
            <TextInput
              style={styles.dialogInput}
              placeholder={t('auth.emailPlaceholder')}
              placeholderTextColor={colors.textDim}
              value={forgotEmail}
              onChangeText={setForgotEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoFocus
            />
            <View style={styles.dialogBtns}>
              <TouchableOpacity style={styles.dialogCancel} onPress={() => setForgotVisible(false)}>
                <Text style={styles.dialogCancelText}>{t('common.cancel') ?? 'Cancel'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dialogSend} onPress={handleForgot} disabled={forgotLoading}>
                {forgotLoading ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.dialogSendText}>{t('auth.sendReset') ?? 'Send'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
    marginTop: 4,
    marginBottom: 20,
  },
  btnText: {
    color: colors.bg,
    fontSize: typography.base,
    fontWeight: weight.bold,
  },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 14, marginTop: -6 },
  forgotText: { fontSize: typography.sm, color: colors.accent },
  link: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: typography.sm,
  },
  linkAccent: { color: colors.accent, fontWeight: weight.semibold },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    backgroundColor: colors.bgCard,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dialogTitle: { fontSize: typography.base, fontWeight: weight.bold, color: colors.text, marginBottom: 6 },
  dialogSub: { fontSize: typography.sm, color: colors.textDim, marginBottom: 16 },
  dialogInput: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 13,
    color: colors.text,
    fontSize: typography.sm,
    marginBottom: 16,
  },
  dialogBtns: { flexDirection: 'row', gap: 10 },
  dialogCancel: {
    flex: 1, borderRadius: 10, padding: 13, alignItems: 'center',
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.border,
  },
  dialogCancelText: { fontSize: typography.sm, color: colors.textDim, fontWeight: weight.semibold },
  dialogSend: {
    flex: 1, borderRadius: 10, padding: 13, alignItems: 'center',
    backgroundColor: colors.accent,
  },
  dialogSendText: { fontSize: typography.sm, color: colors.bg, fontWeight: weight.bold },
});
