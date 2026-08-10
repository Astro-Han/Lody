import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { StuckConnectionBanner } from '@/components/stuck-connection-banner';

const labels = {
  title: 'Still connecting…',
  description:
    'The workspace has been unable to connect for a while. This can be caused by broken local cache — clearing it and reloading usually fixes it. Synced data re-downloads and you stay signed in.',
  clearAndReload: 'Clear cache & reload',
  report: 'Report a bug',
  dismissAriaLabel: 'Dismiss',
};

const zhLabels = {
  title: '连接时间较长',
  description:
    '工作区较长时间未能连接，可能是本地缓存异常导致。清空缓存并重新加载通常可以修复。已同步数据会重新下载，且不会退出登录。',
  clearAndReload: '清空缓存并重新加载',
  report: '报告 Bug',
  dismissAriaLabel: '关闭',
};

const meta = {
  title: 'Workspace/StuckConnectionBanner',
  component: StuckConnectionBanner,
  args: {
    labels,
    onClearCache: fn(),
    onReport: fn(),
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
