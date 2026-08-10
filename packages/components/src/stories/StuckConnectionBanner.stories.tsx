import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { StuckConnectionBanner } from '@/components/stuck-connection-banner';

const labels = {
  title: 'Still connecting…',
  description:
    'This is often caused by broken local cache. Clearing it reloads the app and reconnects — you stay signed in.',
  clearCache: 'Clear cache',
  dismissAriaLabel: 'Dismiss',
};

const zhLabels = {
  title: '连接时间较长',
  description: '通常是本地缓存异常导致。清空后会重新加载并重新连接，不会退出登录。',
  clearCache: '清空缓存',
  dismissAriaLabel: '关闭',
};

const meta = {
  title: 'Workspace/StuckConnectionBanner',
  component: StuckConnectionBanner,
  args: {
    labels,
    onClearCache: fn(),
    onDismiss: fn(),
  },
  parameters: {
    // The banner positions itself fixed at the viewport top.
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="relative h-64 bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StuckConnectionBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Chinese: Story = {
  args: {
    labels: zhLabels,
  },
};

export const NarrowMobileViewport: Story = {
  decorators: [
    (Story) => (
      <div className="relative h-64 w-[360px] bg-background">
        <Story />
      </div>
    ),
  ],
};
