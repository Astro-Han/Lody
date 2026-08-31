import { describe, expect, it } from 'vitest';
import type { SessionId } from '@lody/shared';
import {
  getSessionDetailInitialTabState,
  resolveSessionEntryTabRestoration,
} from '../src/lib/session-detail-initial-state';
import type { PersistedLastActiveTabState } from '../src/lib/session-draft-tabs';

const parentSessionId = 'parent-session' as SessionId;

const persistedProviderFileState: PersistedLastActiveTabState = {
  sessionTabId: 'child-session',
  viewerTab: {
    id: 'file:file-1',
    type: 'file',
    filePath: 'src/renamed.ts',
    fileId: 'file-1',
    label: 'renamed.ts',
    startLine: 4,
    endLine: 8,
    focusRequestSeq: 2,
  },
  sidePanel: {
    open: true,
    tab: 'browser',
    tabs: ['files', 'browser'],
    sideSessionId: 'side-session-1',
  },
};

describe('getSessionDetailInitialTabState', () => {
  it('restores the persisted session tab and provider file viewer state when the URL has no tab', () => {
    expect(
      getSessionDetailInitialTabState(parentSessionId, undefined, {
        readPersistedState: () => persistedProviderFileState,
      })
    ).toEqual({
      activeTabSessionId: 'child-session',
      viewerTabs: [persistedProviderFileState.viewerTab],
      activeViewerTabId: 'file:file-1',
      sidePanel: {
        open: true,
        tab: 'browser',
        tabs: ['files', 'browser'],
        sideSessionId: 'side-session-1',
      },
    });
  });

  it('lets an explicit URL session tab override persisted viewer state', () => {
    expect(
      getSessionDetailInitialTabState(parentSessionId, 'session:url-child', {
        readPersistedState: () => persistedProviderFileState,
      })
    ).toEqual({
      activeTabSessionId: 'url-child',
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: {
        open: false,
        tab: null,
        tabs: [],
        sideSessionId: null,
      },
    });
  });

  it('lets an explicit URL draft tab override persisted viewer state', () => {
    expect(
      getSessionDetailInitialTabState(parentSessionId, 'draft:draft-uuid', {
        readPersistedState: () => persistedProviderFileState,
      })
    ).toEqual({
      activeTabSessionId: 'draft:draft-uuid',
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: {
        open: false,
        tab: null,
        tabs: [],
        sideSessionId: null,
      },
    });
  });

  it('normalizes a URL tab pointing at the parent session and clears viewer state', () => {
    expect(
      getSessionDetailInitialTabState(parentSessionId, 'session:parent-session', {
        readPersistedState: () => persistedProviderFileState,
      })
    ).toEqual({
      activeTabSessionId: parentSessionId,
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: {
        open: false,
        tab: null,
        tabs: [],
        sideSessionId: null,
      },
    });
  });

  it('treats invalid URL tab state as an explicit parent-session reset', () => {
    expect(
      getSessionDetailInitialTabState(parentSessionId, 'file:src/index.ts', {
        readPersistedState: () => persistedProviderFileState,
      })
    ).toEqual({
      activeTabSessionId: parentSessionId,
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: {
        open: false,
        tab: null,
        tabs: [],
        sideSessionId: null,
      },
    });
  });

  it('does not claim the entry while no slug is ready, then restores once the route target lands', () => {
    // Cold start on /workspace/sessions/A without ?tab: React runs the
    // descendant SessionDetail layout effect before the ancestor publishes
    // currentWorkspaceSlugAtom. The null→ready sequence must end in exactly
    // one restore, not a silently consumed claim.
    const base = {
      atomWorkspaceSlug: null,
      claimedSessionId: null,
      sessionId: parentSessionId,
      urlTabKind: 'missing' as const,
      readPersistedTabId: () => 'child-session',
    };

    // No slug from either source: defer, no claim.
    expect(resolveSessionEntryTabRestoration({ ...base, routeTargetSlug: null })).toEqual({
      kind: 'defer',
    });

    // Route target ready, entry still unclaimed: restore the persisted child.
    expect(resolveSessionEntryTabRestoration({ ...base, routeTargetSlug: 'workspace-b' })).toEqual({
      kind: 'restore',
      tab: 'session:child-session',
      workspaceSlug: 'workspace-b',
    });

    // Entry claimed: later runs (including a user navigating back to the
    // parent, i.e. another `missing` value) never restore again.
    expect(
      resolveSessionEntryTabRestoration({
        ...base,
        routeTargetSlug: 'workspace-b',
        claimedSessionId: parentSessionId,
      })
    ).toEqual({ kind: 'noop' });
  });

  it('restores into the route target workspace when the atom still holds the previous one', () => {
    // Cross-workspace client navigation: standing in workspace C, navigating
    // to /B/sessions/A without ?tab. The first SessionDetail layout effect
    // sees the stale non-null atom slug "workspace-c" while the render-phase
    // route target already says "workspace-b" — the restoration must address
    // workspace B, never fall back to the stale atom value.
    expect(
      resolveSessionEntryTabRestoration({
        routeTargetSlug: 'workspace-b',
        atomWorkspaceSlug: 'workspace-c',
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'missing',
        readPersistedTabId: () => 'child-session',
      })
    ).toEqual({ kind: 'restore', tab: 'session:child-session', workspaceSlug: 'workspace-b' });
  });

  it('falls back to the atom slug only for hosts without a route target provider', () => {
    expect(
      resolveSessionEntryTabRestoration({
        routeTargetSlug: null,
        atomWorkspaceSlug: 'workspace-b',
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'missing',
        readPersistedTabId: () => 'child-session',
      })
    ).toEqual({ kind: 'restore', tab: 'session:child-session', workspaceSlug: 'workspace-b' });
  });

  it('claims without restoring when the URL already names a tab or nothing is persisted', () => {
    const base = {
      routeTargetSlug: 'workspace-b',
      atomWorkspaceSlug: 'workspace-b',
      claimedSessionId: null,
      sessionId: parentSessionId,
    };

    expect(
      resolveSessionEntryTabRestoration({
        ...base,
        urlTabKind: 'session',
        readPersistedTabId: () => 'child-session',
      })
    ).toEqual({ kind: 'claim' });

    expect(
      resolveSessionEntryTabRestoration({
        ...base,
        urlTabKind: 'missing',
        readPersistedTabId: () => undefined,
      })
    ).toEqual({ kind: 'claim' });

    // A persisted parent selection formats to `undefined` and is a claim, not
    // a restore.
    expect(
      resolveSessionEntryTabRestoration({
        ...base,
        urlTabKind: 'missing',
        readPersistedTabId: () => parentSessionId,
      })
    ).toEqual({ kind: 'claim' });
  });

  it('restores a persisted draft tab verbatim', () => {
    expect(
      resolveSessionEntryTabRestoration({
        routeTargetSlug: 'workspace-b',
        atomWorkspaceSlug: 'workspace-b',
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'missing',
        readPersistedTabId: () => 'draft:draft-uuid',
      })
    ).toEqual({ kind: 'restore', tab: 'draft:draft-uuid', workspaceSlug: 'workspace-b' });
  });

  it('defaults the side panel state when older persisted state has no side panel entry', () => {
    expect(
      getSessionDetailInitialTabState(parentSessionId, undefined, {
        readPersistedState: () => ({
          sessionTabId: 'child-session',
          viewerTab: null,
        }),
      })
    ).toEqual({
      activeTabSessionId: 'child-session',
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: {
        open: false,
        tab: null,
        tabs: [],
        sideSessionId: null,
      },
    });
  });
});
