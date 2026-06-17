import React, { createContext, useContext, useState, useCallback } from 'react';
import { darkColors, lightColors } from '../theme/colors';

const ThemeContext = createContext({
  colors:      darkColors,
  isDark:      true,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true);
  const toggleTheme = useCallback(() => setIsDark(d => !d), []);
  const colors = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
