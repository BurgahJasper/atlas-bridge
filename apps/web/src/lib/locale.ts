import { cookies } from 'next/headers';
import type { Locale } from '@atlas/contracts';
import { LOCALE_COOKIE, REDUCED_MOTION_COOKIE, normalizeLocale } from './locale-shared';

// TRD §1.2 G2: locale persists via cookie 'ab-locale'; extensible, not route-based.

export { LOCALE_COOKIE, REDUCED_MOTION_COOKIE, ANON_ID_COOKIE, normalizeLocale } from './locale-shared';

/** Server helper: read locale from cookies (async in Next 15), default 'en'. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

/** Server helper: explicit reduced-motion user setting, or null when unset. */
export async function getReducedMotion(): Promise<boolean> {
  const store = await cookies();
  return store.get(REDUCED_MOTION_COOKIE)?.value === 'true';
}
