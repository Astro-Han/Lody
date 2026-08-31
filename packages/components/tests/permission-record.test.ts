import { describe, expect, it } from 'vitest';
import type { MessageContent } from '@lody/shared';

import {
  hasUnansweredPlanApproval,
  resolvePermissionRecord,
} from '../src/components/ai-gui/permission-record';

type PermissionRequest = NonNullable<
  Extract<MessageContent, { type: 'tool_call' }>['permissionRequest']
>;

const request = (overrides: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({
    requestId: 'req-1',
    options: [
      { optionId: 'allow', name: 'Yes, implement the plan', kind: 'allow_once' },
      { optionId: 'deny', name: 'No, and tell Codex what to change', kind: 'reject_once' },
    ],
    ...overrides,
  }) as PermissionRequest;

describe('resolvePermissionRecord', () => {
  it('keeps an unanswered request actionable', () => {
    expect(resolvePermissionRecord(request())).toEqual({ kind: 'pending' });
  });

  it('collapses an answered request to the option that was chosen', () => {
    expect(
      resolvePermissionRecord(request({ outcome: { outcome: 'selected', optionId: 'allow' } }))
    ).toEqual({ kind: 'settled', allowed: true, optionName: 'Yes, implement the plan' });

    expect(
      resolvePermissionRecord(request({ outcome: { outcome: 'selected', optionId: 'deny' } }))
    ).toEqual({
      kind: 'settled',
      allowed: false,
      optionName: 'No, and tell Codex what to change',
    });
  });

  it('shows nothing for a request that was withdrawn before anyone answered', () => {
    expect(resolvePermissionRecord(request({ outcome: { outcome: 'cancelled' } }))).toEqual({
      kind: 'withdrawn',
    });
  });

  it('falls back to generic approval copy when the chosen option is gone', () => {
    // Stale history: the recorded id no longer matches an offered option.
    expect(
      resolvePermissionRecord(request({ outcome: { outcome: 'selected', optionId: 'vanished' } }))
    ).toEqual({ kind: 'settled', allowed: true, optionName: null });

    // A blank name is not a label either.
    expect(
      resolvePermissionRecord(
        request({
          options: [{ optionId: 'allow', name: '   ', kind: 'allow_once' }],
          outcome: { outcome: 'selected', optionId: 'allow' },
        })
      )
    ).toEqual({ kind: 'settled', allowed: true, optionName: null });
  });
});

describe('hasUnansweredPlanApproval', () => {
  const planExit = (permissionRequest: unknown): MessageContent =>
    ({
      type: 'tool_call',
      toolCallId: 'plan-exit',
      kind: 'switch_mode',
      status: 'pending',
      permissionRequest,
    }) as MessageContent;

  it('holds the plan open while the approval is unanswered', () => {
    expect(hasUnansweredPlanApproval([planExit(request())])).toBe(true);
  });

  it('lets the plan clamp once the reader has answered', () => {
    expect(
      hasUnansweredPlanApproval([
        planExit(request({ outcome: { outcome: 'selected', optionId: 'allow' } })),
      ])
    ).toBe(false);
  });

  it('treats a withdrawn request as answered, not pending', () => {
    // A cancelled request has nothing left to decide, so it must not pin the
    // plan open for the rest of the session.
    expect(
      hasUnansweredPlanApproval([planExit(request({ outcome: { outcome: 'cancelled' } }))])
    ).toBe(false);
  });

  it('ignores tool calls that are not a plan exit', () => {
    const edit = {
      type: 'tool_call',
      toolCallId: 'edit-1',
      kind: 'edit',
      status: 'pending',
      permissionRequest: request(),
    } as MessageContent;
    expect(hasUnansweredPlanApproval([edit])).toBe(false);
    expect(hasUnansweredPlanApproval([{ type: 'text', text: 'hi' } as MessageContent])).toBe(false);
  });
});
