import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';

export const STORAGE_KEY = 'fitzo:language';

// Languages with full translation resources — strings render natively.
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'hi'];

// Full selectable list shown in Settings. Any code not in SUPPORTED_LANGUAGES
// still works (i18next's fallbackLng below fills in English for untranslated
// keys) — it just won't have native strings yet.
export const ALL_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ru', name: 'Русский' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'pl', name: 'Polski' },
  { code: 'sv', name: 'Svenska' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'mr', name: 'मराठी' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'id', name: 'Bahasa Indonesia' },
];

const ALL_LANGUAGE_CODES = ALL_LANGUAGES.map(l => l.code);

// Always boots in English. A user's saved choice (if any) is applied later
// by loadStoredLanguage once AsyncStorage resolves — see App.js.
const DEFAULT_LANGUAGE = 'en';

i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, fr: { translation: fr }, hi: { translation: hi } },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
});

// Applies a user override saved from Settings, if one was previously chosen.
// Until this resolves, i18next runs with the English default above, so
// strings render immediately at app boot instead of waiting on AsyncStorage.
export async function loadStoredLanguage() {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored && ALL_LANGUAGE_CODES.includes(stored) && stored !== i18next.language) {
    await i18next.changeLanguage(stored);
  }
  return stored;
}

export async function setAppLanguage(lang) {
  if (lang == null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await i18next.changeLanguage(DEFAULT_LANGUAGE);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
    await i18next.changeLanguage(lang);
  }
}

export default i18next;
