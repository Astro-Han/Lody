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

  it('does not claim the entry while the workspace slug is still null, then restores once ready', () => {
    // Cold start on /workspace/sessions/A without ?tab: React runs the
    // descendant SessionDetail layout effect before the ancestor publishes
    // currentWorkspaceSlugAtom. The null→ready sequence must end in exactly
    // one restore, not a silently consumed claim.
    const base = {
      claimedSessionId: null,
      sessionId: parentSessionId,
      urlTabKind: 'missing' as const,
      readPersistedTabId: () => 'child-session',
    };

    // Slug not ready: defer, no claim.
    expect(resolveSessionEntryTabRestoration({ ...base, canNavigate: false })).toEqual({
      kind: 'defer',
    });

    // Slug ready, entry still unclaimed: restore the persisted child.
    expect(resolveSessionEntryTabRestoration({ ...base, canNavigate: true })).toEqual({
      kind: 'restore',
      tab: 'session:child-session',
    });

    // Entry claimed: later runs (including a user navigating back to the
    // parent, i.e. another `missing` value) never restore again.
    expect(
      resolveSessionEntryTabRestoration({
        ...base,
        canNavigate: true,
        claimedSessionId: parentSessionId,
      })
    ).toEqual({ kind: 'noop' });
  });

  it('claims without restoring when the URL already names a tab or nothing is persisted', () => {
    expect(
      resolveSessionEntryTabRestoration({
        canNavigate: true,
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'session',
        readPersistedTabId: () => 'child-session',
      })
    ).toEqual({ kind: 'claim' });

    expect(
      resolveSessionEntryTabRestoration({
        canNavigate: true,
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'missing',
        readPersistedTabId: () => undefined,
      })
    ).toEqual({ kind: 'claim' });

    // A persisted parent selection formats to `undefined` and is a claim, not
    // a restore.
    expect(
      resolveSessionEntryTabRestoration({
        canNavigate: true,
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'missing',
        readPersistedTabId: () => parentSessionId,
      })
    ).toEqual({ kind: 'claim' });
  });

  it('restores a persisted draft tab verbatim', () => {
    expect(
      resolveSessionEntryTabRestoration({
        canNavigate: true,
        claimedSessionId: null,
        sessionId: parentSessionId,
        urlTabKind: 'missing',
        readPersistedTabId: () => 'draft:draft-uuid',
      })
    ).toEqual({ kind: 'restore', tab: 'draft:draft-uuid' });
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
