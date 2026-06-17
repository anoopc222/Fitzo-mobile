import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { typography, weight } from '../../theme/typography';

export default function RegisterScreen({ navigation }) {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name || !email || !password) return Alert.alert('Error', 'All fields are required');
    if (password.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters');
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      Alert.alert('Success', 'Check your email to confirm your account.');
    } catch (e) {
      Alert.alert('Sign up failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.logo}>FitZo</Text>
      <Text style={styles.tagline}>Create your account</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Full Name"
          placeholderTextColor={colors.textDim}
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textDim}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textDim}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.btn} onPress={handleRegister} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.btnText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Already have an account? <Text style={styles.linkAccent}>Sign In</Text></Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
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
  link: {
    color: colors.textMuted,
    textAlign: 'center',
    fontSize: typography.sm,
  },
  linkAccent: { color: colors.accent, fontWeight: weight.semibold },
});
