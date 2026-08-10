import { atom, useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '@lody/platform/react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { useStuckConnectionHint } from '@/hooks/use-stuck-connection';
import { ClearCacheConfirmDialog, useClearCache } from './settings/clear-cache';

/**
 * Dismissal intentionally lives in a page-load-scoped atom, not storage: the
 * recovery action IS a reload, so a fresh page load should get a fresh verdict.
 */
const stuckConnectionBannerDismissedAtom = atom(false);

export type StuckConnectionBannerLabels = {
  title: string;
  clearCache: string;
  dismissAriaLabel: string;
};

/**
 * Floating hint shown when the workspace connection has been stuck in
 * `loading` for an extended time (see `useStuckConnectionHint`). A single
 * compact row — spinner, title, one action, dismiss — because the action's
 * confirmation dialog already explains what a cache clear does; repeating that
 * here would cost the height of two chat-list rows on a phone. The clear +
 * reload is the one recovery that reliably unwedges poisoned local state (the
 * reload also cancels any hung in-flight connection work). Presentational;
 * `StuckConnectionBannerContainer` wires state.
 */
export function StuckConnectionBanner({
  labels,
  onClearCache,
  onDismiss,
}: {
  labels: StuckConnectionBannerLabels;
  onClearCache: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 flex justify-center px-4"
      role="status"
    >
      <div className="pointer-events-auto flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur">
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 truncate text-sm font-medium">{labels.title}</span>
        <Button size="sm" className="h-7 shrink-0 rounded-full px-3" onClick={onClearCache}>
          {labels.clearCache}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-full text-muted-foreground"
          onClick={onDismiss}
          aria-label={labels.dismissAriaLabel}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Mounted once in `MainLayout`. Renders nothing on the local-only platform
 * (no cloud connection to get stuck), before the hint threshold, or after the
 * user dismissed it for this page load. The clear action reuses the settings
 * "Clear cache" flow — confirmation dialog included — so both entry points
 * share one behavior and one copy.
 */
export function StuckConnectionBannerContainer() {
  const { t } = useTranslation();
  const platform = usePlatform();
  const stuck = useStuckConnectionHint();
  const [dismissed, setDismissed] = useAtom(stuckConnectionBannerDismissedAtom);
  const { dialogOpen, setDialogOpen, isClearing, confirmClear } = useClearCache();

  if (platform.sync.mode === 'local' || !stuck || dismissed) {
    return null;
  }

  return (
    <>
      <StuckConnectionBanner
        labels={{
          title: t('connectionRecovery.title'),
          clearCache: t('connectionRecovery.clearCache'),
          dismissAriaLabel: t('connectionRecovery.dismiss'),
        }}
        onClearCache={() => setDialogOpen(true)}
        onDismiss={() => setDismissed(true)}
      />
      <ClearCacheConfirmDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        isClearing={isClearing}
        onConfirm={() => void confirmClear()}
      />
    </>
  );
}
