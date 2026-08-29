export type ChatLandingProjectSelection =
  | { kind: 'none' }
  | { kind: 'github'; repoFullName: string }
  | { kind: 'local'; machineId: string; localProjectId: string };

export type ChatLandingProjectSelectionRequest = {
  workspaceSlug: string;
  selection: ChatLandingProjectSelection;
};

type ChatLandingProjectSelectionListener = (request: ChatLandingProjectSelectionRequest) => void;

const projectSelectionListeners = new Set<ChatLandingProjectSelectionListener>();

/**
 * This request is deliberately transient. A mounted desktop landing consumes
 * it; otherwise the accompanying route navigation applies the URL selection
 * when the landing mounts. Do not persist it or mirror it into URL state.
 */
export function requestChatLandingProjectSelection(
  request: ChatLandingProjectSelectionRequest
): void {
  for (const listener of projectSelectionListeners) {
    listener(request);
  }
}

export function subscribeToChatLandingProjectSelection(
  listener: ChatLandingProjectSelectionListener
): () => void {
  projectSelectionListeners.add(listener);
  return () => {
    projectSelectionListeners.delete(listener);
  };
}
