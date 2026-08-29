import { describe, expect, it, vi } from 'vitest';

import {
  requestChatLandingProjectSelection,
  subscribeToChatLandingProjectSelection,
} from '../src/components/chat/chat-landing-project-selection';

describe('chat landing project selection requests', () => {
  it('delivers repeated requests for the same project without URL state', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToChatLandingProjectSelection(listener);
    const request = {
      workspaceSlug: 'lody',
      selection: {
        kind: 'local' as const,
        machineId: 'machine-a',
        localProjectId: 'project-a',
      },
    };

    requestChatLandingProjectSelection(request);
    requestChatLandingProjectSelection(request);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, request);
    expect(listener).toHaveBeenNthCalledWith(2, request);

    unsubscribe();
    requestChatLandingProjectSelection(request);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
