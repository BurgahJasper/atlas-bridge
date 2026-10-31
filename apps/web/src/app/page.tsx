import type { Metadata } from 'next';
import { getLocale } from '@/lib/locale';
import { t } from '@/lib/i18n';
import { getPipeline } from '@/lib/pipeline';
import { CURATED_SLUG } from '@/lib/curated';
import { ExploreForm } from '@/components/ExploreForm';
import { githubUrlFor, type RepoRef } from '@/lib/slug';

export const metadata: Metadata = {
  title: 'Atlas Bridge — explore open-source repositories',
  description: 'Two demo paths: the curated offline repository, or paste any public GitHub URL.',
};

// TRD §2.2 '/': acquisition & discovery — hero, two demo paths, GitHub URL
// form, locale selector (global in header), trust statements.

const TRUST_KEYS = [
  ['trust.publicOnlyLabel', 'trust.publicOnlyBody'],
  ['trust.provenanceLabel', 'trust.provenanceBody'],
  ['trust.licenseLabel', 'trust.licenseBody'],
  ['trust.modelLabel', 'trust.modelBody'],
] as const;

export default async function HomePage() {
  const locale = await getLocale();
  let curatedAvailable = true;
  try {
    // Pipeline presence check only; keeps the curated path honest when the
    // pipeline package fails to wire up.
    await getPipeline().healthz();
  } catch {
    curatedAvailable = false;
  }

  const repoRef: RepoRef = { owner: 'octokit', name: 'request.js' };

  return (
    <div className="grid gap-12">
      <section aria-labelledby="hero-title">
        <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--ab-action-text)' }}>
          {t(locale, 'brand')}
        </p>
        <h1 id="hero-title" className="ab-display mt-2 max-w-3xl">
          {t(locale, 'hero.title')}
        </h1>
        <p className="ab-prose text-muted mt-4 text-lg">{t(locale, 'hero.subtitle')}</p>
      </section>

      <section aria-labelledby="demo-paths">
        <h2 id="demo-paths" className="sr-only">
          {t(locale, 'trust.licenseBody')}
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="ab-card p-6">
            <h3 className="ab-title">{t(locale, 'hero.curatedTitle')}</h3>
            <p className="ab-prose text-muted mt-2">{t(locale, 'hero.curatedBody')}</p>
            <p className="ab-mono mt-3 text-muted">
              <a
                href={githubUrlFor(repoRef)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {githubUrlFor(repoRef)}
              </a>
            </p>
          </div>
          <div className="ab-card p-6">
            <h3 className="ab-title">{t(locale, 'hero.pasteTitle')}</h3>
            <p className="ab-prose text-muted mt-2">{t(locale, 'hero.pasteBody')}</p>
            <div className="mt-4">
              <ExploreForm locale={locale} curatedSlug={CURATED_SLUG} curatedAvailable={curatedAvailable} />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-heading">
        <h2 id="trust-heading" className="ab-title">
          {t(locale, 'trust.heading')}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TRUST_KEYS.map(([labelKey, bodyKey]) => (
            <li key={labelKey} className="ab-card p-4">
              <h3 className="font-semibold">{t(locale, labelKey)}</h3>
              <p className="ab-prose text-muted mt-1 text-sm">{t(locale, bodyKey)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
