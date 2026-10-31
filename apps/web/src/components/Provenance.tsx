'use client';

import type { Claim, Locale } from '@atlas/contracts';
import { t } from '@/lib/i18n';
import { commitUrl, fileUrl, type RepoRef } from '@/lib/slug';
import { Badge } from './ui';

/**
 * Provenance components (TRD §2.3 Feedback row, FR-03): basis, confidence and
 * citations are always visible with claims; links are derived ONLY from
 * evidenceRefs (never fabricated). Tooltips are never the sole carrier — every
 * chip shows its basis/confidence as visible text too.
 */

export function EvidenceChips({
  claim,
  repoRef,
  locale,
}: {
  claim: Claim;
  repoRef: RepoRef;
  locale: Locale;
}) {
  const refs = claim.evidenceRefs ?? [];
  if (refs.length === 0) {
    return <p className="text-xs text-muted">{t(locale, 'provenance.citationNone')}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t(locale, 'a11y.evidenceList')}>
      {refs.map((ref, index) => {
        const href = ref.url ?? (ref.path ? fileUrl(repoRef, ref.sha, ref.path, ref.startLine, ref.endLine) : commitUrl(repoRef, ref.sha));
        const label = ref.path ? `${ref.path}${ref.startLine ? `:${ref.startLine}` : ''}` : ref.sha.slice(0, 10);
        return (
          <li key={`${index}-${ref.sha}-${ref.path ?? ''}`}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="ab-badge ab-mono"
              style={{
                background: 'var(--ab-action-soft)',
                color: 'var(--ab-action-text)',
                textDecoration: 'underline',
              }}
              title={`${t(locale, 'provenance.citationTitle')}: ${href}`}
            >
              <span aria-hidden="true">⌗</span>
              {label}
              {!ref.path ? ` (${t(locale, 'history.commitLink')})` : ''}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function ClaimCard({
  claim,
  repoRef,
  locale,
  headingLevel = 4,
}: {
  claim: Claim;
  repoRef: RepoRef;
  locale: Locale;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  const basisKey = claim.basis === 'explicit' ? 'provenance.basisExplicit' : 'provenance.basisInferred';
  const basisTitle = claim.basis === 'explicit' ? 'provenance.basisExplicitTitle' : 'provenance.basisInferredTitle';
  const cap = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
  return (
    <li className="ab-card p-4">
      <Heading className="text-sm font-semibold ab-prose">{claim.text}</Heading>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge tone={claim.basis === 'explicit' ? 'action' : 'history'} title={t(locale, basisTitle)}>
          {t(locale, basisKey)}
        </Badge>
        <Badge tone={claim.confidence === 'high' ? 'success' : claim.confidence === 'medium' ? 'warning' : 'error'}>
          {t(locale, `provenance.confidence${cap(claim.confidence)}`)}
        </Badge>
      </div>
      {claim.evidenceRefs.length > 0 ? (
        <div className="mt-3">
          <EvidenceChips claim={claim} repoRef={repoRef} locale={locale} />
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">{t(locale, 'provenance.uncitedNotice')}</p>
      )}
    </li>
  );
}

export function ClaimList({
  claims,
  repoRef,
  locale,
  emptyKey = 'provenance.citationNone',
}: {
  claims: Claim[];
  repoRef: RepoRef;
  locale: Locale;
  emptyKey?: string;
}) {
  if (claims.length === 0) {
    return <p className="text-sm text-muted">{t(locale, emptyKey)}</p>;
  }
  return (
    <ul className="grid gap-3">
      {claims.map((claim, index) => (
        <ClaimCard key={index} claim={claim} repoRef={repoRef} locale={locale} />
      ))}
    </ul>
  );
}
