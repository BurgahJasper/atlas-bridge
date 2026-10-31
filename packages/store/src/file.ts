import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store } from '@atlas/contracts';
import { createMemoryStore } from './memory.js';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

/**
 * Zero-infrastructure durable store for local and demo use. Every write is
 * appended to a JSONL log and replayed on startup, so analyses, graphs,
 * missions and learner progress survive a restart without Postgres. The
 * Postgres backend (DATABASE_URL) remains the production path (TRD §6).
 */
export function createFileStore(logPath: string): Store {
  mkdirSync(dirname(logPath), { recursive: true });
  const memory = createMemoryStore() as unknown as Record<string, AnyFn>;

  const ready = (async () => {
    if (!existsSync(logPath)) return;
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as { op: string; args: unknown[] };
        await memory[entry.op]?.apply(memory, entry.args);
      } catch {
        // A torn final line after a crash is skipped; earlier entries stay valid.
      }
    }
  })();

  const store: Record<string, AnyFn> = {};
  for (const op of Object.keys(memory)) {
    const fn = memory[op]!;
    store[op] = async (...args: unknown[]) => {
      await ready;
      const result = await fn.apply(memory, args);
      if (op.startsWith('put')) {
        appendFileSync(logPath, `${JSON.stringify({ op, args })}\n`);
      }
      return result;
    };
  }
  return store as unknown as Store;
}
