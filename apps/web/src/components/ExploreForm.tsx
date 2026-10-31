'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { parseGitHubUrl } from '@/lib/slug';
import { apiJson } from '@/lib/client-api';
import { errorMessage, ApiError } from '@/lib/errors';
import { Button } from '@/components/ui';

interface AnalyzeResponse {
  jobId: string;
  slug: string | null;
}

/**
 * GitHub URL form on the acquisition page (FR-01): client-side URL sanity
 * check, POST /api/repos/analyze, then route to /explore/owner__name?job=…
 * where the loading UI polls /api/jobs/:id.
 */
export function ExploreForm({ locale, curatedSlug, curatedAvailable }: { locale: Locale; curatedSlug: string; curatedAvailable: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = parseGitHubUrl(url.trim());
    if (!parsed) {
      setError(t(locale, 'errors.formInvalidUrl'));
      return;
    }
    setBusy(true);
    try {
      const data = await apiJson<AnalyzeResponse>('/api/repos/analyze', {
        method: 'POST',
        body: JSON.stringify({ url: parsed.url, locale }),
      });
      const slug = data.slug ?? `${parsed.owner}__${parsed.name}`;
      router.push(`/explore/${slug}?job=${encodeURIComponent(data.jobId)}`);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof ApiError
          ? errorMessage(err, locale)
          : t(locale, 'analysis.submitError'),
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label htmlFor="gh-url" className="block text-sm font-semibold">
        {t(locale, 'hero.urlLabel')}
      </label>
      <input
        id="gh-url"
        className="ab-input"
        type="url"
        inputMode="url"
        autoComplete="url"
        spellCheck={false}
        placeholder={t(locale, 'hero.urlPlaceholder')}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      {error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--ab-error)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t(locale, 'hero.submitting') : t(locale, 'hero.submit')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push(`/explore/${curatedSlug}`)} disabled={!curatedAvailable}>
          {t(locale, 'hero.curatedCta')}
        </Button>
      </div>
      <p className="text-xs text-muted">{curatedAvailable ? 'octokit/request.js — pre-analyzed, works offline.' : 'octokit/request.js — curated fixture unavailable.'}</p>
    </form>
  );
}
