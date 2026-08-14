import type { Meta, StoryObj } from '@storybook/react';
import { UsageCalendarVisualization } from '@/components/settings/usage-calendar-visualization';
import { useState } from 'react';
import type {
  SettingsUsageCalendarData,
  SettingsUsageDayData,
  SettingsUsageRange,
  SettingsUsageTimelineData,
} from '@/components/settings/settings-data-cache';

const DAY_MS = 24 * 60 * 60 * 1000;
const TWO_HOUR_MS = 2 * 60 * 60 * 1000;
const START_MS = Date.UTC(2025, 6, 20);

function wave(index: number): number {
  const primary = Math.sin(index * 0.43) * 0.5 + 0.5;
  const secondary = Math.sin(index * 0.11 + 1.3) * 0.5 + 0.5;
  return primary * secondary;
}

type Shape = 'default' | 'empty' | 'outlier' | 'recent' | 'largeTotal';

const RECENT_ACTIVE_DAYS = 124;
const LARGE_TOTAL_TOKENS = 71_061_000_000;

function buildRecentTokens(totalTokens?: number): number[] {
  const weights = Array.from({ length: RECENT_ACTIVE_DAYS }, (_, index) =>
    Math.max(1, Math.round((0.2 + wave(index + 241)) * 1_000))
  );
  if (totalTokens === undefined) return weights.map((weight) => weight * 180);

  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const tokens = weights.map((weight) => Math.floor((totalTokens * weight) / totalWeight));
  tokens[tokens.length - 1]! += totalTokens - tokens.reduce((total, value) => total + value, 0);
  return tokens;
}

function buildCalendar(shape: Shape): SettingsUsageCalendarData {
  const recentTokens =
    shape === 'recent'
      ? buildRecentTokens()
      : shape === 'largeTotal'
        ? buildRecentTokens(LARGE_TOTAL_TOKENS)
        : null;
  return {
    workspaceId: 'workspace-story',
    timezone: 'UTC',
    startMs: START_MS,
    endMs: START_MS + 370 * DAY_MS,
    days: Array.from({ length: 371 }, (_, index) => {
      const dayStartMs = START_MS + index * DAY_MS;
      const recentIndex = index - (365 - RECENT_ACTIVE_DAYS);
      const recentActivity = recentIndex >= 0 ? (recentTokens?.[recentIndex] ?? 0) : 0;
      const activity =
        shape === 'empty' || index > 364
          ? 0
          : recentTokens
            ? recentActivity
            : Math.round(wave(index) * 180_000);
      // One launch-day spike that would flatten the whole ramp under a max-anchored scale.
      const spike = shape === 'outlier' && index === 300 ? 12_000_000 : 0;
      const tokens = recentTokens ? activity : index % 9 === 0 ? 0 : activity + spike;
      return {
        dayStartMs,
        date: new Date(dayStartMs).toISOString().slice(0, 10),
        tokens,
        costUSD: tokens * 0.000012,
        isFuture: index > 364,
      };
    }),
  };
}

/** Stand-in for the Convex per-day query so the expanded panel is reviewable. */
function buildDayDetail(dayStartMs: number): SettingsUsageDayData {
  const index = Math.round((dayStartMs - START_MS) / DAY_MS);
  const tokens = Math.max(1_000, Math.round(wave(index) * 180_000));
  return {
    workspaceId: 'workspace-story',
    dayStartMs,
    date: new Date(dayStartMs).toISOString().slice(0, 10),
    totals: {
      tokens,
      costUSD: tokens * 0.000012,
      inputTokens: Math.round(tokens * 0.18),
      outputTokens: Math.round(tokens * 0.12),
      cacheReadInputTokens: Math.round(tokens * 0.55),
      cacheCreationInputTokens: Math.round(tokens * 0.12),
      reasoningOutputTokens: Math.round(tokens * 0.03),
      webSearchRequests: index % 4,
    },
    byModel: [
      { modelId: 'claude-sonnet-5', tokens: Math.round(tokens * 0.52), costUSD: 0 },
      { modelId: 'claude-opus-4-8', tokens: Math.round(tokens * 0.24), costUSD: 0 },
      { modelId: 'gpt-5-codex', tokens: Math.round(tokens * 0.14), costUSD: 0 },
      { modelId: 'claude-haiku-4-5', tokens: Math.round(tokens * 0.06), costUSD: 0 },
      { modelId: 'gemini-2.5-pro', tokens: Math.round(tokens * 0.03), costUSD: 0 },
      { modelId: 'kimi-k2', tokens: Math.round(tokens * 0.01), costUSD: 0 },
    ],
    byUser: [
      { userId: 'u1', tokens: Math.round(tokens * 0.61), costUSD: 0 },
      { userId: 'u2', tokens: Math.round(tokens * 0.29), costUSD: 0 },
      { userId: 'u3', tokens: Math.round(tokens * 0.1), costUSD: 0 },
    ],
    users: {
      u1: { name: 'Ada Lovelace' },
      u2: { name: 'Grace Hopper' },
      u3: { email: 'kat@acme.dev' },
    },
  };
}

const RANGE_BUCKETS: Record<SettingsUsageRange, number> = {
  day: 12,
  week: 7,
  month: 30,
  total: 365,
};

function splitTokens(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const values = weights.map((weight) => Math.floor((total * weight) / weightTotal));
  values[0]! += total - values.reduce((sum, value) => sum + value, 0);
  return values;
}

function buildTimeline(
  calendar: SettingsUsageCalendarData,
  range: SettingsUsageRange
): SettingsUsageTimelineData {
  const activeDays = calendar.days.filter((day) => !day.isFuture);
  const latestDay = activeDays[activeDays.length - 1];
  if (!latestDay) {
    return {
      workspaceId: calendar.workspaceId,
      range,
      startMs: calendar.startMs,
      endMs: calendar.endMs,
      bucketSizeMs: range === 'day' ? TWO_HOUR_MS : DAY_MS,
      totals: { tokens: 0, costUSD: 0 },
      users: {},
      buckets: [],
    };
  }

  const bucketCount = RANGE_BUCKETS[range];
  const days = activeDays.slice(-bucketCount);
  const bucketTokens =
    range === 'day'
      ? splitTokens(latestDay.tokens, [8, 13, 20, 29, 36, 27, 17, 5, 11, 7, 10, 14])
      : days.map((day) => day.tokens);
  const timelineStartMs = range === 'day' ? latestDay.dayStartMs : (days[0]?.dayStartMs ?? calendar.startMs);
  const buckets = bucketTokens.map((tokens, index) => {
    const modelTokens = splitTokens(tokens, [46, 27, 17, 7, 3]);
    const memberTokens = splitTokens(tokens, [52, 31, 12, 5]);
    const bucketStartMs = range === 'day' ? timelineStartMs + index * TWO_HOUR_MS : days[index]!.dayStartMs;
    const costUSD = latestDay.tokens > 0 ? latestDay.costUSD * (tokens / latestDay.tokens) : 0;
    return {
      bucketStartMs,
      bucketLabel:
        range === 'day'
          ? `${String(index * 2).padStart(2, '0')}:00`
          : (days[index]?.date ?? new Date(bucketStartMs).toISOString().slice(0, 10)),
      tokens,
      costUSD: range === 'day' ? costUSD : (days[index]?.costUSD ?? 0),
      byModel: [
        'claude-sonnet-5',
        'gpt-5-codex',
        'claude-opus-4-8',
        'gemini-2.5-pro',
        'claude-haiku-4-5',
      ].map((modelId, modelIndex) => ({
        modelId,
        tokens: modelTokens[modelIndex] ?? 0,
        costUSD: 0,
      })),
      byUser: ['u1', 'u2', 'u3', 'u4'].map((userId, userIndex) => ({
        userId,
        tokens: memberTokens[userIndex] ?? 0,
        costUSD: 0,
      })),
    };
  });
  const tokens = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
  return {
    workspaceId: calendar.workspaceId,
    range,
    startMs: timelineStartMs,
    endMs: range === 'day' ? timelineStartMs + DAY_MS : calendar.endMs,
    bucketSizeMs: range === 'day' ? TWO_HOUR_MS : DAY_MS,
    totals: { tokens, costUSD: buckets.reduce((sum, bucket) => sum + bucket.costUSD, 0) },
    users: {
      u1: { name: 'Ada Lovelace' },
      u2: { name: 'Grace Hopper' },
      u3: { name: 'Katherine Johnson' },
      u4: { email: 'margaret@acme.dev' },
    },
    buckets,
  };
}

function Harness({
  shape = 'default',
  range = 'total',
}: {
  shape?: Shape;
  range?: SettingsUsageRange;
}) {
  const [selectedDayMs, setSelectedDayMs] = useState<number | null>(null);
  const calendar = buildCalendar(shape);
  return (
    <div className="mx-auto max-w-5xl p-6">
      <UsageCalendarVisualization
        calendar={calendar}
        timeline={buildTimeline(calendar, range)}
        workspaceName="Acme Robotics"
        dayDetail={selectedDayMs === null ? undefined : buildDayDetail(selectedDayMs)}
        onSelectedDayChange={setSelectedDayMs}
      />
    </div>
  );
}

const meta: Meta<typeof Harness> = {
  title: 'Settings/UsageCalendarVisualization',
  component: Harness,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Harness>;

export const Default: Story = { args: {} };
export const Empty: Story = { args: { shape: 'empty' } };
export const SingleDaySpike: Story = { args: { shape: 'outlier' } };
export const RecentActivity: Story = { args: { shape: 'recent' } };
export const LargeTotal: Story = { args: { shape: 'largeTotal' } };
export const Last24Hours: Story = { args: { range: 'day' } };
export const Last7Days: Story = { args: { range: 'week' } };
export const Last30Days: Story = { args: { range: 'month' } };
