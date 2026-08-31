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
 * The navigation slug is `routeTargetSlug ?? atomWorkspaceSlug` — the
 * render-phase `$workspaceName` route target always wins, because the atom is
 * stale at the two edges of a workspace transition: null on a cold start
 * (descendant layout effects run before the ancestor publishes the slug), and
 * the PREVIOUS workspace's non-null slug during a cross-workspace client
 * navigation. Restoring with the atom slug in that second window would send
 * the replace navigation back into the old workspace. The atom is only the
 * fallback for hosts mounted without `WorkspaceRouteTargetProvider`.
 *
 * `restore` — claim the entry and issue the single replace navigation to
 * `tab`, addressed by `workspaceSlug`.
 * `claim` — claim the entry without navigating (an explicit URL tab is
 * present, or nothing worth restoring is persisted).
 * `noop` — this session entry was already claimed; nothing to do.
 * `defer` — no slug can carry the navigation yet. The entry must NOT be
 * claimed, so the effect retries once a slug is ready instead of silently
 * losing the persisted tab.
 */
export type SessionEntryTabRestoration =
  | { kind: 'defer' }
  | { kind: 'noop' }
  | { kind: 'claim' }
  | { kind: 'restore'; tab: string; workspaceSlug: string };

export const resolveSessionEntryTabRestoration = (options: {
  routeTargetSlug: string | null;
  atomWorkspaceSlug: string | null;
  claimedSessionId: string | null;
  sessionId: string;
  urlTabKind: ParsedSessionTabSearch['kind'];
  readPersistedTabId: () => string | undefined;
}): SessionEntryTabRestoration => {
  if (options.claimedSessionId === options.sessionId) {
    return { kind: 'noop' };
  }
  const workspaceSlug = options.routeTargetSlug ?? options.atomWorkspaceSlug;
  if (!workspaceSlug) {
    return { kind: 'defer' };
  }
  if (options.urlTabKind !== 'missing') {
    return { kind: 'claim' };
  }
  const persistedTabId = options.readPersistedTabId();
  const tab = persistedTabId
    ? formatSessionTabSearch(persistedTabId, options.sessionId)
    : undefined;
  return tab === undefined ? { kind: 'claim' } : { kind: 'restore', tab, workspaceSlug };
};
