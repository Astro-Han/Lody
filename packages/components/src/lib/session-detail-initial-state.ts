import type { SessionId } from '@lody/shared';
import {
  readStoredLastActiveTabState,
  type PersistedLastActiveTabState,
  type PersistedSidePanelState,
  type PersistedViewerTab,
} from './session-draft-tabs';
import {
  formatSessionTabSearch,
  parseSessionTabSearch,
  type ParsedSessionTabSearch,
} from './session-tab-url';

const DEFAULT_SIDE_PANEL_STATE: PersistedSidePanelState = {
  open: false,
  tab: null,
  tabs: [],
  sideSessionId: null,
};

export type SessionDetailInitialTabState = {
  readonly activeTabSessionId: string;
  readonly viewerTabs: PersistedViewerTab[];
  readonly activeViewerTabId: string | null;
  readonly sidePanel: PersistedSidePanelState;
};

export type SessionDetailInitialTabStateOptions = {
  readonly readPersistedState?: (parentSessionId: SessionId) => PersistedLastActiveTabState | null;
};

export const getSessionDetailInitialTabState = (
  parentSessionId: SessionId,
  urlTab?: string,
  options: SessionDetailInitialTabStateOptions = {}
): SessionDetailInitialTabState => {
  const parsedUrlTab = parseSessionTabSearch(urlTab);
  if (parsedUrlTab.kind === 'session') {
    return {
      activeTabSessionId:
        parsedUrlTab.sessionId === parentSessionId ? parentSessionId : parsedUrlTab.sessionId,
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: DEFAULT_SIDE_PANEL_STATE,
    };
  }

  if (parsedUrlTab.kind === 'draft') {
    return {
      activeTabSessionId: parsedUrlTab.draftId,
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: DEFAULT_SIDE_PANEL_STATE,
    };
  }

  if (parsedUrlTab.kind === 'invalid') {
    return {
      activeTabSessionId: parentSessionId,
      viewerTabs: [],
      activeViewerTabId: null,
      sidePanel: DEFAULT_SIDE_PANEL_STATE,
    };
  }

  const persistedState =
    options.readPersistedState?.(parentSessionId) ?? readStoredLastActiveTabState(parentSessionId);
  const viewerTab = persistedState?.viewerTab ?? null;

  return {
    activeTabSessionId: persistedState?.sessionTabId ?? parentSessionId,
    viewerTabs: viewerTab ? [viewerTab] : [],
    activeViewerTabId: viewerTab?.id ?? null,
    sidePanel: persistedState?.sidePanel ?? DEFAULT_SIDE_PANEL_STATE,
  };
};

/**
 * Entry-scoped `?tab` restoration decision for `SessionDetail`.
 *
 * `defer` — navigation is not possible yet (the workspace slug atom can still
 * be null on a cold start: React runs the descendant's layout effect before
 * the ancestor publishes the slug). The entry must NOT be claimed, so the
 * effect retries once the slug is ready instead of silently losing the
 * persisted tab.
 * `noop` — this session entry was already claimed; nothing to do.
 * `claim` — claim the entry without navigating (an explicit URL tab is
 * present, or nothing worth restoring is persisted).
 * `restore` — claim the entry and issue the single replace navigation to
 * `tab`.
 */
export type SessionEntryTabRestoration =
  | { kind: 'defer' }
  | { kind: 'noop' }
  | { kind: 'claim' }
  | { kind: 'restore'; tab: string };

export const resolveSessionEntryTabRestoration = (options: {
  canNavigate: boolean;
  claimedSessionId: string | null;
  sessionId: string;
  urlTabKind: ParsedSessionTabSearch['kind'];
  readPersistedTabId: () => string | undefined;
}): SessionEntryTabRestoration => {
  if (options.claimedSessionId === options.sessionId) {
    return { kind: 'noop' };
  }
  if (!options.canNavigate) {
    return { kind: 'defer' };
  }
  if (options.urlTabKind !== 'missing') {
    return { kind: 'claim' };
  }
  const persistedTabId = options.readPersistedTabId();
  const tab = persistedTabId
    ? formatSessionTabSearch(persistedTabId, options.sessionId)
    : undefined;
  return tab === undefined ? { kind: 'claim' } : { kind: 'restore', tab };
};
