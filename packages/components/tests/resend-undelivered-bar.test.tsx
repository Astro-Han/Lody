// @vitest-environment jsdom

import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { SessionInputBlock } from '@lody/shared';

import { ResendUndeliveredMessageBar } from '../src/components/sessions/resend-undelivered-bar';
import { initI18n } from '../src/i18n';
import { buildResendInputBlocks } from '../src/lib/undelivered-user-turn';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = {
  id: 'turn-missing',
  role: 'user' as const,
  items: [{ type: 'text', text: 'resend me' }],
  inputConfig: {
    prompt: 'resend me',
    inputBlocks: [{ type: 'text', text: 'resend me' }] as SessionInputBlock[],
  },
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('ResendUndeliveredMessageBar', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(async () => {
    await initI18n('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }
    root = undefined;
    container?.remove();
    container = undefined;
  });

  const renderBar = async (onResend: (blocks: SessionInputBlock[]) => Promise<boolean>) => {
    await act(async () => {
      root?.render(createElement(ResendUndeliveredMessageBar, { entry: ENTRY, onResend }));
    });
    const button = container?.querySelector('button');
    if (!container || !button) {
      throw new Error('Resend bar did not render its action button');
    }
    return { button, container };
  };

  const click = async (button: HTMLButtonElement) => {
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('shows the not-delivered title with a resend action', async () => {
    const { button, container: rootEl } = await renderBar(vi.fn(async () => true));
    expect(rootEl.textContent).toContain('Message not delivered');
    expect(button.textContent).toContain('Resend message');
    expect(button.disabled).toBe(false);
  });

  it('resends the exact entry content once and stays disabled while in flight', async () => {
    const send = deferred<boolean>();
    const onResend = vi.fn(() => send.promise);
    const { button } = await renderBar(onResend);

    await click(button);
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend).toHaveBeenCalledWith(buildResendInputBlocks(ENTRY));
    expect(button.disabled).toBe(true);

    // The in-flight guard covers the gap until the ordinary send clears the
    // marker (which unmounts the bar): further clicks do not duplicate.
    await click(button);
    expect(onResend).toHaveBeenCalledTimes(1);

    send.resolve(true);
    await act(async () => {
      await send.promise;
    });
    expect(button.disabled).toBe(true);
  });

  it('re-enables the action when the send path rejects the resend', async () => {
    const onResend = vi.fn(async () => false);
    const { button } = await renderBar(onResend);

    await click(button);
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
  });

  it('re-enables the action when the send path throws', async () => {
    const onResend = vi.fn(async () => {
      throw new Error('dispatch failed');
    });
    const { button } = await renderBar(onResend);

    await click(button);
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
  });
});
