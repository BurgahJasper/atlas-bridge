'use client';

import type { Locale } from '@atlas/contracts';
import { LOCALES } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { useLocaleContext } from './LocaleProvider';

/**
 * Persistent visible language switcher (TRD §2.3 Language row). Segmented
 * control, 44px targets, aria-pressed state; preserves the current URL.
 */
export function LanguageSwitcher() {
  const { locale, setLocale } = useLocaleContext();

  return (
    <div
      role="group"
      aria-label={t(locale, 'a11y.langSwitchLabel')}
      className="inline-flex overflow-hidden rounded-[10px] border border-line bg-surface"
    >
      {LOCALES.map((value) => {
        const active = value === locale;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => (active ? undefined : setLocale(value))}
            className="min-h-11 min-w-11 px-4 text-sm font-semibold"
            style={
              active
                ? { background: 'var(--ab-action)', color: 'var(--ab-surface)' }
                : { color: 'var(--ab-action-text)' }
            }
          >
            {value === 'en' ? 'EN' : 'ES'}
            <span className="sr-only"> — {value === 'en' ? 'English' : 'Español'}</span>
          </button>
        );
      })}
    </div>
  );
}
