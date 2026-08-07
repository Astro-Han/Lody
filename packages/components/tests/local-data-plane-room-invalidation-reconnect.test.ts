/**
 * `LocalLoroDataPlaneServer.invalidateDocRoom` drops the room whose cached
 * `LoroDoc` the repo just evicted. Inbound sync repairs itself (the next
 * `update`/`join` rebuilds the room), but OUTBOUND sync does not: once the entry
 * is gone there is no subscriber left to mark dirty, so a renderer that is only
 * READING a session gets nothing more until it re-joins.
 *
 * Outbound recovery therefore rests entirely on one claim: the room status the
 * server publishes makes the renderer's local reconnect loop fire. That loop is
 * gated by `roomSyncRegistry.anyNeedsReconnect(...)` -> `tracker.needsReconnect()`,
 * and `needsReconnect()` only counts TERMINAL statuses (`disconnected` / `error`).
 *
 * The first version of this fix published `'reconnecting'`, which reads as
 * "already recovering" and leaves `needsReconnect()` false — the loop never
 * fires and outbound sync stays dead. That defect was invisible to the
 * data-plane regression suite because those tests call `adapter.reconnect()` by
 * hand, standing in for the loop instead of exercising the predicate that
 * decides whether the loop runs at all.
 *
 * So this test drives the real chain: server engine -> `room-status` frame ->
 * `LocalLoroTransportAdapter` -> real `createRoomSyncTracker` -> real
 * `createRoomSyncRegistry` -> the exact predicate the loop gates on.
 */
import { describe, expect, it } from 'vitest';
import { LoroDoc } from 'loro-crdt';
import {
  LocalLoroDataPlaneServer,
  LocalLoroTransportAdapter,
  type LocalLoroDataPlaneClientMessage,
  type LocalLoroDataPlaneServerMessage,
} from '@lody/shared';
import { createRoomSyncTracker } from '../src/providers/room-sync-tracker';
import { createRoomSyncRegistry } from '../src/providers/room-sync-registry';

const DOC_ID = 'session-doc-1';
const WORKSPACE_ID = 'ws-1';

/**
 * Renderer adapter <-> CLI engine over one connection, with a drain queue that
 * stands in for the relay's async delivery. No timers, no wall-clock waits.
 */
class Harness {
  private readonly tasks: Array<() => void | Promise<void>> = [];
  private readonly scheduler = {
    scheduleDataWork: (work: () => void | Promise<void>) => {
      const scheduled = { cancelled: false };
      this.tasks.push(async () => {
        if (!scheduled.cancelled) await work();
      });
      return () => {
        scheduled.cancelled = true;
      };
    },
  };
  private readonly rendererListeners = new Set<(m: LocalLoroDataPlaneServerMessage) => void>();
  readonly serverDocs = new Map<string, LoroDoc>();

  private readonly connection = {
    id: 'dp:test:1',
    send: (message: LocalLoroDataPlaneServerMessage) => {
      this.tasks.push(() => {
        for (const listener of this.rendererListeners) listener(message);
      });
    },
  };

  readonly engine = new LocalLoroDataPlaneServer({
    workspaceId: WORKSPACE_ID,
    resolveDoc: async (docId) => this.serverDoc(docId),
    resolveFlockDoc: async () => {
      throw new Error('no flock rooms in this test');
    },
    scheduler: this.scheduler,
  });

  serverDoc(docId: string): LoroDoc {
    const existing = this.serverDocs.get(docId);
    if (existing) return existing;
    const doc = new LoroDoc();
    this.serverDocs.set(docId, doc);
    return doc;
  }

  /** Models `repo.unloadDoc`: persist, then hand out a different instance. */
  unloadServerDoc(docId: string): void {
    const previous = this.serverDocs.get(docId);
    if (!previous) return;
    const reloaded = new LoroDoc();
    reloaded.import(previous.export({ mode: 'snapshot' }));
    this.serverDocs.set(docId, reloaded);
  }

  createAdapter(peerId: string): LocalLoroTransportAdapter {
    return new LocalLoroTransportAdapter({
      workspaceId: WORKSPACE_ID,
      peerId,
      connection: {
        send: (message: LocalLoroDataPlaneClientMessage) => {
          this.tasks.push(async () => {
            if (message.type === 'ping') return;
            await this.engine.handleMessage(this.connection, message);
          });
        },
        onMessage: (listener: (m: LocalLoroDataPlaneServerMessage) => void) => {
          this.rendererListeners.add(listener);
          return () => this.rendererListeners.delete(listener);
        },
        onStatusChange: () => () => {},
        isConnected: () => true,
      },
    });
  }

  async settle(): Promise<void> {
    for (let round = 0; round < 200; round += 1) {
      if (this.tasks.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.tasks.length === 0) return;
      }
      for (const task of this.tasks.splice(0)) await task();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('settle_did_not_converge');
  }
}

/**
 * The production wiring: each durable room gets a real tracker registered in the
 * real registry, and the local reconnect loop's `hasProblem` is
 * `anyNeedsReconnect(isLocalHealthRoom)` (create-workspace-runtime.ts).
 */
function trackRoom(subscription: ReturnType<LocalLoroTransportAdapter['joinDocRoom']>) {
  const registry = createRoomSyncRegistry({ clock: { now: () => 0 } });
  const tracker = createRoomSyncTracker(DOC_ID);
  const untrack = registry.track(tracker);
  tracker.attach(subscription);
  // A room the renderer has already synced once — the state this bug strikes in.
  tracker.markFirstSynced();
  return {
    registry,
    tracker,
    untrack,
    /** Exactly what `createLocalReconnectLoop({ hasProblem })` evaluates. */
    loopWouldFire: () => registry.anyNeedsReconnect(() => true),
  };
}

describe('invalidateDocRoom must wake the renderer local reconnect loop', () => {
  it('publishes a status the reconnect loop actually acts on', async () => {
    const harness = new Harness();
    const renderer = harness.createAdapter('renderer:1');
    const doc = new LoroDoc();
    const subscription = renderer.joinDocRoom(DOC_ID, doc);
    await harness.settle();

    const tracked = trackRoom(subscription);
    expect(subscription.status).toBe('joined');
    expect(tracked.loopWouldFire()).toBe(false);

    // Session GC evicted the doc; the room is now holding an orphan.
    harness.unloadServerDoc(DOC_ID);
    harness.engine.invalidateDocRoom(DOC_ID);
    await harness.settle();

    // The whole outbound recovery path hangs off this being true.
    expect(tracked.loopWouldFire()).toBe(true);

    tracked.untrack();
    tracked.tracker.dispose();
  });

  it("does not regress to 'reconnecting', which the loop ignores", async () => {
    const harness = new Harness();
    const renderer = harness.createAdapter('renderer:1');
    const doc = new LoroDoc();
    const subscription = renderer.joinDocRoom(DOC_ID, doc);
    await harness.settle();

    const tracked = trackRoom(subscription);

    // Negative control pinning WHY `invalidateDocRoom` may not publish
    // `'reconnecting'`: it is a non-terminal status, so `needsReconnect()` stays
    // false and the loop never runs. Kept as a test rather than a comment
    // because the difference is one string and the failure is silent.
    harness.engine.publishRoomStatus({ scope: 'doc', docId: DOC_ID }, 'reconnecting');
    await harness.settle();

    expect(subscription.status).toBe('reconnecting');
    expect(tracked.loopWouldFire()).toBe(false);

    tracked.untrack();
    tracked.tracker.dispose();
  });
});
