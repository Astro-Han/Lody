import { atom, useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '@lody/platform/react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { bugReportDialogOpenAtom } from '@/atoms/bug-report';
import { useStuckConnectionHint } from '@/hooks/use-stuck-connection';
import { ClearCacheConfirmDialog, useClearCache } from './settings/clear-cache';

/**
 * Dismissal intentionally lives in a page-load-scoped atom, not storage: the
 * recovery action IS a reload, so a fresh page load should get a fresh verdict.
 */
const stuckConnectionBannerDismissedAtom = atom(false);

export type StuckConnectionBannerLabels = {
  title: string;
  description: string;
  clearAndReload: string;
  report: string;
  dismissAriaLabel: string;
};

/**
 * Floating hint shown when the workspace connection has been stuck in
 * `loading` for an extended time (see `useStuckConnectionHint`). Offers the one
 * recovery action that reliably unwedges a poisoned local state — clear the
 * local cache and reload (the reload also cancels any hung in-flight
 * connection work) — plus a bug-report escape hatch for when the problem is
 * not local. Presentational; `StuckConnectionBannerContainer` wires state.
 */
export function StuckConnectionBanner({
  labels,
  onClearCache,
  onReport,
  onDismiss,
}: {
  labels: StuckConnectionBannerLabels;
  onClearCache: () => void;
  onReport: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 flex justify-center px-4"
      role="status"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-xl border border-border/70 bg-card/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-start gap-2.5">
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{labels.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{labels.description}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1 -mt-1 h-7 w-7 shrink-0 text-muted-foreground"
            onClick={onDismiss}
            aria-label={labels.dismissAriaLabel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onReport}>
            {labels.report}
          </Button>
          <Button size="sm" onClick={onClearCache}>
            {labels.clearAndReload}
          </Button>
        </div>
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
  const openBugReport = useSetAtom(bugReportDialogOpenAtom);
  const { dialogOpen, setDialogOpen, isClearing, confirmClear } = useClearCache();

  if (platform.sync.mode === 'local' || !stuck || dismissed) {
    return null;
  }

  return (
    <>
      <StuckConnectionBanner
        labels={{
          title: t('connectionRecovery.title'),
          description: t('connectionRecovery.description'),
          clearAndReload: t('connectionRecovery.clearAndReload'),
          report: t('connectionRecovery.report'),
          dismissAriaLabel: t('connectionRecovery.dismiss'),
        }}
        onClearCache={() => setDialogOpen(true)}
        onReport={() => openBugReport(true)}
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
