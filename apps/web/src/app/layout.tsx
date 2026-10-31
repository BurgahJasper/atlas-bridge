import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { getLocale, getReducedMotion } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { LocaleProvider } from '@/components/LocaleProvider';
import { AppHeader } from '@/components/AppHeader';
import { AppFooter } from '@/components/AppFooter';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Atlas Bridge — open-source repositories as time-travel stories',
    template: '%s · Atlas Bridge',
  },
  description:
    'Understand any open-source codebase in your own language: visual Git-history stories that teach how software evolved, and guide you to your first real contribution.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const reducedMotion = await getReducedMotion();

  return (
    <html lang={locale} data-ab-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <body className="flex min-h-screen flex-col">
        <LocaleProvider initialLocale={locale}>
          <a href="#main" className="ab-skip-link">
            {t(locale, 'nav.skipToContent')}
          </a>
          <AppHeader />
          <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8">
            {children}
          </main>
          <AppFooter locale={locale} />
        </LocaleProvider>
      </body>
    </html>
  );
}
