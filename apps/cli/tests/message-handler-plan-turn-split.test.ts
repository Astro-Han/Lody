import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoroRepo } from 'loro-repo';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

import {
  resolveActiveAssistantTurnId,
  type AcpSessionNotification,
  type SessionHistoryInput,
  type SessionId,
  type WorkspaceId,
} from '@lody/shared';

import { MessageHandler } from '../src/lib/message-handler';
import { SessionDocument } from '../src/lib/loro/doc';
import type { LoroDocumentManager } from '../src/lib/loro/doc';
import type { SessionManager } from '../src/session/session-manager';
import type { SessionDispatchSource } from '../src/session/session-execution-service';
import type { Logger } from '../src/utils/logger';
import { loadEnv } from '../src/utils/const';
import { createTestCloudPort } from './test-cloud-port';

const createSilentLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  success: () => {},
  debug: () => {},
  setLevel: () => {},
  child: () => createSilentLogger(),
  close: async () => {},
});

const originalLodyServerUrl = process.env.LODY_SERVER_URL;

type MessageHandlerHost = {
  beginConversationTurn(
    sessionId: SessionId,
    userTurnId?: string,
    gateContext?: { dispatchSource?: SessionDispatchSource; sessionDoc: SessionDocument }
  ): string;
  enqueueACPUpdate(sessionId: SessionId, update: AcpSessionNotification): void;
  createAssistantEntryForTurn(
    sessionId: SessionId,
    sessionDoc: SessionDocument,
    turnId: string,
    modelInfo: undefined,
    userTurnId?: string
  ): Promise<void>;
  rollAssistantEntryForPlanExit(
    sessionId: SessionId,
    request: RequestPermissionRequest,
    outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }
  ): Promise<void>;
  finalizeACPState(sessionId: SessionId, turnId?: string): Promise<void>;
};

// loro-repo resolves create()/destroy() on the real clock (native async), not the
// timers vitest fakes — run repo setup/teardown on real timers.
const destroyRepoOnRealTimers = async (repo: LoroRepo) => {
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
  await repo.destroy();
};

const createHandlerHarness = async (sessionId: SessionId) => {
  const logger = createSilentLogger();
  const fakeTimersActive = vi.isFakeTimers();
  if (fakeTimersActive) {
    vi.useRealTimers();
  }
  const repo = await LoroRepo.create({});
  const doc = new SessionDocument(repo, sessionId);
  await doc.initOffline();
  if (fakeTimersActive) {
    vi.useFakeTimers();
  }

  const workspaceDocument = {
    isTransportConnected: vi.fn(() => true),
    markMachineFlockDocDirty: vi.fn(),
    registerMachine: vi.fn(),
    repo: {
      watch: vi.fn(() => ({ unsubscribe: vi.fn() })),
      getDocMeta: vi.fn(async () => ({
        meta: { needToArchiveSessions: {}, needToDeleteSessions: {} },
      })),
    },
    getOrCreateSessionDoc: vi.fn(async () => doc),
  };
  const sessionManager = {
    on: vi.fn(),
    setRequestPermissionHandler: vi.fn(),
    getSession: vi.fn(() => null),
  };

  const handler = new MessageHandler(
    sessionManager as unknown as SessionManager,
    workspaceDocument as unknown as LoroDocumentManager,
    logger,
    {
      token: 't',
      workspaceId: 'ws-1' as WorkspaceId,
      userId: 'u-1',
      machineId: 'm-1',
      machineName: 'machine',
      cliVersion: '0.0.0',
      cloudPort: createTestCloudPort(),
    }
  );

  return { repo, doc, handler: handler as unknown as MessageHandlerHost };
};

const userEntry = (id: string): SessionHistoryInput => ({
  id,
  role: 'user',
  timestamp: new Date().toISOString(),
  read: false,
  userId: 'u-1',
  fileDiff: [],
  items: [{ type: 'text', text: 'plan this' }] as unknown as SessionHistoryInput['items'],
});

const agentChunk = (sessionId: SessionId, text: string): AcpSessionNotification => ({
  sessionId,
  update: {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text },
  },
});

const planExitToolCall = (sessionId: SessionId): AcpSessionNotification => ({
  sessionId,
  update: {
    sessionUpdate: 'tool_call',
    toolCallId: 'exit-plan-1',
    title: 'Exited Plan Mode',
    kind: 'switch_mode',
    status: 'pending',
  },
});

const planExitToolCallCompleted = (sessionId: SessionId): AcpSessionNotification => ({
  sessionId,
  update: {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'exit-plan-1',
    status: 'completed',
  },
});

const planExitPermission = (sessionId: SessionId): RequestPermissionRequest =>
  ({
    sessionId,
    toolCall: {
      toolCallId: 'exit-plan-1',
      title: 'Exited Plan Mode',
      kind: 'switch_mode',
    },
    options: [
      { optionId: 'proceed', name: 'Yes, and auto-accept edits', kind: 'allow_always' },
      { optionId: 'keep-planning', name: 'No, keep planning', kind: 'reject_once' },
    ],
  }) as unknown as RequestPermissionRequest;

const itemTexts = (entry: SessionHistoryInput | undefined): string[] =>
  ((entry?.items ?? []) as unknown as Array<{ type: string; text?: string }>)
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '');

const itemTypes = (entry: SessionHistoryInput | undefined): string[] =>
  ((entry?.items ?? []) as unknown as Array<{ type: string }>).map((item) => item.type);

/**
 * Approving a plan does NOT end the ACP turn, so without a split the plan and
 * the whole implementation share one assistant entry and the renderer folds
 * both into that turn's collapsed work block.
 */
describe('MessageHandler plan approval turn split', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.LODY_SERVER_URL = 'https://server.example.test';
    loadEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    if (originalLodyServerUrl === undefined) {
      delete process.env.LODY_SERVER_URL;
    } else {
      process.env.LODY_SERVER_URL = originalLodyServerUrl;
    }
    loadEnv();
  });

  const startPlanTurn = async (sessionId: SessionId, userTurnId: string) => {
    const harness = await createHandlerHarness(sessionId);
    const { doc, handler } = harness;
    await doc.updateHistory((history) => [...history, userEntry(userTurnId)]);
    const turnId = handler.beginConversationTurn(sessionId, userTurnId, {
      dispatchSource: 'crdt',
      sessionDoc: doc,
    });
    await handler.createAssistantEntryForTurn(sessionId, doc, turnId, undefined, userTurnId);
    handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, 'Here is the plan.'));
    handler.enqueueACPUpdate(sessionId, planExitToolCall(sessionId));
    await vi.advanceTimersByTimeAsync(200);
    return { ...harness, turnId };
  };

  it('continues an approved plan in a new assistant entry and finalizes that entry', async () => {
    const sessionId = 's-plan-1' as SessionId;
    const userTurnId = 'user-turn-1';
    const { repo, doc, handler, turnId } = await startPlanTurn(sessionId, userTurnId);

    try {
      await handler.rollAssistantEntryForPlanExit(sessionId, planExitPermission(sessionId), {
        outcome: 'selected',
        optionId: 'proceed',
      });

      const afterSplit = await doc.getHistory();
      expect(afterSplit.map((entry) => [entry.role, entry.id])).toEqual([
        ['user', userTurnId],
        ['assistant', turnId],
        ['assistant', `${turnId}#exec`],
      ]);

      const planEntry = afterSplit[1];
      const execEntry = afterSplit[2];
      // The plan turn is complete and keeps the plan text plus the approval card.
      expect(planEntry?.finished).toBe(true);
      expect(typeof planEntry?.endedAt).toBe('number');
      expect(itemTexts(planEntry)).toEqual(['Here is the plan.']);
      // The continuation stays addressable by the SAME turn id.
      expect(execEntry?.ownerTurnId).toBe(turnId);
      expect(execEntry?.userTurnId).toBe(userTurnId);
      expect(execEntry?.finished).toBeUndefined();

      // Stop / steer must still target the ACP turn, not the continuation entry.
      expect(resolveActiveAssistantTurnId(afterSplit)).toBe(turnId);

      // Implementation output goes to the continuation entry, while the plan
      // tool call completes back in the entry that opened it.
      handler.enqueueACPUpdate(sessionId, planExitToolCallCompleted(sessionId));
      handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, 'Implemented step one.'));
      await vi.advanceTimersByTimeAsync(200);

      const afterExecution = await doc.getHistory();
      expect(afterExecution).toHaveLength(3);
      expect(itemTypes(afterExecution[1])).toEqual(['text', 'tool_call']);
      const planItems = (afterExecution[1]?.items ?? []) as unknown as Array<{
        type: string;
        status?: string;
      }>;
      expect(planItems[1]?.status).toBe('completed');
      expect(itemTexts(afterExecution[2])).toEqual(['Implemented step one.']);

      await handler.finalizeACPState(sessionId, turnId);

      const finalized = await doc.getHistory();
      expect(finalized[2]?.finished).toBe(true);
      expect(typeof finalized[2]?.endedAt).toBe('number');
      expect(resolveActiveAssistantTurnId(finalized)).toBeUndefined();
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });

  it('keeps a rejected plan in the same turn', async () => {
    const sessionId = 's-plan-2' as SessionId;
    const userTurnId = 'user-turn-2';
    const { repo, doc, handler, turnId } = await startPlanTurn(sessionId, userTurnId);

    try {
      await handler.rollAssistantEntryForPlanExit(sessionId, planExitPermission(sessionId), {
        outcome: 'selected',
        optionId: 'keep-planning',
      });
      await handler.rollAssistantEntryForPlanExit(sessionId, planExitPermission(sessionId), {
        outcome: 'cancelled',
      });

      handler.enqueueACPUpdate(sessionId, agentChunk(sessionId, 'What should change?'));
      await vi.advanceTimersByTimeAsync(200);

      const history = await doc.getHistory();
      expect(history.map((entry) => [entry.role, entry.id])).toEqual([
        ['user', userTurnId],
        ['assistant', turnId],
      ]);
      expect(history[1]?.finished).toBeUndefined();
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });

  it('only splits on a mode switch, not on ordinary approved tool calls', async () => {
    const sessionId = 's-plan-3' as SessionId;
    const userTurnId = 'user-turn-3';
    const { repo, doc, handler, turnId } = await startPlanTurn(sessionId, userTurnId);

    try {
      const editPermission = {
        sessionId,
        toolCall: { toolCallId: 'edit-1', title: 'Edit file', kind: 'edit' },
        options: [{ optionId: 'proceed', name: 'Allow', kind: 'allow_once' }],
      } as unknown as RequestPermissionRequest;

      await handler.rollAssistantEntryForPlanExit(sessionId, editPermission, {
        outcome: 'selected',
        optionId: 'proceed',
      });

      const history = await doc.getHistory();
      expect(history.map((entry) => entry.id)).toEqual([userTurnId, turnId]);
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });

  it('is idempotent when the same approval is answered twice', async () => {
    const sessionId = 's-plan-4' as SessionId;
    const userTurnId = 'user-turn-4';
    const { repo, doc, handler, turnId } = await startPlanTurn(sessionId, userTurnId);

    try {
      await handler.rollAssistantEntryForPlanExit(sessionId, planExitPermission(sessionId), {
        outcome: 'selected',
        optionId: 'proceed',
      });
      await handler.rollAssistantEntryForPlanExit(sessionId, planExitPermission(sessionId), {
        outcome: 'selected',
        optionId: 'proceed',
      });

      const history = await doc.getHistory();
      expect(history.map((entry) => entry.id)).toEqual([userTurnId, turnId, `${turnId}#exec`]);
    } finally {
      await destroyRepoOnRealTimers(repo);
    }
  });
});
