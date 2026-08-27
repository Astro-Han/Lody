import type { RateLimit } from 'acp-extension-core';
import {
  getAcpCapabilityCacheKey,
  hasBuiltinRuntimeOverrideValues,
  isBuiltinRuntimeOverrides,
  isBuiltinAgentType,
  isCustomAcpLaunchSpec,
  isManagedBuiltinAgentType,
  type AcpCapabilityCacheEntry,
  type AgentConfigCliType,
  type AgentType,
  type CliType,
  type ManagedBuiltinAgentType,
} from './ai';
import type { AgentConfigId, MachineId, SessionId, WorkspaceId } from './ids';
import type {
  LocalProjectId,
  LocalProjectMeta,
  WorktreeCleanupScriptConfig,
  WorktreeSetupScriptConfig,
} from './project';
import {
  buildNeedToDeleteSessionQueueItem,
  mergeNeedToDeleteSessionQueueItem,
  type NeedToDeleteSessionQueueRecord,
} from './session-delete-queue';
import type {
  AgentConfigMeta,
  MachineLegacyMetaFields,
  NeedToDeleteSessionQueueItem,
  SessionLaunchConfig,
  SessionMeta,
} from './schema';

export const MACHINE_FLOCK_DOC_STREAM_SEGMENT = 'mf';

export const getMachineFlockDocId = (workspaceId: WorkspaceId, machineId: MachineId): string =>
  `${workspaceId}:${MACHINE_FLOCK_DOC_STREAM_SEGMENT}:${machineId}`;

export const isMachineFlockDocId = (value: string): boolean => {
  const parts = value.split(':');
  return (
    parts.length === 3 &&
    parts[0] !== '' &&
    parts[1] === MACHINE_FLOCK_DOC_STREAM_SEGMENT &&
    parts[2] !== ''
  );
};

export const parseMachineFlockDocId = (
  value: string
): { workspaceId: WorkspaceId; machineId: MachineId } | undefined => {
  if (!isMachineFlockDocId(value)) {
    return undefined;
  }
  const [workspaceId, , machineId] = value.split(':');
  return {
    workspaceId: workspaceId as WorkspaceId,
    machineId: machineId as MachineId,
  };
};

export type MachineArchiveSessionCommand = {
  v: 1;
  requestedAt: number;
  requestedBy?: string;
};

export type MachineDeleteSessionCommand = {
  v: 1;
  requestedAt: number;
  repoFullName?: string;
  branchName?: string;
  baseBranchName?: string;
  localProjectId?: LocalProjectId;
  originalRootPath?: string;
  isWorktree?: true;
  keptWorktreePath?: string;
};

export type MachineDeleteLocalProjectCommand = {
  v: 1;
  requestedAt: number;
  requestedBy?: string;
};

export const buildMachineArchiveSessionCommand = (options: {
  requestedAt: number;
  requestedBy?: string;
}): MachineArchiveSessionCommand => ({
  v: 1,
  requestedAt: options.requestedAt,
  ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
});

export const shouldQueueMachineDeleteSession = (
  session: Pick<SessionMeta, 'repoFullName' | 'project' | 'isWorktree' | 'parentSessionId'>
): boolean => {
  if (session.parentSessionId) {
    return false;
  }
  return (
    session.isWorktree === true ||
    (session.project?.kind !== 'local' && nonEmptyString(session.repoFullName) !== undefined)
  );
};

export const machineDeleteCommandToQueueItem = (
  command: MachineDeleteSessionCommand
): NeedToDeleteSessionQueueRecord => {
  const { v: _v, ...queueItem } = command;
  return queueItem;
};

export const buildMachineDeleteSessionCommand = (options: {
  session: Pick<
    SessionMeta,
    'project' | 'repoFullName' | 'branchName' | 'baseBranch' | 'isWorktree' | 'parentSessionId'
  >;
  machineMeta?: Pick<MachineLegacyMetaFields, 'localProjects'>;
  requestedAt: number;
  existing?: NeedToDeleteSessionQueueItem | MachineDeleteSessionCommand;
}): MachineDeleteSessionCommand | null => {
  if (!shouldQueueMachineDeleteSession(options.session)) {
    return null;
  }
  const existing =
    options.existing && typeof options.existing === 'object' && 'v' in options.existing
      ? machineDeleteCommandToQueueItem(options.existing)
      : options.existing;
  const queueItem = mergeNeedToDeleteSessionQueueItem(
    existing,
    buildNeedToDeleteSessionQueueItem({
      session: options.session,
      machineMeta: options.machineMeta,
      requestedAt: options.requestedAt,
    })
  );
  const { isWorktree, requestedAt, ...rest } = queueItem;
  return {
    v: 1,
    ...rest,
    requestedAt: requestedAt ?? options.requestedAt,
    ...(isWorktree === true ? { isWorktree: true } : {}),
  };
};

export const buildMachineDeleteLocalProjectCommand = (options: {
  requestedAt: number;
  requestedBy?: string;
}): MachineDeleteLocalProjectCommand => ({
  v: 1,
  requestedAt: options.requestedAt,
  ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
});

export type AgentConfigListSummary = Pick<
  AgentConfigMeta,
  'id' | 'machineId' | 'name' | 'description' | 'cliType' | 'agentType' | 'brandId'
>;

export type ProviderSetupStatus =
  | 'queued'
  | 'preparing-runtime'
  | 'verifying'
  | 'awaiting-auth'
  | 'failed';

export type ProviderSetupFailureCode =
  | 'runtime-unavailable'
  | 'runtime-install-failed'
  | 'verification-failed';

/**
 * Durable intent to create a managed builtin provider on one machine.
 *
 * The final AgentConfig stays nested here and is not discoverable by session
 * creation until the owning machine publishes it after a successful live
 * probe. Provider authorization URLs, codes, and tokens must never be added to
 * this row.
 */
export type ProviderSetupTask = {
  v: 1;
  id: AgentConfigId;
  machineId: MachineId;
  config: AgentConfigMeta;
  status: ProviderSetupStatus;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  failureCode?: ProviderSetupFailureCode;
};

/**
 * Convergent cancellation intent for a provider setup id.
 *
 * This marker remains after the setup row is removed so a target machine that
 * published the matching config concurrently can causally delete it after sync.
 */
export type ProviderSetupCancellation = {
  v: 1;
  id: AgentConfigId;
  machineId: MachineId;
  cancelledAt: number;
};

/**
 * 用户在本机主动删掉某个托管内置 provider 的记录。
 *
 * 启动时的内置 provider 自动注册只知道「列表里现在有没有」，区分不了「从没建过」
 * 和「用户刚删掉」。没有这条记录，删掉的 Kimi/Grok/Claude/Codex 下次启动就会被
 * 重新补回来。用户重新添加同类型 provider 时这条记录必须清掉——显式添加就是收回
 * 之前的删除意图。
 */
export type BuiltinAgentOptOut = {
  v: 1;
  agentType: ManagedBuiltinAgentType;
  machineId: MachineId;
  removedAt: number;
};

export type MachineFlockDotlodyPathKey = ['dotlodyPath'];
export type MachineFlockArchiveSessionCommandKey = ['cmd', 'archiveSession', SessionId];
export type MachineFlockDeleteSessionCommandKey = ['cmd', 'deleteSession', SessionId];
export type MachineFlockDeleteLocalProjectCommandKey = [
  'cmd',
  'deleteLocalProject',
  LocalProjectId,
];
export type MachineFlockLocalProjectKey = ['localProject', LocalProjectId];
export type MachineFlockAgentConfigKey = ['agentConfig', AgentConfigId];
export type MachineFlockProviderSetupKey = ['providerSetup', AgentConfigId];
export type MachineFlockProviderSetupCancellationKey = ['providerSetupCancellation', AgentConfigId];
export type MachineFlockAgentConfigIndexKey = ['agentConfigIndex', AgentConfigId];
export type MachineFlockAcpCapabilityKey = ['acpCapability', AgentConfigId];
export type MachineFlockRateLimitKey = ['rateLimit', CliType, string];
export type MachineFlockBuiltinAgentOptOutKey = ['builtinAgentOptOut', ManagedBuiltinAgentType];
/** @deprecated Compatibility read/cleanup only. New writers must not store launch config per session. */
export type MachineFlockSessionLaunchConfigKey = ['sessionLaunchConfig', SessionId];

export type MachineFlockKey =
  | MachineFlockDotlodyPathKey
  | MachineFlockArchiveSessionCommandKey
  | MachineFlockDeleteSessionCommandKey
  | MachineFlockDeleteLocalProjectCommandKey
  | MachineFlockLocalProjectKey
  | MachineFlockAgentConfigKey
  | MachineFlockProviderSetupKey
  | MachineFlockProviderSetupCancellationKey
  | MachineFlockAgentConfigIndexKey
  | MachineFlockAcpCapabilityKey
  | MachineFlockRateLimitKey
  | MachineFlockBuiltinAgentOptOutKey
  | MachineFlockSessionLaunchConfigKey;

export type ParsedMachineFlockKey =
  | { kind: 'dotlodyPath'; key: MachineFlockDotlodyPathKey }
  | {
      kind: 'archiveSessionCommand';
      key: MachineFlockArchiveSessionCommandKey;
      sessionId: SessionId;
    }
  | {
      kind: 'deleteSessionCommand';
      key: MachineFlockDeleteSessionCommandKey;
      sessionId: SessionId;
    }
  | {
      kind: 'deleteLocalProjectCommand';
      key: MachineFlockDeleteLocalProjectCommandKey;
      localProjectId: LocalProjectId;
    }
  | { kind: 'localProject'; key: MachineFlockLocalProjectKey; localProjectId: LocalProjectId }
  | { kind: 'agentConfig'; key: MachineFlockAgentConfigKey; agentConfigId: AgentConfigId }
  | {
      kind: 'providerSetup';
      key: MachineFlockProviderSetupKey;
      providerSetupId: AgentConfigId;
    }
  | {
      kind: 'providerSetupCancellation';
      key: MachineFlockProviderSetupCancellationKey;
      providerSetupId: AgentConfigId;
    }
  | {
      kind: 'agentConfigIndex';
      key: MachineFlockAgentConfigIndexKey;
      agentConfigId: AgentConfigId;
    }
  | {
      kind: 'acpCapability';
      key: MachineFlockAcpCapabilityKey;
      configId: AgentConfigId;
    }
  | {
      kind: 'rateLimit';
      key: MachineFlockRateLimitKey;
      cliType: CliType;
      limitId: string;
    }
  | {
      kind: 'builtinAgentOptOut';
      key: MachineFlockBuiltinAgentOptOutKey;
      agentType: ManagedBuiltinAgentType;
    }
  | {
      kind: 'sessionLaunchConfig';
      key: MachineFlockSessionLaunchConfigKey;
      sessionId: SessionId;
    };

export const machineFlockKeys = {
  dotlodyPath: (): MachineFlockDotlodyPathKey => ['dotlodyPath'],
  archiveSessionCommand: (sessionId: SessionId): MachineFlockArchiveSessionCommandKey => [
    'cmd',
    'archiveSession',
    sessionId,
  ],
  deleteSessionCommand: (sessionId: SessionId): MachineFlockDeleteSessionCommandKey => [
    'cmd',
    'deleteSession',
    sessionId,
  ],
  deleteLocalProjectCommand: (
    localProjectId: LocalProjectId
  ): MachineFlockDeleteLocalProjectCommandKey => ['cmd', 'deleteLocalProject', localProjectId],
  localProject: (localProjectId: LocalProjectId): MachineFlockLocalProjectKey => [
    'localProject',
    localProjectId,
  ],
  agentConfig: (agentConfigId: AgentConfigId): MachineFlockAgentConfigKey => [
    'agentConfig',
    agentConfigId,
  ],
  providerSetup: (providerSetupId: AgentConfigId): MachineFlockProviderSetupKey => [
    'providerSetup',
    providerSetupId,
  ],
  providerSetupCancellation: (
    providerSetupId: AgentConfigId
  ): MachineFlockProviderSetupCancellationKey => ['providerSetupCancellation', providerSetupId],
  agentConfigIndex: (agentConfigId: AgentConfigId): MachineFlockAgentConfigIndexKey => [
    'agentConfigIndex',
    agentConfigId,
  ],
  acpCapability: (configId: AgentConfigId): MachineFlockAcpCapabilityKey => [
    'acpCapability',
    configId,
  ],
  rateLimit: (cliType: CliType, limitId: string): MachineFlockRateLimitKey => [
    'rateLimit',
    cliType,
    limitId,
  ],
  builtinAgentOptOut: (agentType: ManagedBuiltinAgentType): MachineFlockBuiltinAgentOptOutKey => [
    'builtinAgentOptOut',
    agentType,
  ],
  /** @deprecated Compatibility read/cleanup only. New writers must not store launch config per session. */
  sessionLaunchConfig: (sessionId: SessionId): MachineFlockSessionLaunchConfigKey => [
    'sessionLaunchConfig',
    sessionId,
  ],
} as const;

export const parseMachineFlockKey = (
  key: readonly unknown[]
): ParsedMachineFlockKey | undefined => {
  if (key.length === 1 && key[0] === 'dotlodyPath') {
    return { kind: 'dotlodyPath', key: machineFlockKeys.dotlodyPath() };
  }

  if (
    key.length === 3 &&
    key[0] === 'cmd' &&
    key[1] === 'archiveSession' &&
    isNonEmptyString(key[2])
  ) {
    const sessionId = key[2] as SessionId;
    return {
      kind: 'archiveSessionCommand',
      key: machineFlockKeys.archiveSessionCommand(sessionId),
      sessionId,
    };
  }

  if (
    key.length === 3 &&
    key[0] === 'cmd' &&
    key[1] === 'deleteSession' &&
    isNonEmptyString(key[2])
  ) {
    const sessionId = key[2] as SessionId;
    return {
      kind: 'deleteSessionCommand',
      key: machineFlockKeys.deleteSessionCommand(sessionId),
      sessionId,
    };
  }

  if (
    key.length === 3 &&
    key[0] === 'cmd' &&
    key[1] === 'deleteLocalProject' &&
    isNonEmptyString(key[2])
  ) {
    const localProjectId = key[2] as LocalProjectId;
    return {
      kind: 'deleteLocalProjectCommand',
      key: machineFlockKeys.deleteLocalProjectCommand(localProjectId),
      localProjectId,
    };
  }

  if (key.length === 2 && key[0] === 'localProject' && isNonEmptyString(key[1])) {
    const localProjectId = key[1] as LocalProjectId;
    return {
      kind: 'localProject',
      key: machineFlockKeys.localProject(localProjectId),
      localProjectId,
    };
  }

  if (key.length === 2 && key[0] === 'agentConfig' && isNonEmptyString(key[1])) {
    const agentConfigId = key[1] as AgentConfigId;
    return {
      kind: 'agentConfig',
      key: machineFlockKeys.agentConfig(agentConfigId),
      agentConfigId,
    };
  }

  if (key.length === 2 && key[0] === 'providerSetup' && isNonEmptyString(key[1])) {
    const providerSetupId = key[1] as AgentConfigId;
    return {
      kind: 'providerSetup',
      key: machineFlockKeys.providerSetup(providerSetupId),
      providerSetupId,
    };
  }

  if (key.length === 2 && key[0] === 'providerSetupCancellation' && isNonEmptyString(key[1])) {
    const providerSetupId = key[1] as AgentConfigId;
    return {
      kind: 'providerSetupCancellation',
      key: machineFlockKeys.providerSetupCancellation(providerSetupId),
      providerSetupId,
    };
  }

  if (key.length === 2 && key[0] === 'agentConfigIndex' && isNonEmptyString(key[1])) {
    const agentConfigId = key[1] as AgentConfigId;
    return {
      kind: 'agentConfigIndex',
      key: machineFlockKeys.agentConfigIndex(agentConfigId),
      agentConfigId,
    };
  }

  if (key.length === 2 && key[0] === 'acpCapability' && isNonEmptyString(key[1])) {
    const configId = key[1] as AgentConfigId;
    return {
      kind: 'acpCapability',
      key: machineFlockKeys.acpCapability(configId),
      configId,
    };
  }

  if (key.length === 3 && key[0] === 'rateLimit' && isCliType(key[1]) && isNonEmptyString(key[2])) {
    return {
      kind: 'rateLimit',
      key: machineFlockKeys.rateLimit(key[1], key[2]),
      cliType: key[1],
      limitId: key[2],
    };
  }

  if (
    key.length === 2 &&
    key[0] === 'builtinAgentOptOut' &&
    typeof key[1] === 'string' &&
    isManagedBuiltinAgentType(key[1])
  ) {
    return {
      kind: 'builtinAgentOptOut',
      key: machineFlockKeys.builtinAgentOptOut(key[1]),
      agentType: key[1],
    };
  }

  if (key.length === 2 && key[0] === 'sessionLaunchConfig' && isNonEmptyString(key[1])) {
    const sessionId = key[1] as SessionId;
    return {
      kind: 'sessionLaunchConfig',
      key: machineFlockKeys.sessionLaunchConfig(sessionId),
      sessionId,
    };
  }

  return undefined;
};

export type MachineFlockRow =
  | { key: MachineFlockDotlodyPathKey; value: string }
  | { key: MachineFlockArchiveSessionCommandKey; value: MachineArchiveSessionCommand }
  | { key: MachineFlockDeleteSessionCommandKey; value: MachineDeleteSessionCommand }
  | {
      key: MachineFlockDeleteLocalProjectCommandKey;
      value: MachineDeleteLocalProjectCommand;
    }
  | { key: MachineFlockLocalProjectKey; value: LocalProjectMeta }
  | { key: MachineFlockAgentConfigKey; value: AgentConfigMeta }
  | { key: MachineFlockProviderSetupKey; value: ProviderSetupTask }
  | {
      key: MachineFlockProviderSetupCancellationKey;
      value: ProviderSetupCancellation;
    }
  | { key: MachineFlockAgentConfigIndexKey; value: AgentConfigListSummary }
  | { key: MachineFlockAcpCapabilityKey; value: AcpCapabilityCacheEntry }
  | { key: MachineFlockRateLimitKey; value: RateLimit }
  | { key: MachineFlockBuiltinAgentOptOutKey; value: BuiltinAgentOptOut }
  | { key: MachineFlockSessionLaunchConfigKey; value: SessionLaunchConfig };

export type MachineFlockRowId = string & { __brand: 'MachineFlockRowId' };
export type MachineFlockRowMap = Record<MachineFlockRowId, MachineFlockRow>;

export type MachineFlockScanRow = {
  readonly key: readonly unknown[];
  readonly value?: unknown;
};

export type MachineFlockEvent = MachineFlockScanRow;

export type MachineFlockScanOptions = {
  readonly prefix?: readonly unknown[];
};

export type MachineFlockReadableFlock = {
  scan(options?: MachineFlockScanOptions): Iterable<MachineFlockScanRow>;
};

export type MachineFlockWritableFlock = MachineFlockReadableFlock & {
  set(key: MachineFlockKey, value: unknown, timestamp?: number): void;
  delete(key: MachineFlockKey, timestamp?: number): void;
  commit(): void;
};

export const serializeMachineFlockKey = (key: MachineFlockKey): MachineFlockRowId =>
  JSON.stringify(key) as MachineFlockRowId;

export type MachineFlockRowFamily =
  | 'dotlodyPath'
  | 'archiveSessionCommand'
  | 'deleteSessionCommand'
  | 'deleteLocalProjectCommand'
  | 'localProject'
  | 'agentConfig'
  | 'providerSetup'
  | 'providerSetupCancellation'
  | 'agentConfigIndex'
  | 'acpCapability'
  | 'rateLimit'
  | 'builtinAgentOptOut'
  | 'sessionLaunchConfig';

const MACHINE_FLOCK_ROW_FAMILY_PREFIXES: Record<MachineFlockRowFamily, readonly unknown[]> = {
  dotlodyPath: ['dotlodyPath'],
  archiveSessionCommand: ['cmd', 'archiveSession'],
  deleteSessionCommand: ['cmd', 'deleteSession'],
  deleteLocalProjectCommand: ['cmd', 'deleteLocalProject'],
  localProject: ['localProject'],
  agentConfig: ['agentConfig'],
  providerSetup: ['providerSetup'],
  providerSetupCancellation: ['providerSetupCancellation'],
  agentConfigIndex: ['agentConfigIndex'],
  acpCapability: ['acpCapability'],
  rateLimit: ['rateLimit'],
  builtinAgentOptOut: ['builtinAgentOptOut'],
  sessionLaunchConfig: ['sessionLaunchConfig'],
};

export type ReadMachineFlockRowsOptions = {
  readonly families?: readonly MachineFlockRowFamily[];
  readonly prefixes?: readonly (readonly unknown[])[];
};

function getMachineFlockScanPrefixes(
  options: ReadMachineFlockRowsOptions | undefined
): readonly (readonly unknown[])[] | null {
  const prefixes: readonly (readonly unknown[])[] = [
    ...(options?.prefixes ?? []),
    ...(options?.families?.map((family) => MACHINE_FLOCK_ROW_FAMILY_PREFIXES[family]) ?? []),
  ];
  if (prefixes.length === 0) return null;
  const seen = new Set<string>();
  return prefixes.filter((prefix) => {
    const serialized = JSON.stringify(prefix);
    if (seen.has(serialized)) return false;
    seen.add(serialized);
    return true;
  });
}

export function readMachineFlockRowsFromFlock(
  flock: MachineFlockReadableFlock,
  options?: ReadMachineFlockRowsOptions
): MachineFlockRowMap {
  const rows: MachineFlockRowMap = {};
  const prefixes = getMachineFlockScanPrefixes(options);
  const scans = prefixes?.map((prefix) => flock.scan({ prefix })) ?? [flock.scan()];
  for (const scan of scans) {
    for (const row of scan) {
      const parsed = parseMachineFlockRow(row.key, row.value);
      if (!parsed) {
        continue;
      }
      rows[serializeMachineFlockKey(parsed.key)] = parsed;
    }
  }
  return rows;
}

export function getMachineFlockDotlodyPath(rows: MachineFlockRowMap): string | undefined {
  const row = rows[serializeMachineFlockKey(machineFlockKeys.dotlodyPath())];
  if (!row || row.key[0] !== 'dotlodyPath' || typeof row.value !== 'string') {
    return undefined;
  }
  return row.value;
}

const isMachineFlockLocalProjectRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockLocalProjectKey }> =>
  row.key[0] === 'localProject';

const isMachineFlockDeleteLocalProjectCommandRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockDeleteLocalProjectCommandKey }> =>
  row.key[0] === 'cmd' && row.key[1] === 'deleteLocalProject';

const isMachineFlockAcpCapabilityRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockAcpCapabilityKey }> =>
  row.key[0] === 'acpCapability';

const isMachineFlockAgentConfigRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockAgentConfigKey }> =>
  row.key[0] === 'agentConfig';

const isMachineFlockProviderSetupRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockProviderSetupKey }> =>
  row.key[0] === 'providerSetup';

const isMachineFlockProviderSetupCancellationRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockProviderSetupCancellationKey }> =>
  row.key[0] === 'providerSetupCancellation';

const isMachineFlockRateLimitRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockRateLimitKey }> => row.key[0] === 'rateLimit';

const isMachineFlockBuiltinAgentOptOutRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockBuiltinAgentOptOutKey }> =>
  row.key[0] === 'builtinAgentOptOut';

const isMachineFlockSessionLaunchConfigRow = (
  row: MachineFlockRow
): row is Extract<MachineFlockRow, { key: MachineFlockSessionLaunchConfigKey }> =>
  row.key[0] === 'sessionLaunchConfig';

const getMachineFlockRateLimitEntryKey = (cliType: CliType, limitId: string): string =>
  `${cliType}::${limitId.trim() || cliType}`;

export function getMachineFlockLocalProjects(
  rows: MachineFlockRowMap
): Record<LocalProjectId, LocalProjectMeta> {
  const localProjects: Record<LocalProjectId, LocalProjectMeta> = {};
  for (const row of Object.values(rows)) {
    if (!isMachineFlockLocalProjectRow(row)) {
      continue;
    }
    localProjects[row.key[1]] = row.value;
  }
  return localProjects;
}

export function getMachineFlockDeleteLocalProjectEntries(
  rows: MachineFlockRowMap
): Array<[LocalProjectId, MachineDeleteLocalProjectCommand]> {
  const entries: Array<[LocalProjectId, MachineDeleteLocalProjectCommand]> = [];
  for (const row of Object.values(rows)) {
    if (!isMachineFlockDeleteLocalProjectCommandRow(row)) {
      continue;
    }
    entries.push([row.key[2], row.value]);
  }
  return entries;
}

export function getMachineFlockDeleteLocalProjectIds(
  rows: MachineFlockRowMap
): Set<LocalProjectId> {
  return new Set(
    getMachineFlockDeleteLocalProjectEntries(rows).map(([localProjectId]) => localProjectId)
  );
}

export function getMachineFlockAcpCapabilities(
  rows: MachineFlockRowMap
): Record<string, AcpCapabilityCacheEntry> {
  const capabilities: Record<string, AcpCapabilityCacheEntry> = {};
  for (const row of Object.values(rows)) {
    if (!isMachineFlockAcpCapabilityRow(row)) {
      continue;
    }
    capabilities[getAcpCapabilityCacheKey(row.key[1])] = row.value;
  }
  return capabilities;
}

export function getMachineFlockAgentConfigs(
  rows: MachineFlockRowMap
): Record<AgentConfigId, AgentConfigMeta> {
  const agentConfigs: Record<AgentConfigId, AgentConfigMeta> = {};
  for (const row of Object.values(rows)) {
    if (!isMachineFlockAgentConfigRow(row)) {
      continue;
    }
    agentConfigs[row.key[1]] = row.value;
  }
  return agentConfigs;
}

export function getMachineFlockProviderSetups(
  rows: MachineFlockRowMap
): Record<AgentConfigId, ProviderSetupTask> {
  const providerSetups: Record<AgentConfigId, ProviderSetupTask> = {};
  for (const row of Object.values(rows)) {
    if (!isMachineFlockProviderSetupRow(row)) {
      continue;
    }
    providerSetups[row.key[1]] = row.value;
  }
  return providerSetups;
}

export function getMachineFlockProviderSetupCancellations(
  rows: MachineFlockRowMap
): Record<AgentConfigId, ProviderSetupCancellation> {
  const cancellations: Record<AgentConfigId, ProviderSetupCancellation> = {};
  for (const row of Object.values(rows)) {
    if (!isMachineFlockProviderSetupCancellationRow(row)) {
      continue;
    }
    cancellations[row.key[1]] = row.value;
  }
  return cancellations;
}

export function applyProviderSetupCancellationToFlock(
  flock: MachineFlockWritableFlock,
  cancellation: ProviderSetupCancellation,
  nowMs: number = cancellation.cancelledAt
): boolean {
  const rows = readMachineFlockRowsFromFlock(flock, {
    prefixes: [
      machineFlockKeys.providerSetupCancellation(cancellation.id),
      machineFlockKeys.providerSetup(cancellation.id),
      machineFlockKeys.agentConfig(cancellation.id),
    ],
  });
  const existingCancellation = getMachineFlockProviderSetupCancellations(rows)[cancellation.id];
  const setup = getMachineFlockProviderSetups(rows)[cancellation.id];
  const config = getMachineFlockAgentConfigs(rows)[cancellation.id];
  if (existingCancellation && !setup && !config) {
    return false;
  }
  if (!existingCancellation) {
    flock.set(machineFlockKeys.providerSetupCancellation(cancellation.id), cancellation, nowMs);
  }
  if (setup) {
    flock.delete(machineFlockKeys.providerSetup(cancellation.id), nowMs);
  }
  if (config) {
    flock.delete(machineFlockKeys.agentConfig(cancellation.id), nowMs);
  }
  flock.commit();
  return true;
}

export function getMachineFlockRateLimits(rows: MachineFlockRowMap): Record<string, RateLimit> {
  const rateLimits: Record<string, RateLimit> = {};
  for (const row of Object.values(rows)) {
    if (!isMachineFlockRateLimitRow(row)) {
      continue;
    }
    rateLimits[getMachineFlockRateLimitEntryKey(row.key[1], row.key[2])] = row.value;
  }
  return rateLimits;
}

/** 本机被用户主动删掉、因而不该自动补回来的托管内置 provider 类型。 */
export function getMachineFlockBuiltinAgentOptOuts(
  rows: MachineFlockRowMap
): Set<ManagedBuiltinAgentType> {
  const optedOut = new Set<ManagedBuiltinAgentType>();
  for (const row of Object.values(rows)) {
    if (!isMachineFlockBuiltinAgentOptOutRow(row)) {
      continue;
    }
    optedOut.add(row.key[1]);
  }
  return optedOut;
}

export function getMachineFlockSessionLaunchConfig(
  rows: MachineFlockRowMap,
  sessionId: SessionId
): SessionLaunchConfig | undefined {
  const row = rows[serializeMachineFlockKey(machineFlockKeys.sessionLaunchConfig(sessionId))];
  if (!row || !isMachineFlockSessionLaunchConfigRow(row)) {
    return undefined;
  }
  return row.value;
}

export function buildSessionLaunchConfig(
  input: Partial<SessionLaunchConfig> | null | undefined
): SessionLaunchConfig | undefined {
  if (!input) {
    return undefined;
  }
  const config: SessionLaunchConfig = {};
  if (input.customAcp) {
    config.customAcp = input.customAcp;
  }
  if (
    input.runtimeOverrides &&
    Object.values(input.runtimeOverrides).some((value) => value && value.trim().length > 0)
  ) {
    config.runtimeOverrides = input.runtimeOverrides;
  }
  if (input.env && Object.keys(input.env).length > 0) {
    config.env = input.env;
  }
  if (input.worktreeSetup) {
    config.worktreeSetup = input.worktreeSetup;
  }
  if (input.worktreeCleanup) {
    config.worktreeCleanup = input.worktreeCleanup;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

export function mergeSessionLaunchConfig(
  primary: SessionLaunchConfig | undefined,
  fallback: SessionLaunchConfig | undefined
): SessionLaunchConfig | undefined {
  return buildSessionLaunchConfig({
    customAcp: primary?.customAcp ?? fallback?.customAcp,
    runtimeOverrides: primary?.runtimeOverrides ?? fallback?.runtimeOverrides,
    env: primary?.env ?? fallback?.env,
    worktreeSetup: primary?.worktreeSetup ?? fallback?.worktreeSetup,
    worktreeCleanup: primary?.worktreeCleanup ?? fallback?.worktreeCleanup,
  });
}

export function getSessionLaunchConfigLegacyFields(
  session: SessionMeta | null | undefined
): SessionLaunchConfig | undefined {
  return normalizeSessionLaunchConfig(session);
}

export function writeMachineFlockRowToFlock(
  flock: MachineFlockWritableFlock,
  row: MachineFlockRow,
  nowMs?: number
): boolean {
  const normalized = parseMachineFlockRow(row.key, row.value);
  if (!normalized) {
    return false;
  }
  const previous = readMachineFlockRowsFromFlock(flock, {
    prefixes: [normalized.key],
  })[serializeMachineFlockKey(normalized.key)];
  if (machineFlockRowsEqual(previous, normalized)) {
    return false;
  }
  flock.set(normalized.key, normalized.value, nowMs);
  flock.commit();
  return true;
}

export function deleteMachineFlockRowFromFlock(
  flock: MachineFlockWritableFlock,
  key: MachineFlockKey,
  nowMs?: number
): boolean {
  const rowId = serializeMachineFlockKey(key);
  const previous = readMachineFlockRowsFromFlock(flock, { prefixes: [key] })[rowId];
  if (!previous) {
    return false;
  }
  flock.delete(key, nowMs);
  flock.commit();
  return true;
}

export function applyMachineFlockRowEvents(
  previous: MachineFlockRowMap,
  events: readonly MachineFlockEvent[]
): MachineFlockRowMap {
  let next: MachineFlockRowMap | null = null;
  const mutableNext = (): MachineFlockRowMap => {
    next ??= { ...previous };
    return next;
  };

  for (const event of events) {
    const parsedKey = parseMachineFlockKey(event.key);
    if (!parsedKey) {
      continue;
    }
    const rowId = serializeMachineFlockKey(parsedKey.key);
    const current = next ?? previous;

    if (event.value === undefined) {
      if (Object.prototype.hasOwnProperty.call(current, rowId)) {
        delete mutableNext()[rowId];
      }
      continue;
    }

    const parsed = parseMachineFlockRow(event.key, event.value);
    if (!parsed) {
      if (Object.prototype.hasOwnProperty.call(current, rowId)) {
        delete mutableNext()[rowId];
      }
      continue;
    }

    if (machineFlockRowsEqual(current[rowId], parsed)) {
      continue;
    }
    mutableNext()[rowId] = parsed;
  }

  return next ?? previous;
}

export function parseMachineFlockRow(
  key: readonly unknown[],
  value: unknown
): MachineFlockRow | undefined {
  const parsedKey = parseMachineFlockKey(key);
  if (!parsedKey || value === undefined) {
    return undefined;
  }

  switch (parsedKey.kind) {
    case 'dotlodyPath':
      return typeof value === 'string' && value.trim() ? { key: parsedKey.key, value } : undefined;
    case 'archiveSessionCommand': {
      const command = normalizeMachineArchiveSessionCommand(value);
      return command ? { key: parsedKey.key, value: command } : undefined;
    }
    case 'deleteSessionCommand': {
      const command = normalizeMachineDeleteSessionCommand(value);
      return command ? { key: parsedKey.key, value: command } : undefined;
    }
    case 'deleteLocalProjectCommand': {
      const command = normalizeMachineDeleteLocalProjectCommand(value);
      return command ? { key: parsedKey.key, value: command } : undefined;
    }
    case 'localProject': {
      const project = normalizeLocalProjectMeta(value);
      return project ? { key: parsedKey.key, value: project } : undefined;
    }
    case 'agentConfig': {
      const config = normalizeAgentConfigMeta(value);
      return config ? { key: parsedKey.key, value: config } : undefined;
    }
    case 'providerSetup': {
      const setup = normalizeProviderSetupTask(value);
      return setup && setup.id === parsedKey.providerSetupId
        ? { key: parsedKey.key, value: setup }
        : undefined;
    }
    case 'providerSetupCancellation': {
      const cancellation = normalizeProviderSetupCancellation(value);
      return cancellation && cancellation.id === parsedKey.providerSetupId
        ? { key: parsedKey.key, value: cancellation }
        : undefined;
    }
    case 'agentConfigIndex': {
      const summary = normalizeAgentConfigListSummary(value);
      return summary ? { key: parsedKey.key, value: summary } : undefined;
    }
    case 'acpCapability':
      return isAcpCapabilityCacheEntry(value) ? { key: parsedKey.key, value } : undefined;
    case 'rateLimit':
      return isRecord(value) ? { key: parsedKey.key, value: value as RateLimit } : undefined;
    case 'builtinAgentOptOut': {
      const optOut = normalizeBuiltinAgentOptOut(value);
      return optOut && optOut.agentType === parsedKey.agentType
        ? { key: parsedKey.key, value: optOut }
        : undefined;
    }
    case 'sessionLaunchConfig': {
      const config = normalizeSessionLaunchConfig(value);
      return config ? { key: parsedKey.key, value: config } : undefined;
    }
  }
  return undefined;
}

export function machineFlockRowsEqual(
  left: MachineFlockRow | undefined,
  right: MachineFlockRow | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    serializeMachineFlockKey(left.key) === serializeMachineFlockKey(right.key) &&
    JSON.stringify(left.value) === JSON.stringify(right.value)
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const nonEmptyString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isMissing = (value: unknown): value is null | undefined =>
  value === undefined || value === null;

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const normalizeWorktreeScriptConfig = (
  value: unknown
): WorktreeSetupScriptConfig | WorktreeCleanupScriptConfig | undefined => {
  if (!isRecord(value) || !isRecord(value.scripts)) {
    return undefined;
  }
  for (const key of Object.keys(value.scripts)) {
    if (key !== 'bash' && key !== 'powershell') {
      return undefined;
    }
  }

  const scripts: WorktreeSetupScriptConfig['scripts'] = {};
  if (!isMissing(value.scripts.bash)) {
    if (typeof value.scripts.bash !== 'string') {
      return undefined;
    }
    scripts.bash = value.scripts.bash;
  }

  if (!isMissing(value.scripts.powershell)) {
    if (typeof value.scripts.powershell !== 'string') {
      return undefined;
    }
    scripts.powershell = value.scripts.powershell;
  }

  const config: WorktreeSetupScriptConfig = { scripts };
  if (!isMissing(value.timeoutMs)) {
    if (
      typeof value.timeoutMs !== 'number' ||
      !Number.isInteger(value.timeoutMs) ||
      value.timeoutMs <= 0
    ) {
      return undefined;
    }
    config.timeoutMs = value.timeoutMs;
  }

  return config;
};

const normalizeSessionLaunchConfig = (value: unknown): SessionLaunchConfig | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const config: SessionLaunchConfig = {};
  if (!isMissing(value.customAcp)) {
    if (!isCustomAcpLaunchSpec(value.customAcp)) {
      return undefined;
    }
    config.customAcp = value.customAcp;
  }
  if (!isMissing(value.env)) {
    if (!isStringRecord(value.env)) {
      return undefined;
    }
    if (Object.keys(value.env).length > 0) {
      config.env = value.env;
    }
  }
  if (!isMissing(value.runtimeOverrides)) {
    if (!isBuiltinRuntimeOverrides(value.runtimeOverrides)) {
      return undefined;
    }
    if (
      Object.values(value.runtimeOverrides).some(
        (override) => typeof override === 'string' && override.trim().length > 0
      )
    ) {
      config.runtimeOverrides = value.runtimeOverrides;
    }
  }
  if (!isMissing(value.worktreeSetup)) {
    const worktreeSetup = normalizeWorktreeScriptConfig(value.worktreeSetup);
    if (!worktreeSetup) {
      return undefined;
    }
    config.worktreeSetup = worktreeSetup;
  }
  if (!isMissing(value.worktreeCleanup)) {
    const worktreeCleanup = normalizeWorktreeScriptConfig(value.worktreeCleanup);
    if (!worktreeCleanup) {
      return undefined;
    }
    config.worktreeCleanup = worktreeCleanup;
  }
  return Object.keys(config).length > 0 ? config : undefined;
};

const isCliType = (value: unknown): value is CliType =>
  typeof value === 'string' && isBuiltinAgentType(value);

const isAgentConfigCliType = (value: unknown): value is AgentConfigCliType =>
  value === 'builtin' || value === 'registry' || value === 'custom';

const normalizeMachineArchiveSessionCommand = (
  value: unknown
): MachineArchiveSessionCommand | undefined => {
  if (!isRecord(value) || value.v !== 1 || typeof value.requestedAt !== 'number') {
    return undefined;
  }

  const command: MachineArchiveSessionCommand = {
    v: 1,
    requestedAt: value.requestedAt,
  };
  if (!isMissing(value.requestedBy)) {
    if (typeof value.requestedBy !== 'string') {
      return undefined;
    }
    command.requestedBy = value.requestedBy;
  }
  return command;
};

const normalizeMachineDeleteSessionCommand = (
  value: unknown
): MachineDeleteSessionCommand | undefined => {
  if (!isRecord(value) || value.v !== 1 || typeof value.requestedAt !== 'number') {
    return undefined;
  }

  const command: MachineDeleteSessionCommand = {
    v: 1,
    requestedAt: value.requestedAt,
  };
  if (!isMissing(value.repoFullName)) {
    if (typeof value.repoFullName !== 'string') return undefined;
    command.repoFullName = value.repoFullName;
  }
  if (!isMissing(value.branchName)) {
    if (typeof value.branchName !== 'string') return undefined;
    command.branchName = value.branchName;
  }
  if (!isMissing(value.baseBranchName)) {
    if (typeof value.baseBranchName !== 'string') return undefined;
    command.baseBranchName = value.baseBranchName;
  }
  if (!isMissing(value.localProjectId)) {
    if (typeof value.localProjectId !== 'string') return undefined;
    command.localProjectId = value.localProjectId as LocalProjectId;
  }
  if (!isMissing(value.originalRootPath)) {
    if (typeof value.originalRootPath !== 'string') return undefined;
    command.originalRootPath = value.originalRootPath;
  }
  if (!isMissing(value.isWorktree)) {
    if (value.isWorktree !== true) return undefined;
    command.isWorktree = true;
  }
  if (!isMissing(value.keptWorktreePath)) {
    if (typeof value.keptWorktreePath !== 'string') return undefined;
    command.keptWorktreePath = value.keptWorktreePath;
  }
  return command;
};

const normalizeMachineDeleteLocalProjectCommand = (
  value: unknown
): MachineDeleteLocalProjectCommand | undefined => {
  if (!isRecord(value) || value.v !== 1 || typeof value.requestedAt !== 'number') {
    return undefined;
  }

  const command: MachineDeleteLocalProjectCommand = {
    v: 1,
    requestedAt: value.requestedAt,
  };
  if (!isMissing(value.requestedBy)) {
    if (typeof value.requestedBy !== 'string') {
      return undefined;
    }
    command.requestedBy = value.requestedBy;
  }
  return command;
};

const normalizeLocalProjectMeta = (value: unknown): LocalProjectMeta | undefined => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    !isNonEmptyString(value.rootPath) ||
    typeof value.createdAtMs !== 'number'
  ) {
    return undefined;
  }

  const project: LocalProjectMeta = {
    id: value.id as LocalProjectId,
    name: value.name,
    rootPath: value.rootPath,
    createdAtMs: value.createdAtMs,
  };
  if (!isMissing(value.lastOpenedAtMs)) {
    if (typeof value.lastOpenedAtMs !== 'number') {
      return undefined;
    }
    project.lastOpenedAtMs = value.lastOpenedAtMs;
  }
  if (!isMissing(value.history)) {
    project.history = value.history as LocalProjectMeta['history'];
  }
  return project;
};

const normalizeAgentConfigMeta = (value: unknown): AgentConfigMeta | undefined => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.machineId) ||
    !isNonEmptyString(value.name) ||
    (!isMissing(value.description) && typeof value.description !== 'string') ||
    !isAgentConfigCliType(value.cliType) ||
    !isNonEmptyString(value.agentType) ||
    !isStringRecord(value.env)
  ) {
    return undefined;
  }

  const config = {
    id: value.id as AgentConfigId,
    machineId: value.machineId as MachineId,
    name: value.name,
    cliType: value.cliType,
    agentType: value.agentType as AgentType,
    env: value.env,
  } as AgentConfigMeta;

  if (typeof value.description === 'string') {
    config.description = value.description;
  }
  if (!isMissing(value.customAcp)) {
    if (!isCustomAcpLaunchSpec(value.customAcp)) return undefined;
    config.customAcp = value.customAcp;
  }
  if (!isMissing(value.runtimeOverrides)) {
    if (!isBuiltinRuntimeOverrides(value.runtimeOverrides)) return undefined;
    config.runtimeOverrides = value.runtimeOverrides;
  }
  if (!isMissing(value.prompt)) {
    if (typeof value.prompt !== 'string') return undefined;
    config.prompt = value.prompt;
  }
  if (!isMissing(value.titleGeneration)) {
    if (!isRecord(value.titleGeneration)) return undefined;
    config.titleGeneration = value.titleGeneration as AgentConfigMeta['titleGeneration'];
  }
  if (!isMissing(value.brandId)) {
    if (typeof value.brandId !== 'string') return undefined;
    config.brandId = value.brandId as AgentConfigMeta['brandId'];
  }

  return config;
};

const isProviderSetupStatus = (value: unknown): value is ProviderSetupStatus =>
  value === 'queued' ||
  value === 'preparing-runtime' ||
  value === 'verifying' ||
  value === 'awaiting-auth' ||
  value === 'failed';

const isProviderSetupFailureCode = (value: unknown): value is ProviderSetupFailureCode =>
  value === 'runtime-unavailable' ||
  value === 'runtime-install-failed' ||
  value === 'verification-failed';

const normalizeProviderSetupTask = (value: unknown): ProviderSetupTask | undefined => {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.machineId) ||
    !isProviderSetupStatus(value.status) ||
    typeof value.attempt !== 'number' ||
    !Number.isInteger(value.attempt) ||
    value.attempt < 1 ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt)
  ) {
    return undefined;
  }
  const config = normalizeAgentConfigMeta(value.config);
  if (
    !config ||
    config.id !== value.id ||
    config.machineId !== value.machineId ||
    config.cliType !== 'builtin' ||
    !isBuiltinAgentType(config.agentType) ||
    hasBuiltinRuntimeOverrideValues(config.runtimeOverrides)
  ) {
    return undefined;
  }
  if (!isMissing(value.failureCode) && !isProviderSetupFailureCode(value.failureCode)) {
    return undefined;
  }

  return {
    v: 1,
    id: value.id as AgentConfigId,
    machineId: value.machineId as MachineId,
    config,
    status: value.status,
    attempt: value.attempt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.failureCode ? { failureCode: value.failureCode } : {}),
  };
};

const normalizeProviderSetupCancellation = (
  value: unknown
): ProviderSetupCancellation | undefined => {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.machineId) ||
    typeof value.cancelledAt !== 'number' ||
    !Number.isFinite(value.cancelledAt)
  ) {
    return undefined;
  }
  return {
    v: 1,
    id: value.id as AgentConfigId,
    machineId: value.machineId as MachineId,
    cancelledAt: value.cancelledAt,
  };
};

const normalizeBuiltinAgentOptOut = (value: unknown): BuiltinAgentOptOut | undefined => {
  if (
    !isRecord(value) ||
    value.v !== 1 ||
    typeof value.agentType !== 'string' ||
    !isManagedBuiltinAgentType(value.agentType) ||
    !isNonEmptyString(value.machineId) ||
    typeof value.removedAt !== 'number' ||
    !Number.isFinite(value.removedAt)
  ) {
    return undefined;
  }
  return {
    v: 1,
    agentType: value.agentType,
    machineId: value.machineId as MachineId,
    removedAt: value.removedAt,
  };
};

const normalizeAgentConfigListSummary = (value: unknown): AgentConfigListSummary | undefined => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.machineId) ||
    !isNonEmptyString(value.name) ||
    (!isMissing(value.description) && typeof value.description !== 'string') ||
    !isAgentConfigCliType(value.cliType) ||
    !isNonEmptyString(value.agentType) ||
    (!isMissing(value.brandId) && typeof value.brandId !== 'string')
  ) {
    return undefined;
  }

  const summary = {
    id: value.id as AgentConfigId,
    machineId: value.machineId as MachineId,
    name: value.name,
    cliType: value.cliType,
    agentType: value.agentType as AgentType,
  } as AgentConfigListSummary;
  if (typeof value.description === 'string') {
    summary.description = value.description;
  }
  if (typeof value.brandId === 'string') {
    summary.brandId = value.brandId as AgentConfigMeta['brandId'];
  }
  return summary;
};

const isAcpCapabilityCacheEntry = (value: unknown): value is AcpCapabilityCacheEntry =>
  isRecord(value) &&
  isAgentConfigCliType(value.cliType) &&
  isNonEmptyString(value.agentType) &&
  Array.isArray(value.modes) &&
  Array.isArray(value.models) &&
  typeof value.fetchedAt === 'number';
