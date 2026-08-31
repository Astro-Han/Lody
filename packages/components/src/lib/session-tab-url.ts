import { isDraftSessionTabId, type DraftSessionTabId } from './session-draft-tabs';

const SESSION_TAB_SEARCH_PREFIX = 'session:';
const DRAFT_TAB_SEARCH_PREFIX = 'draft:';

/**
 * The `?tab` search value is the single source of truth for the active
 * conversation tab in `SessionDetail`. It encodes a child Session as
 * `session:<sessionId>` and a draft tab as its full `draft:<id>` tab id;
 * the parent Session is the absent value. `SessionDetail` derives the active
 * tab from this value instead of mirroring it into local state, which is what
 * makes URL/state feedback loops structurally impossible (#193).
 */
export type ParsedSessionTabSearch =
  | { kind: 'missing' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'draft'; draftId: DraftSessionTabId }
  | { kind: 'invalid' };

export const parseSessionTabSearch = (tab: string | undefined): ParsedSessionTabSearch => {
  if (tab === undefined) {
    return { kind: 'missing' };
  }

  const normalized = tab.trim();
  if (isDraftSessionTabId(normalized)) {
    if (normalized.length === DRAFT_TAB_SEARCH_PREFIX.length) {
      return { kind: 'invalid' };
    }
    return { kind: 'draft', draftId: normalized };
  }
  if (!normalized.startsWith(SESSION_TAB_SEARCH_PREFIX)) {
    return { kind: 'invalid' };
  }

  const sessionId = normalized.slice(SESSION_TAB_SEARCH_PREFIX.length).trim();
  if (!sessionId) {
    return { kind: 'invalid' };
  }

  return { kind: 'session', sessionId };
};

export const formatSessionTabSearch = (
  tabId: string,
  parentSessionId: string
): string | undefined => {
  if (!tabId || tabId === parentSessionId) {
    return undefined;
  }
  if (isDraftSessionTabId(tabId)) {
    return tabId;
  }

  return `${SESSION_TAB_SEARCH_PREFIX}${tabId}`;
};

export type SessionTabResolutionContext = {
  parentSessionId: string;
  childSessionIds: readonly string[];
  draftTabIds: readonly string[];
};

/**
 * Resolve the active conversation tab from the URL alone. A tab the URL names
 * but the context cannot resolve (child meta still loading, archived
 * elsewhere, unpersisted draft) resolves to the parent, so a blank content
 * area is impossible and the same derivation activates the child once its
 * meta arrives. Pure: activating a tab is the caller's navigation concern.
 */
export const resolveActiveSessionTab = (
  parsed: ParsedSessionTabSearch,
  context: SessionTabResolutionContext
): string => {
  if (parsed.kind === 'session') {
    if (parsed.sessionId === context.parentSessionId) {
      return context.parentSessionId;
    }
    return context.childSessionIds.includes(parsed.sessionId)
      ? parsed.sessionId
      : context.parentSessionId;
  }
  if (parsed.kind === 'draft') {
    return context.draftTabIds.includes(parsed.draftId) ? parsed.draftId : context.parentSessionId;
  }
  return context.parentSessionId;
};

/**
 * URL normalization: whether the current `?tab` value should be removed with
 * one replace navigation. Only a value that PROVABLY resolves to the parent
 * is cleared — an unresolved child while `childSessionsResolved` is false is
 * left alone, so a slow meta cache can never strip a valid child tab. The
 * rule converges: clearing yields `missing`, which is never cleared again.
 */
export const shouldClearSessionUrlTab = (
  parsed: ParsedSessionTabSearch,
  context: SessionTabResolutionContext & { childSessionsResolved: boolean }
): boolean => {
  if (parsed.kind === 'missing') {
    return false;
  }
  if (parsed.kind === 'invalid') {
    return true;
  }
  if (parsed.kind === 'draft') {
    return !context.draftTabIds.includes(parsed.draftId);
  }
  if (parsed.sessionId === context.parentSessionId) {
    return true;
  }
  if (!context.childSessionsResolved) {
    return false;
  }
  return !context.childSessionIds.includes(parsed.sessionId);
};
