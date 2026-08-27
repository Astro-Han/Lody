import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { SessionHistoryInput, SessionInputBlock } from '@lody/shared';

import { Button } from '@/ui/button';
import { buildResendInputBlocks } from '@/lib/undelivered-user-turn';

/**
 * Composer-area recovery entry for a user turn the missing-history recovery
 * negatively acknowledged (`SessionMeta.lastMissingHistoryUserMsgId`). The old
 * turn is NEVER revived — this resends its exact content (text plus attachment
 * references) as a NEW message with a fresh turn id through the ordinary
 * composer send path. That ordinary producer write clears the marker, which
 * hides this bar and the row's "not delivered" label; the caller additionally
 * supersedes the abandoned entry to a terminal status so the stale pending
 * copy can never dispatch a duplicate after the marker is gone. `isResending`
 * only covers the gap until those writes land.
 */
export function ResendUndeliveredMessageBar({
  entry,
  onResend,
}: {
  entry: {
    id: string;
    items?: SessionHistoryInput['items'] | readonly unknown[] | null | undefined;
    inputConfig?: { inputBlocks?: unknown; prompt?: string | undefined } | null | undefined;
  };
  onResend: (inputBlocks: SessionInputBlock[]) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [isResending, setIsResending] = useState(false);

  const handleResend = useCallback(async () => {
    if (isResending) {
      return;
    }
    const inputBlocks = buildResendInputBlocks(entry);
    if (inputBlocks.length === 0) {
      return;
    }
    setIsResending(true);
    try {
      const accepted = await onResend(inputBlocks);
      if (!accepted) {
        setIsResending(false);
        toast.error(t('sessions.resendUndelivered.failed', 'Failed to resend the message'));
      }
      // On success the button stays disabled: the ordinary send clears the
      // missing-history marker, which unmounts this bar.
    } catch (error) {
      console.warn('Failed to resend undelivered user turn', { userTurnId: entry.id, error });
      setIsResending(false);
      toast.error(t('sessions.resendUndelivered.failed', 'Failed to resend the message'));
    }
  }, [entry, isResending, onResend, t]);

  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5">
      <AlertCircle className="h-3.5 w-3.5 flex-none text-destructive" strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
        {t('sessions.resendUndelivered.title', 'Message not delivered')}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isResending}
        className="h-7 flex-none gap-1.5 px-2 text-[13px] font-normal text-primary hover:bg-hover hover:text-primary"
        aria-label={t('sessions.resendUndelivered.action', 'Resend message')}
        onClick={() => {
          void handleResend();
        }}
      >
        {isResending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {t('sessions.resendUndelivered.action', 'Resend message')}
      </Button>
    </div>
  );
}
