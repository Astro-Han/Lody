import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_SRC = fileURLToPath(new URL('../src', import.meta.url));

const collectTypeScriptFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectTypeScriptFiles(full);
    }
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });

/** Prose may name the comparison; only executable code is in scope. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** A direct comparison of the two dispatch pointers, in either order. */
const RAW_POINTER_COMPARISON =
  /(latestUserMsgId|lastHandledUserMsgId)\s*!==\s*[\w.?]*\.?(lastHandledUserMsgId|latestUserMsgId)/;

describe('dispatch activation predicate', () => {
  it('is the only thing in the CLI that compares the dispatch pointers', () => {
    // Two suppression slots — `lastMissingHistoryUserMsgId` and
    // `settledActivationUserMsgId` — retire an activation WITHOUT rewriting the
    // producer-owned pointers, because there is no CAS against the LWW map. A
    // consumer that compares the pointers directly therefore sees pending work
    // forever: auto review waits on a session that will never finish, idle GC
    // refuses to reclaim it, and MCP reports a queued turn that does not exist.
    // Unit tests on today's consumers cannot catch a NEW one, so this guards the
    // shape instead. Route new consumers through `hasPendingUserTurnActivation`.
    const offenders = collectTypeScriptFiles(CLI_SRC)
      .filter((file) => RAW_POINTER_COMPARISON.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(CLI_SRC.length + 1));

    expect(
      offenders,
      'derive pending work through `hasPendingUserTurnActivation` from @lody/shared'
    ).toEqual([]);
  });
});
