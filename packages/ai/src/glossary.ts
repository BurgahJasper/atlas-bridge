// Multilingual terminology glossary — TRD §1.2 G2, FR-11
// ("Adaptive difficulty, multilingual terminology glossary"). Identifiers,
// SHAs and paths are NEVER translatable: they surface via `untranslatedTerms`
// instead (TRD §5.2 translation invariants).

import type { GlossaryTerm, Locale } from '@atlas/contracts';

export const DEFAULT_GLOSSARY: GlossaryTerm[] = [
  { term: 'commit', translations: { en: 'commit', es: 'confirmación (commit)' }, kind: 'concept' },
  { term: 'branch', translations: { en: 'branch', es: 'rama' }, kind: 'concept' },
  { term: 'merge', translations: { en: 'merge', es: 'fusión (merge)' }, kind: 'concept' },
  { term: 'pull request', translations: { en: 'pull request', es: 'solicitud de cambios (pull request)' }, kind: 'concept' },
  { term: 'diff', translations: { en: 'diff', es: 'diferencias (diff)' }, kind: 'concept' },
  { term: 'dependency', translations: { en: 'dependency', es: 'dependencia' }, kind: 'concept' },
  { term: 'refactor', translations: { en: 'refactor', es: 'refactorización' }, kind: 'concept' },
  { term: 'release', translations: { en: 'release', es: 'versión publicada (release)' }, kind: 'concept' },
  { term: 'provenance', translations: { en: 'provenance', es: 'procedencia' }, kind: 'concept' },
  { term: 'sandbox', translations: { en: 'sandbox', es: 'entorno aislado (sandbox)' }, kind: 'concept' },
  { term: 'runtime', translations: { en: 'runtime', es: 'entorno de ejecución' }, kind: 'library' },
  { term: 'module', translations: { en: 'module', es: 'módulo' }, kind: 'library' },
];

const INDEX: Map<string, GlossaryTerm> = new Map(
  DEFAULT_GLOSSARY.map((t) => [t.term.trim().toLowerCase(), t]),
);

/** Case-insensitive glossary lookup; null when the term is not known. */
export function lookupTerm(term: string): GlossaryTerm | null {
  return INDEX.get(term.trim().toLowerCase()) ?? null;
}

/** Preferred translation for a locale, or null when absent (locale fallback is the caller's job). */
export function glossaryTranslation(term: GlossaryTerm, locale: Locale): string | null {
  return term.translations[locale] ?? null;
}
