import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireLocalCliHostLease,
  getLocalCliHostEndpoint,
  requestLocalCliHostShutdown,
  type LocalCliHostEndpoint,
  type LocalCliHostLease,
} from '../src/node/local-cli-host-lease';

const leases: LocalCliHostLease[] = [];
const require = createRequire(import.meta.url);

async function createEndpoint(): Promise<LocalCliHostEndpoint> {
  if (process.platform === 'win32') {
    return { kind: 'pipe', path: `\\\\.\\pipe\\lody-host-test-${randomUUID()}` };
  }
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to allocate test port');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return { kind: 'tcp', host: '127.0.0.1', port: address.port };
}

afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.close();
});

describe('local CLI host lease', () => {
  it('keeps the CommonJS node export in parity with the ESM module', () => {
    const commonJs =
      require('../src/node/local-cli-host-lease.cjs') as typeof import('../src/node/local-cli-host-lease');

    // Parity is the point: both builds must land on the same endpoint for the
    // active installation profile, so compare them instead of a fixed port.
    expect(commonJs.getLocalCliHostEndpoint()).toEqual(getLocalCliHostEndpoint());
    expect(commonJs.getLocalCliHostEndpoint()).toMatchObject(
      process.platform === 'win32' ? { kind: 'pipe' } : { kind: 'tcp' }
    );
    expect(commonJs.acquireLocalCliHostLease).toBeTypeOf('function');
    expect(commonJs.requestLocalCliHostShutdown).toBeTypeOf('function');
  });

  it('uses the kernel endpoint bind as the single-owner boundary', async () => {
    const endpoint = await createEndpoint();
    const contenders = await Promise.all([
      acquireLocalCliHostLease({ endpoint, instanceId: 'a', mode: 'electron' }),
      acquireLocalCliHostLease({ endpoint, instanceId: 'b', mode: 'daemon' }),
    ]);
    const acquired = contenders.filter((result) => result.status === 'acquired');
    const occupied = contenders.filter((result) => result.status === 'occupied');

    expect(acquired).toHaveLength(1);
    expect(occupied).toHaveLength(1);
    if (acquired[0]?.status === 'acquired') leases.push(acquired[0].lease);
  });

  it('releases ownership only after the listening endpoint is closed', async () => {
    const endpoint = await createEndpoint();
    const first = await acquireLocalCliHostLease({
      endpoint,
      instanceId: 'first',
      mode: 'electron',
    });
    expect(first.status).toBe('acquired');
    if (first.status !== 'acquired') return;

    await first.lease.close();
    const replacement = await acquireLocalCliHostLease({
      endpoint,
      instanceId: 'replacement',
      mode: 'daemon',
    });
    expect(replacement.status).toBe('acquired');
    if (replacement.status === 'acquired') leases.push(replacement.lease);
  });

  it('authenticates daemon shutdown control without exposing the token', async () => {
    const endpoint = await createEndpoint();
    const onRequest = vi.fn();
    const result = await acquireLocalCliHostLease({
      endpoint,
      instanceId: 'daemon-a',
      mode: 'daemon',
      shutdownControl: { token: 'secret-token', onRequest },
    });
    expect(result.status).toBe('acquired');
    if (result.status !== 'acquired') return;
    leases.push(result.lease);

    await expect(
      requestLocalCliHostShutdown({ endpoint, instanceId: 'daemon-a', token: 'wrong-token' })
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
    expect(onRequest).not.toHaveBeenCalled();

    const accepted = await requestLocalCliHostShutdown({
      endpoint,
      instanceId: 'daemon-a',
      token: 'secret-token',
    });
    expect(accepted).toMatchObject({ ok: true, record: { instanceId: 'daemon-a' } });
    await Promise.resolve();
    expect(onRequest).toHaveBeenCalledOnce();
  });
});
