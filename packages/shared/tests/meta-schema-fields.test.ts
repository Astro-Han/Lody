import { describe, expect, it } from 'vitest';

import {
  findLastAssistantEntryForUserTurn,
  isAssistantEntryOwnedByTurn,
  resolveActiveAssistantTurnId,
  type MachineMeta,
  type SessionMeta,
} from '../src/schema';

describe('meta schema fields', () => {
  it('keeps legacy session meta shape readable', () => {
    const legacy: SessionMeta = {
      id: 'session-1',
      machineId: 'machine-1',
      createdAt: '2026-03-19T00:00:00.000Z',
      userId: 'user-1',
      cliType: 'builtin',
      agentType: 'codex',
    };

    expect(legacy.latestUserMsgId).toBeUndefined();
    expect(legacy.lastCanceledTurn).toBeUndefined();
    expect(legacy.lastHandledUserMsgId).toBeUndefined();
    expect(legacy.processingUserMsgId).toBeUndefined();
    expect(legacy.lastMissingHistoryUserMsgId).toBeUndefined();
  });

  it('accepts dispatch-driven session meta fields', () => {
    const meta: SessionMeta = {
      id: 'session-2',
      machineId: 'machine-2',
      createdAt: '2026-03-19T00:00:00.000Z',
      userId: 'user-2',
      cliType: 'builtin',
      agentType: 'codex',
      latestUserMsgId: 'turn-2',
      lastCanceledTurn: 'assistant-turn-2',
      lastHandledUserMsgId: 'turn-1',
      processingUserMsgId: 'turn-2',
      lastMissingHistoryUserMsgId: 'turn-missing',
    };

    expect(meta.latestUserMsgId).toBe('turn-2');
    expect(meta.lastCanceledTurn).toBe('assistant-turn-2');
    expect(meta.lastHandledUserMsgId).toBe('turn-1');
    expect(meta.processingUserMsgId).toBe('turn-2');
    expect(meta.lastMissingHistoryUserMsgId).toBe('turn-missing');
  });

  it('keeps deleted bulky legacy fields out of writable session meta', () => {
    const base = {
      id: 'session-legacy',
      machineId: 'machine-legacy',
      createdAt: '2026-03-19T00:00:00.000Z',
      userId: 'user-legacy',
      cliType: 'builtin',
      agentType: 'codex',
    } satisfies SessionMeta;

    const compactDiffStats = {
      ...base,
      diffStats: { allChange: { add: 1, del: 2 } },
    } satisfies SessionMeta;
    expect(compactDiffStats.diffStats.allChange).toEqual({ add: 1, del: 2 });

    const legacyDispatchError = {
      ...base,
      // @ts-expect-error dispatchError is a deleted legacy session meta field.
      dispatchError: { code: 'dispatch_failed', at: 1 },
    } satisfies SessionMeta;
    expect((legacyDispatchError as Record<string, unknown>).dispatchError).toBeDefined();

    const legacyCancelMarker = {
      ...base,
      // @ts-expect-error cancelRequestedAt is a deleted legacy session meta field.
      cancelRequestedAt: 1,
    } satisfies SessionMeta;
    expect((legacyCancelMarker as Record<string, unknown>).cancelRequestedAt).toBe(1);

    const legacyDiffStats = {
      ...base,
      diffStats: {
        allChange: { add: 1, del: 2 },
        // @ts-expect-error path-level diffStats metadata was removed.
        files: [],
      },
    } satisfies SessionMeta;
    expect((legacyDiffStats.diffStats as Record<string, unknown>).files).toEqual([]);
  });

  it('resolves the latest unfinished assistant turn id from history', () => {
    expect(
      resolveActiveAssistantTurnId([
        {
          id: 'assistant-turn-1',
          role: 'assistant',
          finished: true,
          endedAt: 123,
        },
        {
          id: 'assistant-turn-2',
          role: 'assistant',
        },
      ])
    ).toBe('assistant-turn-2');

    expect(
      resolveActiveAssistantTurnId([
        {
          id: 'assistant-turn-3',
          role: 'assistant',
          finished: true,
          endedAt: 456,
        },
      ])
    ).toBeUndefined();
  });

  it('reports the owning turn id for a split turn, not the continuation entry id', () => {
    // Plan approval finishes the plan entry and continues the SAME turn in a
    // continuation entry, so Stop/steer must still address `assistant-turn-1`.
    expect(
      resolveActiveAssistantTurnId([
        {
          id: 'assistant-turn-1',
          role: 'assistant',
          finished: true,
          endedAt: 123,
        },
        {
          id: 'assistant-turn-1#exec',
          role: 'assistant',
          ownerTurnId: 'assistant-turn-1',
        },
      ])
    ).toBe('assistant-turn-1');
  });

  it('finds the last assistant entry of a user turn', () => {
    const history = [
      { id: 'user-1', role: 'user' as const },
      { id: 'assistant-turn-1', role: 'assistant' as const, userTurnId: 'user-1', endedAt: 1 },
      {
        id: 'assistant-turn-1#exec',
        role: 'assistant' as const,
        userTurnId: 'user-1',
        ownerTurnId: 'assistant-turn-1',
      },
    ];

    expect(findLastAssistantEntryForUserTurn(history, 'user-1')?.id).toBe('assistant-turn-1#exec');
    expect(findLastAssistantEntryForUserTurn(history, 'user-2')).toBeUndefined();
  });

  it('recognizes both entries of a split turn as owned by that turn', () => {
    expect(
      isAssistantEntryOwnedByTurn({ id: 'assistant-turn-1', role: 'assistant' }, 'assistant-turn-1')
    ).toBe(true);
    expect(
      isAssistantEntryOwnedByTurn(
        { id: 'assistant-turn-1#exec', role: 'assistant', ownerTurnId: 'assistant-turn-1' },
        'assistant-turn-1'
      )
    ).toBe(true);
    expect(
      isAssistantEntryOwnedByTurn({ id: 'user-1', role: 'user' }, 'assistant-turn-1')
    ).toBe(false);
  });

  it('accepts machine rpc capability fields', () => {
    const machine: MachineMeta = {
      id: 'machine-1',
      name: 'Machine',
      cliVersion: '0.0.0',
      os: 'linux',
      sessions: [],
      rpcVersion: '0',
    };

    expect(machine.rpcVersion).toBe('0');
  });
});
