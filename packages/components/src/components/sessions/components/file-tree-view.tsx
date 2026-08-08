import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { CloudOff, FileWarning, FolderOpen, RefreshCw } from 'lucide-react';
import { getMachineFlockLocalProjects, type FileTreeItem, type SessionMeta } from '@lody/shared';
import { TreeDataItem, TreeView } from '@/components/tree-view';
import { FileTreeSkeleton, FileTreeStatePanel } from './file-tree-states';
import { useFileWorkspaceTree } from '@/hooks/use-code-session';
import { useCodeCollabSessionFileProvider } from '@/hooks/use-code-collab-session-file-provider';
import { useCodeCollabRequestedRole } from '@/hooks/use-code-collab-requested-role';
import { useMachineFlockRows } from '@/hooks/use-machine-flock-rows';
import {
  useLocalProjectFilePaths,
  type LocalProjectFilePathsSource,
} from '@/hooks/use-local-project-file-paths';
import { buildFileTreeFromPaths, markFileTreeModified } from '@/lib/file-tree';
import { getBasename } from '@/lib';
import { shouldVirtualizeFileTreeData } from '@/lib/file-tree-virtualization';
import { VirtualFileTree } from './virtual-file-tree';
import {
  resolveSessionLocalFileSource,
  resolveSessionLocalProjectRootPath,
  resolveSessionRepoFullName,
} from '@/lib/session-local-file-source';
import { chooseSessionFileSurfaceSource } from '@/lib/session-file-source-selection';
import { logCodeCollabDebug } from '@/lib/code-collab-debug';
import { resolveEffectiveCodeCollabWorkspaceId } from '@/lib/code-collab-workspace-id';
import { currentWorkspaceIdAtom, getMachineMetaByIdAtomFamily, userAtom } from '@/atoms';
import { localMachineIdAtom } from '@/atoms/local-probe';
import { runtimeAtom } from '@/atoms/runtime';
import type { FileWorkspaceProvider } from '@/lib/file-workspace-provider';
import { Button, ScrollArea } from '@/ui';
import {
  createFileIconComponent,
  createFolderIconComponent,
  DefaultFileIcon,
  DefaultFolderIcon,
} from '@/components/icons/file-icons';

interface FileTreeViewProps {
  session: SessionMeta;
  handleOpenFile: (filePath: string) => void;
  fileProvider?: FileWorkspaceProvider | null;
  fileProviderPending?: boolean;
  fileProviderMessage?: string;
  autoCodeCollab?: boolean;
  // Paths of files that appear in the session "Changes" list. When provided,
  // these drive the modified-file highlight in the tree (provider metadata does
  // not carry per-file modified state in live mode). Omitted by Storybook /
  // playground callers, which fall back to the tree's own `modified` flags.
  changedFilePaths?: readonly string[];
}

type ControlledFileTreeViewProps = Omit<FileTreeViewProps, 'session' | 'autoCodeCollab'>;

const LOCAL_FILE_REFRESH_HEARTBEAT_BUCKET_MS = 5_000;
const EMPTY_FILE_TREE: FileTreeItem[] = [];

// All loading phases map to the same skeleton surface for the user; the distinct
// branch names are kept only so the debug console can tell them apart.
type FileTreeRenderBranch =
  | 'loading'
  | 'local-loading'
  | 'provider-loading'
  | 'provider-pending'
  | 'local-error'
  | 'unavailable'
  | 'provider-unavailable'
  | 'empty'
  | 'virtual-tree'
  | 'tree';

// Full-height wrapper so the skeleton fills the panel and clips overflow instead
// of introducing its own scrollbar while real content is still loading.
function FileTreeSkeletonSurface() {
  return (
    <div className="h-full overflow-hidden">
      <FileTreeSkeleton />
    </div>
  );
}

const buildLocalFileRefreshToken = (session: SessionMeta): string => {
  const lastMessageAt =
    typeof session.lastMessageAt === 'number' && Number.isFinite(session.lastMessageAt)
      ? session.lastMessageAt
      : '';
  const lastRunningSeenBucket =
    typeof session.lastRunningSeen === 'number' && Number.isFinite(session.lastRunningSeen)
      ? Math.floor(session.lastRunningSeen / LOCAL_FILE_REFRESH_HEARTBEAT_BUCKET_MS)
      : '';
  const changedLineTotals =
    session.diffStats === undefined
      ? ''
      : `${session.diffStats.allChange.add}:${session.diffStats.allChange.del}`;

  return [session.status?.type ?? '', lastMessageAt, lastRunningSeenBucket, changedLineTotals].join(
    '\0'
  );
};

const fileTreeToTreeData = (
  items: FileTreeItem[],
  onFileOpen: (filePath: string) => void,
  onLazyDirectoryOpen?: (directoryId: string) => void
): TreeDataItem[] => {
  const walk = (item: FileTreeItem): TreeDataItem => {
    const name = getBasename(item.path);
    if (item.type === 'directory') {
      const FolderIcon = createFolderIconComponent(item.path);
      const lazyDirectoryId = item.lazyDirectoryId;
      return {
        id: item.path,
        name,
        icon: FolderIcon,
        openIcon: FolderIcon,
        forceNode: lazyDirectoryId !== undefined,
        children: (item.children ?? []).map(walk),
        ...(lazyDirectoryId === undefined || onLazyDirectoryOpen === undefined
          ? {}
          : { onClick: () => onLazyDirectoryOpen(lazyDirectoryId) }),
        className: item.modified ? 'text-modified-file' : undefined,
      };
    }

    const FileIcon = createFileIconComponent(item.path);
    return {
      id: item.path,
      name,
      icon: FileIcon,
      onClick: () => onFileOpen(item.path),
      className: item.modified ? 'text-modified-file' : undefined,
    };
  };

  return items.map(walk);
};

// Memoize the changed-paths lookup so a stable `changedFilePaths` array does not
// rebuild the marked tree every render. Returns `undefined` when no list is
// provided so callers fall back to the tree's own `modified` flags.
const useChangedFilePathSet = (
  changedFilePaths: readonly string[] | undefined
): ReadonlySet<string> | undefined =>
  useMemo(() => (changedFilePaths ? new Set(changedFilePaths) : undefined), [changedFilePaths]);

function ControlledFileTreeView({
  handleOpenFile,
  fileProvider,
  fileProviderPending,
  fileProviderMessage,
  changedFilePaths,
}: ControlledFileTreeViewProps) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const initializingDirectoriesRef = useRef<Set<string>>(new Set());
  const providerFileTree = useFileWorkspaceTree(fileProvider, {
    enabled: Boolean(fileProvider),
  });
  const changedFilePathSet = useChangedFilePathSet(changedFilePaths);
  const handleLazyDirectoryOpen = useCallback(
    (directoryId: string) => {
      if (!fileProvider?.initializeDirectory) return;
      if (initializingDirectoriesRef.current.has(directoryId)) return;
      initializingDirectoriesRef.current.add(directoryId);
      void fileProvider.initializeDirectory(directoryId).finally(() => {
        initializingDirectoriesRef.current.delete(directoryId);
      });
    },
    [fileProvider]
  );
  const fileTreeData = useMemo(() => {
    const tree = changedFilePathSet
      ? markFileTreeModified(providerFileTree.state, changedFilePathSet)
      : providerFileTree.state;
    return fileTreeToTreeData(tree, handleOpenFile, handleLazyDirectoryOpen);
  }, [changedFilePathSet, providerFileTree.state, handleOpenFile, handleLazyDirectoryOpen]);
  // Walks the whole tree, so keep it tied to the tree data instead of re-running
  // on every unrelated re-render of this component.
  const shouldVirtualizeTree = useMemo(
    () => shouldVirtualizeFileTreeData(fileTreeData),
    [fileTreeData]
  );
  const message = providerFileTree.message ?? fileProviderMessage;

  // Collapse the connecting/ready phases into a single "loading" surface: the
  // user only needs to know files are loading, not which internal phase we're
  // in. The phase still goes to the debug console for diagnostics.
  const renderBranch: FileTreeRenderBranch = fileProviderPending
    ? 'loading'
    : !fileProvider
      ? 'unavailable'
      : !providerFileTree.ready
        ? 'loading'
        : !providerFileTree.synced
          ? 'unavailable'
          : providerFileTree.state.length === 0
            ? 'empty'
            : shouldVirtualizeTree
              ? 'virtual-tree'
              : 'tree';

  useEffect(() => {
    logCodeCollabDebug('file tree (controlled) render branch', {
      renderBranch,
      fileProviderPending: fileProviderPending === true,
      hasFileProvider: Boolean(fileProvider),
      ready: providerFileTree.ready,
      synced: providerFileTree.synced,
      rootCount: providerFileTree.state.length,
    });
  }, [
    fileProvider,
    fileProviderPending,
    providerFileTree.ready,
    providerFileTree.state.length,
    providerFileTree.synced,
    renderBranch,
  ]);

  if (renderBranch === 'loading') {
    return <FileTreeSkeletonSurface />;
  }
  if (renderBranch === 'unavailable') {
    return (
      <FileTreeStatePanel
        icon={CloudOff}
        title={t('sessions.codeSession.files.unavailableTitle', 'Files unavailable')}
        description={
          message ?? t('sessions.codeSession.files.unavailable', 'Files are unavailable.')
        }
      />
    );
  }
  if (renderBranch === 'empty') {
    return (
      <FileTreeStatePanel
        icon={FolderOpen}
        title={t('sessions.codeSession.files.emptyTitle', 'No files here')}
        description={message ?? t('sessions.codeSession.noFiles', 'This directory is empty.')}
      />
    );
  }

  return (
    <ScrollArea className="h-full" viewportRef={scrollViewportRef}>
      <div className="p-1">
        {renderBranch === 'virtual-tree' ? (
          <VirtualFileTree data={fileTreeData} viewportRef={scrollViewportRef} />
        ) : (
          <TreeView
            data={fileTreeData}
            defaultNodeIcon={DefaultFolderIcon}
            defaultLeafIcon={DefaultFileIcon}
            className="p-0"
          />
        )}
      </div>
    </ScrollArea>
  );
}

export const FileTreeView = (props: FileTreeViewProps) => {
  const hasControlledFileProvider =
    props.fileProvider !== undefined || props.fileProviderPending !== undefined;
  if (hasControlledFileProvider || props.autoCodeCollab === false) {
    return <ControlledFileTreeView {...props} />;
  }
  return <AutoFileTreeView {...props} />;
};

export function FileTreeProviderView(props: ControlledFileTreeViewProps) {
  return <ControlledFileTreeView {...props} />;
}

const AutoFileTreeView = ({
  session,
  handleOpenFile,
  fileProvider,
  fileProviderPending,
  fileProviderMessage,
  autoCodeCollab = true,
  changedFilePaths,
}: FileTreeViewProps) => {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const initializingDirectoriesRef = useRef<Set<string>>(new Set());
  // Bumping this nonce changes the local file refresh token, which re-triggers a
  // load in useLocalProjectFilePaths — the cheap way to expose a "Try again" for
  // read errors without threading an imperative refetch through the hook.
  const [localRetryNonce, setLocalRetryNonce] = useState(0);
  const localMachineId = useAtomValue(localMachineIdAtom);
  const workspaceId = useAtomValue(currentWorkspaceIdAtom);
  const workspaceRuntime = useAtomValue(runtimeAtom);
  const effectiveWorkspaceId = resolveEffectiveCodeCollabWorkspaceId({
    currentWorkspaceId: workspaceId,
    runtimeWorkspaceId: workspaceRuntime?.workspaceId,
  });
  const currentUser = useAtomValue(userAtom);
  const sessionMachine = useAtomValue(getMachineMetaByIdAtomFamily(session.machineId));
  const machineFlockRows = useMachineFlockRows(session.machineId, {
    families: ['localProject'],
  });
  const sessionMachineLocalProjects = useMemo(
    () => ({
      ...(sessionMachine?.localProjects ?? {}),
      ...getMachineFlockLocalProjects(machineFlockRows),
    }),
    [machineFlockRows, sessionMachine?.localProjects]
  );
  const isElectronRenderer = typeof window !== 'undefined' && window.__LODY_ELECTRON__ === true;
  const localProjectRootPath = useMemo(
    () => resolveSessionLocalProjectRootPath(session, sessionMachineLocalProjects),
    [session, sessionMachineLocalProjects]
  );
  const localFileSource = useMemo(
    () =>
      resolveSessionLocalFileSource(session, {
        isElectronRenderer,
        localMachineId,
        workspaceId: effectiveWorkspaceId,
        localProjectRootPath,
      }),
    [effectiveWorkspaceId, isElectronRenderer, localMachineId, localProjectRootPath, session]
  );
  const localFilePathsSource = useMemo<LocalProjectFilePathsSource | undefined>(() => {
    if (!localFileSource) {
      return undefined;
    }
    if (localFileSource.kind === 'local-project') {
      return {
        kind: 'project',
        workspaceId: localFileSource.workspaceId,
        machineId: session.machineId,
        localProjectId: localFileSource.localProjectId,
      };
    }
    return {
      kind: 'worktree',
      repoKey: localFileSource.repoKey,
      sessionId: localFileSource.sessionId,
    };
  }, [localFileSource, session.machineId]);
  const hasControlledFileProvider = fileProvider !== undefined || fileProviderPending !== undefined;
  const shouldPreferLocalBeforeAutoProvider =
    !hasControlledFileProvider && Boolean(localFilePathsSource);
  const codeCollabRequestedRole = useCodeCollabRequestedRole();
  // Child-session tabs share the parent's worktree, so the Code Collab space is
  // keyed by the workspace-owning (parent) session. Mirrors localFileSource and
  // the chat-input mention provider; using the raw child id would miss the
  // owner-session file tree and All Changes state.
  const codeCollabSessionId = session.parentSessionId ?? session.id;
  const autoCodeCollabProvider = useCodeCollabSessionFileProvider({
    workspaceId: effectiveWorkspaceId,
    sessionId: codeCollabSessionId,
    enabled: autoCodeCollab && !hasControlledFileProvider && !shouldPreferLocalBeforeAutoProvider,
    requestedRole: codeCollabRequestedRole,
    machineId: session.machineId,
    requestedByUserId: currentUser?.id ?? session.userId,
    githubRepoFullName: resolveSessionRepoFullName(session) || null,
    debugLabel: 'file-tree:auto-provider',
  });
  const activeFileProvider = fileProvider ?? autoCodeCollabProvider.provider;
  const autoCodeCollabProviderPending =
    autoCodeCollab &&
    !hasControlledFileProvider &&
    !shouldPreferLocalBeforeAutoProvider &&
    !autoCodeCollabProvider.provider &&
    (autoCodeCollabProvider.status === 'checking' || autoCodeCollabProvider.status === 'loading');
  const effectiveFileProviderPending =
    fileProviderPending === true || autoCodeCollabProviderPending;
  const effectiveFileProviderMessage = fileProviderMessage ?? autoCodeCollabProvider.message;
  const fileTreeSource = chooseSessionFileSurfaceSource({
    hasFileProvider: Boolean(activeFileProvider),
    fileProviderPending: effectiveFileProviderPending,
    hasLocalFileSource: Boolean(localFilePathsSource),
    allowLocalFileSource: shouldPreferLocalBeforeAutoProvider || !effectiveFileProviderPending,
  });
  const shouldUseLocalFileList = fileTreeSource === 'local';
  const shouldUseProviderFileList = fileTreeSource === 'provider';

  const localFileRefreshToken = useMemo(
    () => `${buildLocalFileRefreshToken(session)}:${localRetryNonce}`,
    [session, localRetryNonce]
  );
  const localProjectFileData = useLocalProjectFilePaths(localFilePathsSource, {
    refreshToken: shouldUseLocalFileList ? localFileRefreshToken : null,
    refreshOnMount: shouldUseLocalFileList,
  });
  const handleRetryLocalFiles = useCallback(() => {
    setLocalRetryNonce((nonce) => nonce + 1);
  }, []);
  const providerFileTree = useFileWorkspaceTree(activeFileProvider, {
    enabled: shouldUseProviderFileList,
  });

  const localFileTree = useMemo(
    () => buildFileTreeFromPaths(localProjectFileData.entry?.paths ?? []),
    [localProjectFileData.entry?.paths]
  );

  const changedFilePathSet = useChangedFilePathSet(changedFilePaths);
  const activeFileTree = useMemo(() => {
    const baseTree = shouldUseLocalFileList
      ? localFileTree
      : shouldUseProviderFileList
        ? providerFileTree.state
        : EMPTY_FILE_TREE;
    return changedFilePathSet ? markFileTreeModified(baseTree, changedFilePathSet) : baseTree;
  }, [
    changedFilePathSet,
    localFileTree,
    providerFileTree.state,
    shouldUseLocalFileList,
    shouldUseProviderFileList,
  ]);
  const handleLazyDirectoryOpen = useCallback(
    (directoryId: string) => {
      if (!activeFileProvider?.initializeDirectory) return;
      if (initializingDirectoriesRef.current.has(directoryId)) return;
      initializingDirectoriesRef.current.add(directoryId);
      void activeFileProvider.initializeDirectory(directoryId).finally(() => {
        initializingDirectoriesRef.current.delete(directoryId);
      });
    },
    [activeFileProvider]
  );
  const fileTreeData = useMemo(
    () => fileTreeToTreeData(activeFileTree, handleOpenFile, handleLazyDirectoryOpen),
    [activeFileTree, handleLazyDirectoryOpen, handleOpenFile]
  );
  const shouldVirtualizeTree = useMemo(
    () => shouldVirtualizeFileTreeData(fileTreeData),
    [fileTreeData]
  );
  const localStatus = localProjectFileData.status;
  const localError = localProjectFileData.error;
  const localHasEntry = Boolean(localProjectFileData.entry);
  const localIsLoading = localStatus === 'idle' || localStatus === 'loading';
  const localIsErrorWithoutData = localStatus === 'error' && !localHasEntry;
  const localListTruncated = localProjectFileData.entry?.truncated === true;
  const providerMessage = providerFileTree.message;
  const emptyFileTreeMessage = shouldUseProviderFileList
    ? providerMessage
    : !shouldUseLocalFileList
      ? effectiveFileProviderMessage
      : undefined;
  const fileTreeRenderBranch = shouldUseLocalFileList
    ? localIsLoading
      ? 'local-loading'
      : localIsErrorWithoutData
        ? 'local-error'
        : activeFileTree.length === 0
          ? 'empty'
          : shouldVirtualizeTree
            ? 'virtual-tree'
            : 'tree'
    : shouldUseProviderFileList
      ? !providerFileTree.ready
        ? 'provider-loading'
        : !providerFileTree.synced
          ? 'provider-unavailable'
          : activeFileTree.length === 0
            ? 'empty'
            : shouldVirtualizeTree
              ? 'virtual-tree'
              : 'tree'
      : effectiveFileProviderPending
        ? 'provider-pending'
        : 'unavailable';

  useEffect(() => {
    logCodeCollabDebug('file tree source state', {
      sessionId: session.id,
      source: fileTreeSource,
      renderBranch: fileTreeRenderBranch,
      autoCodeCollab,
      hasControlledFileProvider,
      hasLocalFileSource: Boolean(localFilePathsSource),
      hasActiveFileProvider: Boolean(activeFileProvider),
      providerKind: activeFileProvider?.kind ?? null,
      effectiveFileProviderPending,
      effectiveFileProviderMessage: effectiveFileProviderMessage ?? null,
      providerTreeReady: providerFileTree.ready,
      providerTreeSynced: providerFileTree.synced,
      providerTreeRootCount: providerFileTree.state.length,
      providerTreeMessage: providerFileTree.message ?? null,
      activeFileTreeRootCount: activeFileTree.length,
      treeDataRootCount: fileTreeData.length,
      localStatus: localProjectFileData.status,
      localHasEntry: Boolean(localProjectFileData.entry),
    });
  }, [
    activeFileProvider,
    activeFileTree.length,
    autoCodeCollab,
    effectiveFileProviderMessage,
    effectiveFileProviderPending,
    fileTreeData.length,
    fileTreeRenderBranch,
    fileTreeSource,
    hasControlledFileProvider,
    localFilePathsSource,
    localProjectFileData.entry,
    localProjectFileData.status,
    providerFileTree.message,
    providerFileTree.ready,
    providerFileTree.synced,
    providerFileTree.state.length,
    session.id,
  ]);
  const localTruncatedLabel =
    localFileSource?.kind === 'session-worktree'
      ? t(
          'sessions.worktree.files.truncated',
          'Worktree is very large; local file list was truncated.'
        )
      : t(
          'sessions.localProject.files.truncated',
          'Project is very large; local file list was truncated.'
        );

  if (
    fileTreeRenderBranch === 'local-loading' ||
    fileTreeRenderBranch === 'provider-loading' ||
    fileTreeRenderBranch === 'provider-pending'
  ) {
    return <FileTreeSkeletonSurface />;
  }

  if (fileTreeRenderBranch === 'local-error') {
    return (
      <FileTreeStatePanel
        icon={FileWarning}
        tone="error"
        title={t('sessions.codeSession.files.loadErrorTitle', "Couldn't load files")}
        description={
          localError ?? t('sessions.localProject.files.loadFailed', 'Failed to load files.')
        }
        action={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRetryLocalFiles}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('sessions.codeSession.files.retry', 'Try again')}
          </Button>
        }
      />
    );
  }

  if (fileTreeRenderBranch === 'provider-unavailable' || fileTreeRenderBranch === 'unavailable') {
    return (
      <FileTreeStatePanel
        icon={CloudOff}
        title={t('sessions.codeSession.files.unavailableTitle', 'Files unavailable')}
        description={
          emptyFileTreeMessage ??
          providerMessage ??
          t('sessions.codeSession.files.unavailable', 'Files are unavailable.')
        }
      />
    );
  }

  if (fileTreeRenderBranch === 'empty') {
    return (
      <FileTreeStatePanel
        icon={FolderOpen}
        title={t('sessions.codeSession.files.emptyTitle', 'No files here')}
        description={
          emptyFileTreeMessage ?? t('sessions.codeSession.noFiles', 'This directory is empty.')
        }
      />
    );
  }

  return (
    <ScrollArea className="h-full" viewportRef={scrollViewportRef}>
      <div className="p-1">
        {fileTreeRenderBranch === 'virtual-tree' ? (
          <VirtualFileTree data={fileTreeData} viewportRef={scrollViewportRef} />
        ) : (
          <TreeView
            data={fileTreeData}
            defaultNodeIcon={DefaultFolderIcon}
            defaultLeafIcon={DefaultFileIcon}
            className="p-0"
          />
        )}

        {shouldUseLocalFileList && localListTruncated ? (
          <div className="pt-2 text-xs text-muted-foreground">{localTruncatedLabel}</div>
        ) : null}
      </div>
    </ScrollArea>
  );
};
