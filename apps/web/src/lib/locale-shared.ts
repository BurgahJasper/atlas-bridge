import type { Locale } from '@atlas/contracts';
import { LOCALES } from '@atlas/contracts';

// Client-safe locale constants (TRD §1.2 G2). Server-only helpers that read
// next/headers live in lib/locale.ts; never import that module from a client
// component — import this one instead.

export const LOCALE_COOKIE = 'ab-locale';
export const REDUCED_MOTION_COOKIE = 'ab-reduced-motion';
export const ANON_ID_COOKIE = 'ab-uid';

export function normalizeLocale(value: string | undefined | null): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : 'en';
}
