// Localized learner feedback strings — TRD §1.2 G2 ("locale system, not
// hardcoded bilingual strings"): keys map per-locale; new locales extend the
// dictionary, not the call sites.
import type { Locale } from '@atlas/contracts';

export const UI_CUES = {
  passedKey: 'mission.feedback.passed',
  failedKey: 'mission.feedback.retry',
} as const;

export type FeedbackKey =
  | 'correct'
  | 'try-again'
  | 'missing-answer'
  | 'answer-too-short'
  | 'missing-key-terms'
  | 'file-not-found'
  | 'forbidden-content'
  | 'regex-mismatch'
  | 'invalid-pattern'
  | 'unknown-step';

const FEEDBACK: Record<FeedbackKey, Record<Locale, string>> = {
  correct: {
    en: 'Correct — this step is complete.',
    es: 'Correcto: este paso está completo.',
  },
  'try-again': {
    en: 'Not quite — review the step and try again.',
    es: 'No es exactamente así: revisa el paso e inténtalo de nuevo.',
  },
  'missing-answer': {
    en: 'No answer was submitted for this step.',
    es: 'No se envió respuesta para este paso.',
  },
  'answer-too-short': {
    en: 'Your answer is too short; add a bit more detail and retry.',
    es: 'Tu respuesta es demasiado corta; añade un poco más de detalle y reintenta.',
  },
  'missing-key-terms': {
    en: 'Your answer is missing key terms ({found}/{total} found); try again.',
    es: 'Tu respuesta no incluye todos los términos clave ({found}/{total}); inténtalo de nuevo.',
  },
  'file-not-found': {
    en: 'The expected file was not found in your submission.',
    es: 'No se encontró el archivo esperado en tu envío.',
  },
  'forbidden-content': {
    en: 'The edited file contains text that is not allowed there; revise your change.',
    es: 'El archivo editado contiene texto no permitido; revisa tu cambio.',
  },
  'regex-mismatch': {
    en: 'The file does not match the expected structure yet; re-read the step instructions.',
    es: 'El archivo todavía no coincide con la estructura esperada; vuelve a leer las instrucciones del paso.',
  },
  'invalid-pattern': {
    en: 'This step has an invalid validation pattern; it is reported as failed.',
    es: 'Este paso tiene un patrón de validación no válido; se informa como fallido.',
  },
  'unknown-step': {
    en: 'Unknown mission or step.',
    es: 'Misión o paso desconocido.',
  },
};

/** Generic localized feedback; `{var}` placeholders are filled from `vars`. */
export function feedbackFor(
  key: FeedbackKey,
  locale: Locale = 'en',
  vars?: Record<string, string | number>,
): string {
  const label = FEEDBACK[key][locale];
  if (!vars) return label;
  return label.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
