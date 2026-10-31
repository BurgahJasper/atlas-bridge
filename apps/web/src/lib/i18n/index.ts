import type { Locale } from '@atlas/contracts';
import { en, type Dictionary } from './dictionaries/en';
import { es } from './dictionaries/es';

// TRD §1.2 G2: tiny typed dictionary accessor; extensible without hardcoded bilingual strings.

const DICTIONARIES: Record<Locale, Dictionary> = { en, es };

type Vars = Record<string, string | number>;

function lookup(dict: unknown, segments: string[]): unknown {
  let cur: unknown = dict;
  for (const seg of segments) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/**
 * Translate by dot path, e.g. t(locale, 'overview.startHere', { repo: 'x' }).
 * Falls back to English, then to the key itself — never throws.
 */
export function t(locale: Locale, key: string, vars?: Vars): string {
  const segments = key.split('.');
  const value = lookup(DICTIONARIES[locale], segments) ?? lookup(DICTIONARIES.en, segments);
  if (typeof value !== 'string') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[atlas/web i18n] missing key: ${key}`);
    }
    return key;
  }
  return interpolate(value, vars);
}

export type { Dictionary };
export { DICTIONARIES };
