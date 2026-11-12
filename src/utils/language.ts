import { useState, useEffect, useCallback } from 'react';

export type AppLanguage = 'id' | 'en';

export const LANGUAGE_STORAGE_KEY = 'tradevault_language_v1';
export const LANGUAGE_EVENT_NAME = 'tradevault-language-change';

export function getAppLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'id';
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'id') {
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return 'id';
}

export function setAppLanguage(lang: AppLanguage): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore storage errors
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT_NAME, { detail: lang }));
}

export function initLanguage(): AppLanguage {
  const current = getAppLanguage();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
  }
  return current;
}

export function useLanguage() {
  const [language, setLanguageState] = useState<AppLanguage>(() => getAppLanguage());

  useEffect(() => {
    const handleLanguageChange = (e: Event) => {
      const custom = e as CustomEvent<AppLanguage>;
      const next = custom.detail || getAppLanguage();
      setLanguageState(next);
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LANGUAGE_STORAGE_KEY) {
        setLanguageState(getAppLanguage());
      }
    };

    window.addEventListener(LANGUAGE_EVENT_NAME, handleLanguageChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT_NAME, handleLanguageChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setLanguage = useCallback((next: AppLanguage) => {
    setAppLanguage(next);
    setLanguageState(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    const next: AppLanguage = getAppLanguage() === 'id' ? 'en' : 'id';
    setLanguage(next);
  }, [setLanguage]);

  const tr = useCallback(
    <T = string>(idText: T, enText: T): T => {
      return language === 'en' ? enText : idText;
    },
    [language]
  );

  return {
    language,
    isId: language === 'id',
    isEn: language === 'en',
    locale: language === 'en' ? 'en-US' : 'id-ID',
    setLanguage,
    toggleLanguage,
    tr,
  };
}
