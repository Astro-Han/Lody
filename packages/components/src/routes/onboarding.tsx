import { useCallback, useRef } from 'react';
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { desktopOnboardingDraftAtom, desktopOnboardingPhaseAtom } from '@/atoms/onboarding';
import { currentWorkspaceSlugAtom } from '@/atoms/workspace-context';
import { OnboardingOverlay, type DesktopOnboardingCompletion } from '@/components/onboarding';
import { useOnboardingThemeLifecycle } from '@/components/onboarding/use-onboarding-theme-lifecycle';
import { isElectronRenderer } from '@/lib/electron';
import { getIpcServices } from '@/lib/electron-ipc-client';

export const Route = createFileRoute('/onboarding')({
  component: DesktopOnboardingRoute,
});

/** Bounds the completion IPC so a hanging main process cannot lock the flow. */
const COMPLETION_IPC_TIMEOUT_MS = 10_000;

function DesktopOnboardingRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const workspaceSlug = useAtomValue(currentWorkspaceSlugAtom);
  const setPhase = useSetAtom(desktopOnboardingPhaseAtom);
  const setDraft = useSetAtom(desktopOnboardingDraftAtom);
  const inFlightCompletion = useRef<Promise<boolean> | null>(null);
  const completeThemeLifecycle = useOnboardingThemeLifecycle();

  const complete = useCallback(
    (completion: DesktopOnboardingCompletion): Promise<boolean> => {
      // Concurrent triggers (double click, Skip racing Run) share one attempt;
      // a settled attempt clears the ref so a failure stays retryable.
      if (inFlightCompletion.current) return inFlightCompletion.current;
      const attempt = (async (): Promise<boolean> => {
        const result = await Promise.race([
          getIpcServices()?.app.completeOnboarding(),
          new Promise<undefined>((resolve) => {
            setTimeout(resolve, COMPLETION_IPC_TIMEOUT_MS);
          }),
        ]);
        if (!result?.ok) {
          toast.error(
            result?.message ?? t('onboarding.completion.failed', 'Could not finish desktop setup.')
          );
          return false;
        }
        completeThemeLifecycle();
        setPhase(null);
        setDraft({ provider: null, project: null });
        const targetWorkspace = completion.workspaceSlug ?? workspaceSlug;
        if (targetWorkspace && completion.sessionId) {
          await navigate({
            to: '/$workspaceName/sessions/$sessionId',
            params: { workspaceName: targetWorkspace, sessionId: completion.sessionId },
            replace: true,
          });
          return true;
        }
        if (targetWorkspace) {
          await navigate({
            to: '/$workspaceName/chat',
            params: { workspaceName: targetWorkspace },
            replace: true,
          });
          return true;
        }
        await navigate({ to: '/', replace: true });
        return true;
      })()
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
          return false;
        })
        .finally(() => {
          inFlightCompletion.current = null;
        });
      inFlightCompletion.current = attempt;
      return attempt;
    },
    [completeThemeLifecycle, navigate, setDraft, setPhase, t, workspaceSlug]
  );

  if (!isElectronRenderer()) return <Navigate to="/" replace />;
  return <OnboardingOverlay onCompleted={complete} />;
}
