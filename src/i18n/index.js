import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en.json';
import es from './locales/es.json';

export const STORAGE_KEY = 'fitzo:language';
export const SUPPORTED_LANGUAGES = ['en', 'es'];

const deviceLanguage = Localization.getLocales()[0]?.languageCode ?? 'en';
const fallbackLanguage = SUPPORTED_LANGUAGES.includes(deviceLanguage) ? deviceLanguage : 'en';

i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: fallbackLanguage,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

// Applies a user override saved from Settings, if one was previously chosen.
// Until this resolves, i18next runs with the device-locale guess above, so
// strings render immediately at app boot instead of waiting on AsyncStorage.
export async function loadStoredLanguage() {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LANGUAGES.includes(stored) && stored !== i18next.language) {
    await i18next.changeLanguage(stored);
  }
  return stored;
}

export async function setAppLanguage(lang) {
  if (lang == null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await i18next.changeLanguage(fallbackLanguage);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    await i18next.changeLanguage(lang);
  }
}

export default i18next;
