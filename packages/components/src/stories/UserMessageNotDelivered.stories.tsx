import type { Meta, StoryObj } from '@storybook/react';
import { Provider as JotaiProvider, createStore } from 'jotai';
import {
  getSessionRoomId,
  type MachineId,
  type SessionHistoryParsed,
  type SessionId,
  type SessionMeta,
} from '@lody/shared';

import { sessionMetaCacheAtom } from '@/atoms/doc-meta';
import { MessageRowView } from '@/components/ai-gui/view';
import { ResendUndeliveredMessageBar } from '@/components/sessions/resend-undelivered-bar';
import { ConversationColumn } from '@/components/shared/conversation-column';

/**
 * The missing-history negative acknowledgement (`SessionMeta.lastMissingHistoryUserMsgId`)
 * permanently excludes one exact user turn from every dispatch path. When that
 * entry is visible but still non-terminal, the row derives a terminal "Not
 * delivered" label (no row-level action), and recovery lives at the bottom of
 * the conversation: a resend bar that re-sends the SAME content as a brand-new
 * message through the ordinary send path. The old turn never revives.
 */
const meta = {
  title: 'Sessions/UserMessageNotDelivered',
  component: MessageRowView,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof MessageRowView>;

export default meta;
type Story = StoryObj<typeof meta>;

const sessionId = 'not-delivered-session' as SessionId;
const missingTurnId = 'user-turn-missing-history';
const messageText = 'Review the dispatch watcher recovery path and summarize the failure modes.';

const markerMeta = {
  id: sessionId,
  machineId: 'story-machine' as MachineId,
  userId: 'story-user',
  createdAt: '2026-08-19T09:00:00.000Z',
  cliType: 'builtin',
  agentType: 'codex',
  status: { type: 'idle' as const },
  latestUserMsgId: missingTurnId,
  lastMissingHistoryUserMsgId: missingTurnId,
} satisfies SessionMeta;

const pendingUserMessage = (id: string, text: string): SessionHistoryParsed =>
  ({
    id,
    role: 'user',
    userId: 'story-user',
    timestamp: '2026-08-19T09:00:00.000Z',
    read: false,
    status: 'pending',
    items: [{ type: 'text', text }],
    inputConfig: {
      prompt: text,
      inputBlocks: [{ type: 'text', text }],
      cliType: 'builtin',
      agentType: 'codex',
    },
  }) as unknown as SessionHistoryParsed;

function renderRow(
  args: React.ComponentProps<typeof MessageRowView>,
  sessionMeta: SessionMeta | undefined
) {
  const store = createStore();
  if (sessionMeta) {
    store.set(sessionMetaCacheAtom, { [getSessionRoomId(sessionId)]: sessionMeta });
  }
  return (
    <JotaiProvider store={store}>
      <div className="w-[720px] max-w-[100vw] bg-background">
        <ConversationColumn>
          <MessageRowView {...args} />
        </ConversationColumn>
      </div>
    </JotaiProvider>
  );
}

/** Marker names this exact entry: destructive "Not delivered" label replaces
 * the endless sending indicator. The row itself carries no action. */
export const NotDelivered: Story = {
  args: {
    message: pendingUserMessage(missingTurnId, messageText),
    sessionId,
  },
  render: (args) => renderRow(args, markerMeta),
};

/** Control: no marker — the same pending entry keeps the ordinary sending
 * state, so the derivation cannot fire for unrelated messages. */
export const OrdinaryPending: Story = {
  args: {
    message: pendingUserMessage('user-turn-ordinary-pending', messageText),
    sessionId,
  },
  render: (args) => renderRow(args, undefined),
};

/** The recovery entry at the bottom of the conversation (above the composer):
 * resends the undelivered turn's exact content as a NEW message through the
 * ordinary send path. */
export const ResendBar: Story = {
  args: {
    message: pendingUserMessage(missingTurnId, messageText),
    sessionId,
  },
  render: () => (
    <div className="w-[720px] max-w-[100vw] bg-background p-3">
      <ConversationColumn>
        <ResendUndeliveredMessageBar
          entry={pendingUserMessage(missingTurnId, messageText)}
          onResend={async () => true}
        />
      </ConversationColumn>
    </div>
  ),
};

/** Click the action to review the resending state: the button disables and
 * spins while the never-settling resend is in flight. */
export const ResendBarClickToResend: Story = {
  args: {
    message: pendingUserMessage(missingTurnId, messageText),
    sessionId,
  },
  render: () => (
    <div className="w-[720px] max-w-[100vw] bg-background p-3">
      <ConversationColumn>
        <ResendUndeliveredMessageBar
          entry={pendingUserMessage(missingTurnId, messageText)}
          onResend={() => new Promise<boolean>(() => {})}
        />
      </ConversationColumn>
    </div>
  ),
};
