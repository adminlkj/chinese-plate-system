'use client';

import React, { createContext, useContext, useMemo, useEffect } from 'react';
import ar from './translations/ar';
import en from './translations/en';
import type { Translations } from './translations/ar';
import { useAppStore } from '@/lib/store';

export type Locale = 'ar' | 'en';

const translationsMap: Record<Locale, Translations> = { ar, en };

interface I18nContextType {
  locale: Locale;
  t: Translations;
  dir: 'rtl' | 'ltr';
  setLocale: (locale: Locale) => void;
  isRTL: boolean;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'ar',
  t: ar,
  dir: 'rtl',
  setLocale: () => {},
  isRTL: true,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { locale, setLocale } = useAppStore();

  const dir: 'rtl' | 'ltr' = locale === 'ar' ? 'rtl' : 'ltr';
  const t = translationsMap[locale];
  const isRTL = locale === 'ar';

  // Update document attributes when locale changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = dir;
    }
  }, [locale, dir]);

  const value = useMemo(
    () => ({ locale, t, dir, setLocale, isRTL }),
    [locale, t, dir, setLocale, isRTL]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}

export type { Translations };
