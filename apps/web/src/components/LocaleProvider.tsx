'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@atlas/contracts';
import { LOCALE_COOKIE } from '@/lib/locale-shared';

// TRD §1.2 G2 / §2.5: locale context seeded from the server cookie. Switching
// persists via cookie + router.refresh(), which keeps the current URL (and any
// ?step= lesson state) intact.

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', setLocale: () => undefined });

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter();

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      // Keep assistive tech in sync immediately; server refresh re-renders copy.
      document.documentElement.setAttribute('lang', next);
      router.refresh();
    },
    [router],
  );

  const value = useMemo(() => ({ locale: initialLocale, setLocale }), [initialLocale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocaleContext(): LocaleContextValue {
  return useContext(LocaleContext);
}
