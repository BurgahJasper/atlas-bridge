import type { GlossaryTerm } from '@atlas/contracts';
import { DEFAULT_GLOSSARY } from '@atlas/ai';

/**
 * Glossary sourcing (FR-11, TRD §2.3 Language row). DEFAULT_GLOSSARY ships
 * from packages/ai; story.untranslatedTerms select which entries to surface.
 */
export function glossaryForTerms(terms: string[]): GlossaryTerm[] {
  if (!Array.isArray(DEFAULT_GLOSSARY)) return [];
  const wanted = new Set(terms.map((term) => term.toLowerCase()));
  return (DEFAULT_GLOSSARY as GlossaryTerm[]).filter((entry) => wanted.has(entry.term.toLowerCase()));
}

/** Fallback pseudo-entries for story terms the glossary does not cover. */
export function fallbackEntries(terms: string[], covered: GlossaryTerm[], locale: 'en' | 'es'): GlossaryTerm[] {
  const coveredKeys = new Set(covered.map((c) => c.term.toLowerCase()));
  return terms
    .filter((term) => !coveredKeys.has(term.toLowerCase()))
    .map((term) => ({
      term,
      translations: {
        [locale]: locale === 'es' ? 'Término del código — se mantiene en el idioma original.' : 'Code term — kept in its original form.',
      },
      kind: 'concept',
    }));
}
