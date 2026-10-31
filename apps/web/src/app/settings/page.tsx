import type { Metadata } from 'next';
import type { Locale } from '@atlas/contracts';
import { getLocale, getReducedMotion, REDUCED_MOTION_COOKIE } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { getPublicModelDisclosure } from '@/lib/env';
import { ReducedMotionSetting, ModelSourcePanel } from '@/components/SettingsPanels';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Locale, reduced motion, privacy and model-source disclosure.',
};

// TRD §2.2 /settings: locale, accessibility (reduced motion), privacy and
// model-source display. The privacy/model text is composed server-side so no
// env value is evaluated in client bundles (TRD §7).

export default async function SettingsPage() {
  const locale: Locale = await getLocale();
  const reducedMotion = await getReducedMotion();
  const disclosure = getPublicModelDisclosure();

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="prefs-heading" className="grid content-start gap-6">
        <h1 id="prefs-heading" className="ab-display">
          {t(locale, 'settings.heading')}
        </h1>
        <p className="ab-prose text-muted">{t(locale, 'settings.intro')}</p>

        <div className="ab-card p-6">
          <h2 className="ab-title">{t(locale, 'settings.localeLabel')}</h2>
          <div className="mt-3">
            <LanguageSwitcher />
          </div>
        </div>

        <div className="ab-card p-6">
          <h2 className="ab-title">{t(locale, 'settings.reducedMotionLabel')}</h2>
          <div className="mt-3">
            <ReducedMotionSetting initial={reducedMotion} key={REDUCED_MOTION_COOKIE} locale={locale} />
          </div>
        </div>
      </section>

      <div className="grid content-start gap-6">
        <section aria-labelledby="privacy-heading" className="ab-card p-6">
          <h2 id="privacy-heading" className="ab-title">
            {t(locale, 'settings.privacyHeading')}
          </h2>
          <p className="ab-prose text-muted mt-2 text-sm">{t(locale, 'settings.privacyBody')}</p>
        </section>

        <ModelSourcePanel locale={locale} disclosure={disclosure} />
      </div>
    </div>
  );
}
