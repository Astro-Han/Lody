import { describe, expect, it } from 'vitest';
import {
  formatSessionTabSearch,
  parseSessionTabSearch,
  resolveActiveSessionTab,
  shouldClearSessionUrlTab,
} from '../src/lib/session-tab-url';

const parentSessionId = 'parent-session-id';

describe('parseSessionTabSearch', () => {
  it('returns missing when tab is absent', () => {
    expect(parseSessionTabSearch(undefined)).toEqual({ kind: 'missing' });
  });

  it('parses a child session tab', () => {
    expect(parseSessionTabSearch('session:child-session-id')).toEqual({
      kind: 'session',
      sessionId: 'child-session-id',
    });
  });

  it('parses a draft tab as its full draft tab id', () => {
    expect(parseSessionTabSearch('draft:draft-uuid')).toEqual({
      kind: 'draft',
      draftId: 'draft:draft-uuid',
    });
  });

  it('treats empty and malformed values as invalid', () => {
    expect(parseSessionTabSearch('')).toEqual({ kind: 'invalid' });
    expect(parseSessionTabSearch('session:')).toEqual({ kind: 'invalid' });
    expect(parseSessionTabSearch('draft:')).toEqual({ kind: 'invalid' });
    expect(parseSessionTabSearch('viewer:file:src/index.ts')).toEqual({ kind: 'invalid' });
  });
});

describe('formatSessionTabSearch', () => {
  it('omits the parent session tab from the URL', () => {
    expect(formatSessionTabSearch(parentSessionId, parentSessionId)).toBeUndefined();
  });

  it('formats a child session tab', () => {
    expect(formatSessionTabSearch('child-session-id', parentSessionId)).toBe(
      'session:child-session-id'
    );
  });

  it('keeps a draft tab id verbatim', () => {
    expect(formatSessionTabSearch('draft:draft-uuid', parentSessionId)).toBe('draft:draft-uuid');
  });

  it('round-trips through parseSessionTabSearch', () => {
    expect(parseSessionTabSearch(formatSessionTabSearch('child-id', parentSessionId))).toEqual({
      kind: 'session',
      sessionId: 'child-id',
    });
    expect(parseSessionTabSearch(formatSessionTabSearch('draft:d1', parentSessionId))).toEqual({
      kind: 'draft',
      draftId: 'draft:d1',
    });
    expect(parseSessionTabSearch(formatSessionTabSearch(parentSessionId, parentSessionId))).toEqual(
      { kind: 'missing' }
    );
  });
});

describe('resolveActiveSessionTab', () => {
  const context = {
    parentSessionId,
    childSessionIds: ['child-a', 'child-b'],
    draftTabIds: ['draft:d1'],
  };

  it('resolves a missing tab to the parent (external navigation stripping ?tab converges)', () => {
    // #193: navigation that removes `?tab` while a child was active must
    // settle at the parent with no bounce-back write.
    expect(resolveActiveSessionTab({ kind: 'missing' }, context)).toBe(parentSessionId);
    expect(
      shouldClearSessionUrlTab({ kind: 'missing' }, { ...context, childSessionsResolved: true })
    ).toBe(false);
  });

  it('activates a known child session', () => {
    expect(resolveActiveSessionTab({ kind: 'session', sessionId: 'child-a' }, context)).toBe(
      'child-a'
    );
  });

  it('activates a known draft tab', () => {
    expect(resolveActiveSessionTab({ kind: 'draft', draftId: 'draft:d1' }, context)).toBe(
      'draft:d1'
    );
  });

  it('falls back to the parent for unresolved children, drafts, and invalid values', () => {
    expect(resolveActiveSessionTab({ kind: 'session', sessionId: 'gone' }, context)).toBe(
      parentSessionId
    );
    expect(resolveActiveSessionTab({ kind: 'draft', draftId: 'draft:gone' }, context)).toBe(
      parentSessionId
    );
    expect(resolveActiveSessionTab({ kind: 'invalid' }, context)).toBe(parentSessionId);
  });

  it('normalizes an explicit parent tab value', () => {
    expect(resolveActiveSessionTab({ kind: 'session', sessionId: parentSessionId }, context)).toBe(
      parentSessionId
    );
  });
});

describe('shouldClearSessionUrlTab', () => {
  const context = {
    parentSessionId,
    childSessionIds: ['child-a'],
    draftTabIds: ['draft:d1'],
    childSessionsResolved: true,
  };

  it('never clears a missing value (clearing converges)', () => {
    expect(shouldClearSessionUrlTab({ kind: 'missing' }, context)).toBe(false);
  });

  it('clears invalid and redundant parent values', () => {
    expect(shouldClearSessionUrlTab({ kind: 'invalid' }, context)).toBe(true);
    expect(shouldClearSessionUrlTab({ kind: 'session', sessionId: parentSessionId }, context)).toBe(
      true
    );
  });

  it('keeps an unresolved child while child meta is still loading', () => {
    // A slow meta cache must never strip a valid child tab: the tab renders
    // the parent as a fallback, but the URL keeps the user's intent.
    expect(
      shouldClearSessionUrlTab(
        { kind: 'session', sessionId: 'child-still-loading' },
        { ...context, childSessionIds: [], childSessionsResolved: false }
      )
    ).toBe(false);
  });

  it('clears a child the resolved meta cache does not contain', () => {
    expect(shouldClearSessionUrlTab({ kind: 'session', sessionId: 'gone' }, context)).toBe(true);
  });

  it('clears an unpersisted draft and keeps a live one', () => {
    expect(shouldClearSessionUrlTab({ kind: 'draft', draftId: 'draft:d1' }, context)).toBe(false);
    expect(shouldClearSessionUrlTab({ kind: 'draft', draftId: 'draft:gone' }, context)).toBe(true);
  });
});
