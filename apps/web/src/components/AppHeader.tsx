'use client';

import Link from 'next/link';
import type { Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { useLocaleContext } from './LocaleProvider';
import { LanguageSwitcher } from './LanguageSwitcher';

/** Global header: brand, language switcher, settings (TRD §2.2). */
export function AppHeader() {
  const { locale } = useLocaleContext();
  return (
    <header className="border-b border-line" style={{ background: 'var(--ab-surface)' }}>
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-bold text-lg text-action-text" style={{ color: 'var(--ab-action-text)' }}>
          ✦ {t(locale, 'brand')}
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            href="/settings"
            className="ab-btn ab-btn-ghost"
            style={{ background: 'transparent' }}
          >
            ⚙ {t(locale, 'nav.settings')}
          </Link>
        </div>
      </div>
    </header>
  );
}
