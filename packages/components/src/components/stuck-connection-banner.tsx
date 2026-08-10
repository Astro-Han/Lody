import { atom, useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { usePlatform } from '@lody/platform/react';
import { motion } from 'framer-motion';
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
  description: string;
  clearCache: string;
  dismissAriaLabel: string;
};

/**
 * Floating hint shown when the workspace connection has been stuck in
 * `loading` for an extended time (see `useStuckConnectionHint`).
 *
 * Sits at the BOTTOM, above the mobile dock (`bottom-0 z-30`, ~72px tall plus
 * safe area) rather than under the header: the bottom of a list is usually
 * empty space, while the top covers the rows the user came to read, and a
 * bottom sheet is both the platform-conventional place for a recoverable
 * status and within thumb reach. The description stays — without the "broken
 * local cache" link, "Clear cache" reads as an unrelated button next to a
 * connection problem — but the specifics of what gets deleted live in the
 * confirmation dialog the action opens, not here.
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
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--k-safe-area-bottom,0px)+5.25rem)] z-40 flex justify-center px-4"
      role="status"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
        className="pointer-events-auto w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-3 shadow-lg backdrop-blur"
      >
        <div className="flex items-start gap-2.5">
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{labels.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {labels.description}
            </p>
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
        <div className="mt-2 flex justify-end">
          <Button size="sm" className="h-8 rounded-full px-4" onClick={onClearCache}>
            {labels.clearCache}
          </Button>
        </div>
      </motion.div>
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
          description: t('connectionRecovery.description'),
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
