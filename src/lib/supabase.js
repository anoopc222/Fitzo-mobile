import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://xinxibghdusqxfudctnl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpbnhpYmdoZHVzcXhmdWRjdG5sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzE5ODcsImV4cCI6MjA5NzI0Nzk4N30.a2XdJJjhZs1hGeKlAwabcQZ7L7axq4nMSR3KFfyBng8';

// SecureStore adapter — used ONLY for auth session tokens, not app data.
// expo-secure-store has no web implementation, so fall back to localStorage there.
const SecureStoreAdapter = Platform.OS === 'web'
  ? {
      getItem: (key) => Promise.resolve(globalThis.localStorage?.getItem(key) ?? null),
      setItem: (key, value) => Promise.resolve(globalThis.localStorage?.setItem(key, value)),
      removeItem: (key) => Promise.resolve(globalThis.localStorage?.removeItem(key)),
    }
  : {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    };

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // No local DB, no offline storage — all queries go to Supabase directly
  realtime: { params: { eventsPerSecond: 10 } },
});
