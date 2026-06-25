import React, { createContext, useContext, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_PREFIX = 'fitzo:onboarding:';

const OnboardingContext = createContext(null);

// Screens call startTour(id, steps) once their content has rendered. Each
// step is { ref: React.RefObject, title, description }. A tour only ever
// shows once per device — completion/skip is persisted to AsyncStorage
// under STORAGE_PREFIX + id.
export function OnboardingProvider({ children }) {
  const [tour, setTour] = useState(null); // { id, steps, index }

  const startTour = useCallback(async (id, steps) => {
    if (!steps?.length) return;
    const seen = await AsyncStorage.getItem(STORAGE_PREFIX + id);
    if (seen) return;
    setTour({ id, steps, index: 0 });
  }, []);

  const finish = useCallback((id) => {
    if (id) AsyncStorage.setItem(STORAGE_PREFIX + id, '1').catch(() => {});
    setTour(null);
  }, []);

  const next = useCallback(() => {
    setTour((t) => {
      if (!t) return t;
      if (t.index + 1 >= t.steps.length) {
        AsyncStorage.setItem(STORAGE_PREFIX + t.id, '1').catch(() => {});
        return null;
      }
      return { ...t, index: t.index + 1 };
    });
  }, []);

  const skip = useCallback(() => {
    setTour((t) => {
      if (t) AsyncStorage.setItem(STORAGE_PREFIX + t.id, '1').catch(() => {});
      return null;
    });
  }, []);

  // Dev/testing helper — not wired into any UI by default.
  const resetTour = useCallback((id) => AsyncStorage.removeItem(STORAGE_PREFIX + id), []);

  return (
    <OnboardingContext.Provider value={{ tour, startTour, next, skip, finish, resetTour }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export const useOnboarding = () => useContext(OnboardingContext);
