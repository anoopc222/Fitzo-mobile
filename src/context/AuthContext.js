import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { queryClient } from '../lib/queryClient';

const AuthContext = createContext(null);

// Supabase's confirmation/reset emails redirect here after verifying the
// token server-side, landing the user back in the app via this URL scheme
// (registered as "scheme": "fitzo" in app.json) instead of localhost.
const EMAIL_REDIRECT_TO = Linking.createURL('auth/callback');

function parseSessionFromUrl(url) {
  if (!url) return null;
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return null;
  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const type = params.get('type');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token, type };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    // 5-second safety net: if SecureStore hangs on process restart (Android),
    // force loading=false so the app never shows an infinite black screen.
    const timeout = setTimeout(() => setLoading(false), 5000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      })
      .finally(() => clearTimeout(timeout));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    const handleDeepLink = ({ url }) => {
      const result = parseSessionFromUrl(url);
      if (!result) return;
      supabase.auth.setSession({ access_token: result.access_token, refresh_token: result.refresh_token });
      if (result.type === 'recovery') setIsRecovering(true);
    };

    Linking.getInitialURL().then((url) => url && handleDeepLink({ url }));
    const linkSub = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email, password, name) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name }, emailRedirectTo: EMAIL_REDIRECT_TO },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
  };

  const forgotPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: EMAIL_REDIRECT_TO,
    });
    if (error) throw error;
  };

  const updatePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setIsRecovering(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isRecovering, signIn, signUp, signOut, forgotPassword, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
