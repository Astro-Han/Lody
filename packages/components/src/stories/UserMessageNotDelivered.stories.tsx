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
import { ConversationColumn } from '@/components/shared/conversation-column';

/**
 * The missing-history negative acknowledgement (`SessionMeta.lastMissingHistoryUserMsgId`)
 * keeps one exact user turn out of every dispatch path. When that entry is
 * visible but still non-terminal, `UserMessageRowView` derives a terminal
 * "Not delivered" state with an explicit "Deliver now" action — display-only,
 * never an automatic re-dispatch. The control story shows the same pending
 * entry without the marker (ordinary sending state).
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

/** Marker names this exact entry: destructive "Not delivered" chip plus the
 * deliver-now action replaces the endless sending indicator. */
export const NotDelivered: Story = {
  args: {
    message: pendingUserMessage(
      missingTurnId,
      'Review the dispatch watcher recovery path and summarize the failure modes.'
    ),
    sessionId,
  },
  render: (args) => renderRow(args, markerMeta),
};

/** Control: no marker — the same pending entry keeps the ordinary sending
 * state, so the derivation cannot fire for unrelated messages. */
export const OrdinaryPending: Story = {
  args: {
    message: pendingUserMessage(
      'user-turn-ordinary-pending',
      'Review the dispatch watcher recovery path and summarize the failure modes.'
    ),
    sessionId,
  },
  render: (args) => renderRow(args, undefined),
};
