import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  sidebarNavCallbacksAtom,
  sidebarNavItemsAtom,
  type SidebarNavItem,
} from '@/atoms/focus-layer';
import { toggleSidebarCollapsedAtom } from '@/atoms/sidebar-state';
import { getCommandKeybindings, useCommand } from '@/lib/commands';
import { useFocusScopeSwitcher } from '@/ui/focus-scope';
import { useIsMobile } from './use-mobile';

export type { SidebarNavItem } from '@/atoms/focus-layer';

function isTextInputActive(): boolean {
  const element = document.activeElement;
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function isPopupOpen(): boolean {
  return (
    document.querySelector('[data-radix-popper-content-wrapper]') !== null ||
    document.querySelector('[role="dialog"][data-state="open"]') !== null ||
    document.querySelector('[data-radix-menu-content]') !== null
  );
}

/** App-level navigation commands plus the single global focus-scope switcher. */
export function useKeyboardNavigation(): void {
  const { t } = useTranslation();
  const flatItems = useAtomValue(sidebarNavItemsAtom);
  const sidebarCallbacks = useAtomValue(sidebarNavCallbacksAtom);
  const toggleSidebarCollapsed = useSetAtom(toggleSidebarCollapsedAtom);
  const isMobile = useIsMobile();

  const flatItemsRef = useRef(flatItems);
  flatItemsRef.current = flatItems;
  const callbacksRef = useRef(sidebarCallbacks);
  callbacksRef.current = sidebarCallbacks;

  const getVisibleSessionIds = useCallback(
    () =>
      flatItemsRef.current
        .filter((item): item is SidebarNavItem & { kind: 'session' } => item.kind === 'session')
        .map((item) => item.sessionId),
    []
  );

  const navigateVisibleSession = useCallback(
    (direction: 'previous' | 'next') => {
      const callbacks = callbacksRef.current;
      if (!callbacks) return;
      const sessionIds = getVisibleSessionIds();
      if (sessionIds.length === 0) return;

      const currentId = callbacks.getSelectedSessionId();
      const currentIndex = currentId ? sessionIds.indexOf(currentId) : -1;
      const nextIndex =
        direction === 'previous'
          ? Math.max(0, currentIndex - 1)
          : Math.min(sessionIds.length - 1, currentIndex + 1);
      const nextId = sessionIds[nextIndex];
      if (nextId && nextId !== currentId) callbacks.onNavigateToSession(nextId);
    },
    [getVisibleSessionIds]
  );

  useFocusScopeSwitcher({ enabled: !isMobile });

  useCommand({
    id: 'sidebar.toggle',
    title: t('commands.sidebar.toggle', 'Toggle Sidebar'),
    category: 'View',
    keybindings: getCommandKeybindings('sidebar.toggle'),
    when: () => !isMobile,
    run: () => toggleSidebarCollapsed(),
  });

  useCommand({
    id: 'session.previousVisible',
    title: t('commands.session.previousVisible', 'Switch to Previous Session'),
    category: 'Navigation',
    keybindings: getCommandKeybindings('session.previousVisible'),
    when: () =>
      !isMobile &&
      !isPopupOpen() &&
      callbacksRef.current !== null &&
      getVisibleSessionIds().length > 0,
    run: () => navigateVisibleSession('previous'),
  });

  useCommand({
    id: 'session.nextVisible',
    title: t('commands.session.nextVisible', 'Switch to Next Session'),
    category: 'Navigation',
    keybindings: getCommandKeybindings('session.nextVisible'),
    when: () =>
      !isMobile &&
      !isPopupOpen() &&
      callbacksRef.current !== null &&
      getVisibleSessionIds().length > 0,
    run: () => navigateVisibleSession('next'),
  });

  useEffect(() => {
    if (isMobile) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== 'c' ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isTextInputActive() ||
        isPopupOpen()
      ) {
        return;
      }
      const callbacks = callbacksRef.current;
      if (!callbacks) return;
      event.preventDefault();
      callbacks.onNavigateToNewSession();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobile]);
}
