import { describe, expect, it, vi } from 'vitest';
import type { LoroRepo } from 'loro-repo';
import {
  machineFlockKeys,
  type AgentConfigMeta,
  type MachineFlockKey,
  type MachineId,
  type WorkspaceId,
} from '@lody/shared';
import {
  deleteMachineAgentConfig,
  readMachineAgentConfigs,
  readMachineBuiltinAgentOptOuts,
  upsertMachineAgentConfig,
} from '../src/lib/agent-config-machine-flock';

const workspaceId = 'workspace-1' as WorkspaceId;
const machineId = 'machine-1' as MachineId;

/** 最小内存版 flock：只做 key → value 存取,足够验证行和墓碑的写/删。 */
class FakeFlock {
  readonly rows = new Map<string, { key: MachineFlockKey; value: unknown }>();

  scan(options?: { prefix?: readonly unknown[] }) {
    return [...this.rows.values()].filter((row) => {
      const prefix = options?.prefix;
      return !prefix || prefix.every((part, index) => row.key[index] === part);
    });
  }

  set(key: MachineFlockKey, value: unknown): void {
    this.rows.set(JSON.stringify(key), { key: [...key] as MachineFlockKey, value });
  }

  delete(key: MachineFlockKey): void {
    this.rows.delete(JSON.stringify(key));
  }

  commit(): void {}
}

function createFakeRepo() {
  const flock = new FakeFlock();
  const repo = {
    openFlockDoc: vi.fn(async () => ({ flock, syncOnce: vi.fn(async () => {}) })),
    getDocMeta: vi.fn(async () => null),
    deleteDoc: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  } as unknown as LoroRepo;
  return { repo, flock };
}

const kimiConfig: AgentConfigMeta = {
  id: 'agent-config-kimi',
  machineId,
  name: 'Kimi Code',
  cliType: 'builtin',
  agentType: 'kimi',
  env: {},
} as AgentConfigMeta;

const customConfig: AgentConfigMeta = {
  id: 'agent-config-custom',
  machineId,
  name: 'My ACP',
  cliType: 'custom',
  agentType: 'custom-acp',
  env: {},
} as AgentConfigMeta;

describe('machine flock agent config opt-out', () => {
  it('records an opt-out when a managed builtin config is deleted', async () => {
    const { repo, flock } = createFakeRepo();
    await upsertMachineAgentConfig(repo, workspaceId, kimiConfig);
    expect(Object.keys(await readMachineAgentConfigs(repo, workspaceId, machineId))).toHaveLength(
      1
    );

    await deleteMachineAgentConfig(repo, workspaceId, kimiConfig);

    // 行没了,墓碑在——下次启动的自动注册靠这条墓碑才知道「用户删过」。
    expect(await readMachineAgentConfigs(repo, workspaceId, machineId)).toEqual({});
    expect(await readMachineBuiltinAgentOptOuts(repo, workspaceId, machineId)).toEqual(
      new Set(['kimi'])
    );
    const optOutRow = flock.rows.get(JSON.stringify(machineFlockKeys.builtinAgentOptOut('kimi')));
    expect(optOutRow?.value).toMatchObject({ v: 1, agentType: 'kimi', machineId });
  });

  it('clears the opt-out when the same builtin type is added back', async () => {
    const { repo } = createFakeRepo();
    await upsertMachineAgentConfig(repo, workspaceId, kimiConfig);
    await deleteMachineAgentConfig(repo, workspaceId, kimiConfig);
    expect(await readMachineBuiltinAgentOptOuts(repo, workspaceId, machineId)).toEqual(
      new Set(['kimi'])
    );

    // 重新添加就是收回删除意图,墓碑必须跟着消失,否则列表里有它、启动却仍当它被删了。
    await upsertMachineAgentConfig(repo, workspaceId, {
      ...kimiConfig,
      id: 'agent-config-kimi-2',
    } as AgentConfigMeta);

    expect(await readMachineBuiltinAgentOptOuts(repo, workspaceId, machineId)).toEqual(new Set());
    expect(Object.keys(await readMachineAgentConfigs(repo, workspaceId, machineId))).toHaveLength(
      1
    );
  });

  it('does not record an opt-out for non-managed configs', async () => {
    const { repo } = createFakeRepo();
    await upsertMachineAgentConfig(repo, workspaceId, customConfig);
    await deleteMachineAgentConfig(repo, workspaceId, customConfig);

    // 自定义 provider 不参与启动自动注册,不需要也不该留墓碑。
    expect(await readMachineBuiltinAgentOptOuts(repo, workspaceId, machineId)).toEqual(new Set());
  });

  it('still flushes when only the opt-out row changed', async () => {
    const { repo } = createFakeRepo();
    // 行本来就不存在,删除只改了墓碑——这次变更也必须落盘,不能被「行没变」的早退吞掉。
    await deleteMachineAgentConfig(repo, workspaceId, kimiConfig);

    expect(repo.flush).toHaveBeenCalled();
    expect(await readMachineBuiltinAgentOptOuts(repo, workspaceId, machineId)).toEqual(
      new Set(['kimi'])
    );
  });
});
