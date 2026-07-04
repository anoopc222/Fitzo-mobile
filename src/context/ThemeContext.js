import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors } from '../theme/colors';

const STORAGE_KEY = 'fitzo:theme';

export const ThemeContext = createContext({
  colors:      darkColors,
  isDark:      true,
  ready:       false,
  toggleTheme: () => {},
  setIsDark:   () => {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored === 'dark' || stored === 'light') {
        setIsDark(stored === 'dark');
      }
      setReady(true);
    });
  }, []);

  const applyIsDark = useCallback((value) => {
    setIsDark(value);
    AsyncStorage.setItem(STORAGE_KEY, value ? 'dark' : 'light');
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark(d => {
      const next = !d;
      AsyncStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const colors = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors, isDark, ready, toggleTheme, setIsDark: applyIsDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
