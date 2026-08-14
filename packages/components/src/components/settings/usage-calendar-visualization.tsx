import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import NumberFlow from '@number-flow/react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Box,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  MousePointerClick,
  Share2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { toIntlLocale } from '@/lib/intl-locale';
import { cn } from '@/lib/utils';
import { ModelBrandIcon } from '@/components/icons/model-brand-icon';
import { stripRecommended } from '@/components/shared/acp-selector-options';
import type {
  SettingsUsageCalendarData,
  SettingsUsageDayData,
  SettingsUsageTimelineBucket,
  SettingsUsageTimelineData,
} from './settings-data-cache';
import {
  createUsageCalendarModel,
  createUsageHeatScale,
  createUsageSkylineLodyLogoTriangles,
  createUsageSkylineAscii,
  createUsageSkylineBinaryStl,
  getUsageSkylineViewport,
  getUsageColumnHeight,
  getUsageCalendarLevel,
  USAGE_CALENDAR_CELLS,
  USAGE_CALENDAR_COLUMNS,
  USAGE_CALENDAR_ROWS,
  USAGE_SKYLINE_STL_BASE_HEIGHT,
  USAGE_SKYLINE_STL_BACK_MARGIN,
  USAGE_SKYLINE_STL_BASE_DEPTH,
  USAGE_SKYLINE_STL_BASE_WIDTH,
  USAGE_SKYLINE_STL_CELL_SIZE,
  USAGE_SKYLINE_STL_COLUMN_HEIGHT_MULTIPLIER,
  type UsageCalendarCell,
  type UsageCalendarMetric,
  type UsageCalendarModel,
} from './usage-calendar-model';
import { createUsageShareCard, type UsageShareCardStyle } from './usage-share-card';
import { scheduleUsageShareCardFontPreload } from './usage-share-card-fonts';

type UsageShareCardPreview = {
  file: File;
  style: UsageShareCardStyle;
  url: string;
};

// Blue skyline columns, matching the heatmap's `--chart-1` ramp. Three.js cannot
// read CSS variables, so the levels are literal; the luminance steps mirror the
// GitHub-style progression these replaced.
const LEVEL_COLORS = ['#30363d', '#12305c', '#1e5aa8', '#3b82f6', '#7cb6ff'];
// Export generation remains available in code while the settings UI focuses on the active views.
const SHOW_SKYLINE_EXPORTS = false;
// Share card is hidden while its ticket art is being reworked. The renderer, the
// preview popover, and the Storybook gallery all stay wired up behind this flag.
const SHOW_SHARE_CARD = false;

/**
 * The heatmap paints one theme token at varying alpha instead of a fixed five-step
 * palette, so the ramp reads the same way in light and dark mode and stays smooth.
 * `--chart-1` is the blue anchor of the chart palette and is defined only in the
 * light/dark roots, so it stays blue under themes that repaint `--primary`.
 */
const heatColor = (intensity: number) => `hsl(var(--chart-1) / ${intensity.toFixed(3)})`;
const EMPTY_DAY_COLOR = 'hsl(var(--muted-foreground) / 0.14)';
const FUTURE_DAY_COLOR = 'hsl(var(--muted-foreground) / 0.05)';

function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const fractionDigits = abs >= 100_000_000 ? 0 : 1;
    return `${new Intl.NumberFormat(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value / 1_000_000)}M`;
  }
  if (abs >= 1_000) {
    const fractionDigits = abs >= 100_000 ? 0 : 1;
    return `${new Intl.NumberFormat(undefined, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value / 1_000)}K`;
  }
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value: number): string {
  const abs = Math.abs(value);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    // Daily costs are often fractions of a cent; two digits would render them all as $0.00.
    maximumFractionDigits: abs > 0 && abs < 1 ? 3 : 2,
  }).format(value);
}

function formatMetric(value: number, metric: UsageCalendarMetric): string {
  return metric === 'tokens' ? formatTokens(value) : formatCost(value);
}

function fileStem(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'lody-usage';
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function SegmentedControl<Value extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: Value;
  onChange: (value: Value) => void;
  options: Array<{ value: Value; label: ReactNode; title?: string }>;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex items-center rounded-md bg-muted/60 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          title={option.title}
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-background text-foreground shadow-xs ring-1 ring-border/70'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Columns that open a new month, thinned out so short month names cannot collide. */
const MIN_COLUMNS_BETWEEN_MONTH_LABELS = 3;
/** Per-week delay of the reveal sweep; 53 weeks land in roughly 0.6s. */
const CELL_REVEAL_STAGGER_MS = 11;
/** Floor on a day's rendered size. Columns grow past it, never below it. */
const CELL_MIN_SIZE_PX = 11;
const CELL_GAP_PX = 3;
const HEATMAP_COLUMN_TEMPLATE = `repeat(${USAGE_CALENDAR_COLUMNS}, minmax(${CELL_MIN_SIZE_PX}px, 1fr))`;
const HEATMAP_MIN_TRACK_WIDTH =
  USAGE_CALENDAR_COLUMNS * CELL_MIN_SIZE_PX + (USAGE_CALENDAR_COLUMNS - 1) * CELL_GAP_PX;

function useCalendarFormats() {
  const { i18n } = useTranslation();
  const locale = toIntlLocale(i18n.resolvedLanguage ?? i18n.language);
  return useMemo(
    () => ({
      month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
      /** Compact span endpoints such as "Jul 20"; the year lives in the range label. */
      dayShort: new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      dayOfMonth: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }),
      day: new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }),
    [locale]
  );
}

function useMonthLabels(model: UsageCalendarModel, format: Intl.DateTimeFormat) {
  return useMemo(() => {
    const candidates: Array<{ column: number; label: string }> = [];
    let previousMonth = -1;
    for (const [column, week] of model.weeks.entries()) {
      const firstDay = week[0];
      if (!firstDay) continue;
      const month = new Date(firstDay.dayStartMs).getUTCMonth();
      if (month === previousMonth) continue;
      previousMonth = month;
      candidates.push({ column, label: format.format(new Date(firstDay.dayStartMs)) });
    }
    // Thin out from the right so a crowded partial month at the very start is what
    // gets dropped, never the full month that follows it.
    const labels: Array<{ column: number; label: string }> = [];
    let nextLabelColumn = USAGE_CALENDAR_COLUMNS;
    for (const candidate of candidates.reverse()) {
      if (nextLabelColumn - candidate.column < MIN_COLUMNS_BETWEEN_MONTH_LABELS) continue;
      nextLabelColumn = candidate.column;
      labels.unshift(candidate);
    }
    return labels;
  }, [format, model.weeks]);
}

function HeatLegend() {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      <span>{t('workspace.usage.skyline.less')}</span>
      <span
        aria-hidden="true"
        className="h-2 w-20 rounded-full"
        style={{
          backgroundImage: `linear-gradient(to right, ${EMPTY_DAY_COLOR}, ${heatColor(0.2)}, ${heatColor(0.55)}, ${heatColor(1)})`,
        }}
      />
      <span>{t('workspace.usage.skyline.more')}</span>
    </div>
  );
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The range panel keeps its blue deliberately quiet: even the densest hour stops
 * short of the full-saturation chart blue, so a busy week reads as texture rather
 * than a solid slab. The year heatmap above still uses the full ramp — it has far
 * more empty space to carry it.
 */
const RANGE_HEAT_FLOOR = 0.13;
const RANGE_HEAT_CEILING = 0.8;
const rangeHeatColor = (intensity: number) =>
  heatColor(RANGE_HEAT_FLOOR + (RANGE_HEAT_CEILING - RANGE_HEAT_FLOOR) * intensity);
const RANGE_EMPTY_COLOR = 'hsl(var(--muted-foreground) / 0.1)';

/**
 * Percentile-anchored so one spike hour cannot flatten a whole week; the gamma
 * lifts the quiet-but-not-empty buckets that a linear ramp loses.
 */
function createRangeIntensity(values: number[]): (value: number) => number {
  const active = values.filter((value) => value > 0).sort((a, b) => a - b);
  const reference = active[Math.min(active.length - 1, Math.ceil((active.length - 1) * 0.9))] ?? 0;
  return (value: number) =>
    value > 0 && reference > 0 ? Math.min(1, value / reference) ** 0.62 : 0;
}

/** Per-column delay of the reveal sweep; the widest range (24 columns) lands in ~0.9s. */
const RANGE_SWEEP_STEP_S = 0.026;
const RANGE_SWEEP_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * One column of the matrix. The sweep — a blurred slide that resolves left to
 * right — is what makes 24h, 7d, and 30d read as the same object changing shape
 * rather than three separate charts. Motion lives on the column, not on each of
 * the 168 cells, so the blur stays cheap.
 */
function HeatColumn({
  index,
  reduced,
  className,
  children,
}: {
  index: number;
  reduced: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      // Presentational: the wrapper only carries the sweep, so the grid still
      // sees its cells directly.
      role="presentation"
      className={cn('flex min-w-0 flex-col', className)}
      initial={reduced ? false : { opacity: 0, y: 5, filter: 'blur(5px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: 0.34, delay: index * RANGE_SWEEP_STEP_S, ease: RANGE_SWEEP_EASE }
      }
    >
      {children}
    </motion.div>
  );
}

function HeatCell({
  intensity,
  label,
  className,
  style,
}: {
  intensity: number;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      role="gridcell"
      title={label}
      aria-label={label}
      className={cn('block transition-colors duration-200', className)}
      style={{
        backgroundColor: intensity > 0 ? rangeHeatColor(intensity) : RANGE_EMPTY_COLOR,
        ...style,
      }}
    />
  );
}

/** Hour rows are labelled every three hours; a label on all 24 becomes noise. */
const HOUR_LABEL_STEP = 3;

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function UsageDayMatrix({
  buckets,
  metric,
  intensityOf,
  reduced,
}: {
  buckets: SettingsUsageTimelineBucket[];
  metric: UsageCalendarMetric;
  intensityOf: (value: number) => number;
  reduced: boolean;
}) {
  const maxValue = buckets.reduce(
    (peak, bucket) => Math.max(peak, metric === 'tokens' ? bucket.tokens : bucket.costUSD),
    0
  );
  return (
    <div className="flex items-end gap-[3px]">
      {buckets.map((bucket, index) => {
        const value = metric === 'tokens' ? bucket.tokens : bucket.costUSD;
        const intensity = intensityOf(value);
        const label = `${bucket.bucketLabel} · ${formatMetric(value, metric)}`;
        return (
          <HeatColumn key={bucket.bucketStartMs} index={index} reduced={reduced} className="flex-1">
            {/* Height carries magnitude, colour carries share of the peak: 24 cells
                is few enough that a bar column beats a flat row of squares. */}
            <span
              className="relative flex h-16 w-full items-end overflow-hidden rounded-[3px]"
              style={{ backgroundColor: RANGE_EMPTY_COLOR }}
            >
              <HeatCell
                intensity={intensity}
                label={label}
                className="w-full rounded-[3px]"
                style={{
                  height: `${value > 0 && maxValue > 0 ? Math.max(6, (value / maxValue) * 100) : 0}%`,
                }}
              />
            </span>
            <span className="mt-1 h-3 text-center text-[9px] leading-3 tabular-nums text-muted-foreground/70">
              {index % HOUR_LABEL_STEP === 0 ? bucket.bucketLabel.replace(':00', '') : ''}
            </span>
          </HeatColumn>
        );
      })}
    </div>
  );
}

function UsageWeekMatrix({
  timeline,
  metric,
  intensityOf,
  reduced,
  weekdayFormat,
  dayOfMonthFormat,
}: {
  timeline: SettingsUsageTimelineData;
  metric: UsageCalendarMetric;
  intensityOf: (value: number) => number;
  reduced: boolean;
  weekdayFormat: Intl.DateTimeFormat;
  dayOfMonthFormat: Intl.DateTimeFormat;
}) {
  const startDayMs = Math.floor(timeline.startMs / DAY_MS) * DAY_MS;
  const dayStarts = Array.from({ length: 7 }, (_, index) => startDayMs + index * DAY_MS);
  const valuesByBucket = useMemo(() => {
    const values = new Map<number, number>();
    for (const bucket of timeline.buckets) {
      values.set(bucket.bucketStartMs, metric === 'tokens' ? bucket.tokens : bucket.costUSD);
    }
    return values;
  }, [metric, timeline.buckets]);

  return (
    <div className="flex gap-1.5">
      {/* Hour gutter, outside the columns so the sweep cannot drag the labels. */}
      <div aria-hidden="true" className="flex w-7 shrink-0 flex-col">
        <span className="h-4" />
        <div className="flex flex-1 flex-col gap-[2px]">
          {Array.from({ length: 24 }, (_, hour) => (
            <span
              key={hour}
              className="flex h-2 items-center justify-end text-[8px] leading-none tabular-nums text-muted-foreground/70"
            >
              {hour % HOUR_LABEL_STEP === 0 ? hourLabel(hour).slice(0, 2) : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="grid min-w-0 flex-1 grid-cols-7 gap-[3px]">
        {dayStarts.map((dayStartMs, dayIndex) => (
          <HeatColumn key={dayStartMs} index={dayIndex} reduced={reduced}>
            <span className="flex h-4 items-center justify-center gap-1 text-[10px] font-medium leading-none text-muted-foreground">
              <span className="truncate">{weekdayFormat.format(new Date(dayStartMs))}</span>
              <span className="tabular-nums text-muted-foreground/55">
                {dayOfMonthFormat.format(new Date(dayStartMs))}
              </span>
            </span>
            <div className="flex flex-col gap-[2px]">
              {Array.from({ length: 24 }, (_, hour) => {
                const value = valuesByBucket.get(dayStartMs + hour * HOUR_MS) ?? 0;
                return (
                  <HeatCell
                    key={hour}
                    intensity={intensityOf(value)}
                    label={`${weekdayFormat.format(new Date(dayStartMs))} ${hourLabel(hour)} · ${formatMetric(value, metric)}`}
                    className="h-2 w-full rounded-[2px]"
                  />
                );
              })}
            </div>
          </HeatColumn>
        ))}
      </div>
    </div>
  );
}

function UsageMonthMatrix({
  buckets,
  metric,
  intensityOf,
  reduced,
  weekdayFormat,
  dayOfMonthFormat,
}: {
  buckets: SettingsUsageTimelineBucket[];
  metric: UsageCalendarMetric;
  intensityOf: (value: number) => number;
  reduced: boolean;
  weekdayFormat: Intl.DateTimeFormat;
  dayOfMonthFormat: Intl.DateTimeFormat;
}) {
  // Calendar columns, so a weekday rhythm in the month is visible at a glance.
  // Leading blanks keep every row a real week; without them the first partial
  // week would shift each column against its neighbours.
  const { columns, rows } = useMemo(() => {
    const leading = buckets[0] ? new Date(buckets[0].bucketStartMs).getUTCDay() : 0;
    const weeks = Math.ceil((leading + buckets.length) / 7);
    const byWeekday = Array.from(
      { length: 7 },
      () => Array.from({ length: weeks }, () => undefined) as Array<SettingsUsageTimelineBucket | undefined>
    );
    for (const [index, bucket] of buckets.entries()) {
      const slot = leading + index;
      byWeekday[slot % 7]![Math.floor(slot / 7)] = bucket;
    }
    return { columns: byWeekday, rows: weeks };
  }, [buckets]);

  return (
    <div className="grid grid-cols-7 gap-[3px]">
      {columns.map((column, weekday) => {
        const sample = column.find(Boolean);
        return (
          <HeatColumn key={weekday} index={weekday} reduced={reduced}>
            <span className="flex h-4 items-center justify-center text-[10px] font-medium leading-none text-muted-foreground">
              {sample ? weekdayFormat.format(new Date(sample.bucketStartMs)) : ''}
            </span>
            <div className="flex flex-col gap-[3px]">
              {Array.from({ length: rows }, (_, row) => {
                const bucket = column[row];
                if (!bucket) return <span key={row} className="h-7" />;
                const value = metric === 'tokens' ? bucket.tokens : bucket.costUSD;
                const intensity = intensityOf(value);
                return (
                  <span key={bucket.bucketStartMs} className="relative block">
                    <HeatCell
                      intensity={intensity}
                      label={`${bucket.bucketLabel} · ${formatMetric(value, metric)}`}
                      className="h-7 w-full rounded-[4px]"
                    />
                    {/* The date rides inside the cell: 30 separate captions below the
                        grid would double its height for the same information. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-medium leading-none tabular-nums',
                        intensity > 0.55 ? 'text-background/85' : 'text-muted-foreground/70'
                      )}
                    >
                      {dayOfMonthFormat.format(new Date(bucket.bucketStartMs))}
                    </span>
                  </span>
                );
              })}
            </div>
          </HeatColumn>
        );
      })}
    </div>
  );
}

const COMPOSITION_SEGMENT_LIMIT = 5;
const MODEL_SERIES_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'] as const;
const MEMBER_SERIES_COLORS = ['#7c3aed', '#9333ea', '#a855f7', '#c084fc', '#e9d5ff'] as const;

type UsageCompositionSegment = {
  id: string;
  label: string;
  tokens: number;
  share: number;
};

function createUsageCompositionSegments(
  rows: Array<{ id: string; label: string; tokens: number }>,
  otherLabel: string
): UsageCompositionSegment[] {
  const totals = new Map<string, { label: string; tokens: number }>();
  for (const row of rows) {
    if (!Number.isFinite(row.tokens) || row.tokens <= 0) continue;
    const previous = totals.get(row.id);
    totals.set(row.id, {
      label: row.label,
      tokens: (previous?.tokens ?? 0) + row.tokens,
    });
  }

  const sorted = [...totals.entries()]
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
  const visible = sorted.slice(0, COMPOSITION_SEGMENT_LIMIT - 1);
  const hidden = sorted.slice(COMPOSITION_SEGMENT_LIMIT - 1);
  if (hidden.length > 0) {
    visible.push({
      id: '__other__',
      label: otherLabel,
      tokens: hidden.reduce((total, row) => total + row.tokens, 0),
    });
  }

  const total = visible.reduce((sum, row) => sum + row.tokens, 0);
  return visible.map((row) => ({ ...row, share: total > 0 ? row.tokens / total : 0 }));
}

/**
 * The rings this replaced spent a 13rem square on two numbers. A pair of 6px
 * rules carries the same shares inside the panel's own text rhythm.
 */
function UsageCompositionBar({
  label,
  segments,
  colors,
  reduced,
}: {
  label: string;
  segments: UsageCompositionSegment[];
  colors: readonly string[];
  reduced: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
        {label}
      </p>
      <div className="mt-1.5 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted-foreground/10">
        {segments.map((segment, index) => (
          <motion.span
            key={segment.id}
            title={`${segment.label} · ${Math.round(segment.share * 100)}%`}
            className="h-full"
            style={{ backgroundColor: colors[index % colors.length] }}
            initial={reduced ? false : { width: 0 }}
            animate={{ width: `${segment.share * 100}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: RANGE_SWEEP_EASE }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {segments.map((segment, index) => (
          <li key={segment.id} className="flex min-w-0 items-center gap-1 text-[10px]">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: colors[index % colors.length] }}
            />
            <span className="max-w-[8rem] truncate text-muted-foreground">{segment.label}</span>
            <span className="tabular-nums text-foreground/70">
              {Math.round(segment.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The single range view. 24h, 7d, and 30d share one frame — total, span, peak,
 * legend, and composition rules stay put while only the matrix inside changes
 * shape, so switching ranges reads as one object deforming.
 */
function UsageRangePanel({
  timeline,
  metric,
}: {
  timeline: SettingsUsageTimelineData;
  metric: UsageCalendarMetric;
}) {
  const { t } = useTranslation();
  const formats = useCalendarFormats();
  const reduced = useReducedMotion() ?? false;

  const values = useMemo(
    () => timeline.buckets.map((bucket) => (metric === 'tokens' ? bucket.tokens : bucket.costUSD)),
    [metric, timeline.buckets]
  );
  const intensityOf = useMemo(() => createRangeIntensity(values), [values]);
  const peakIndex = values.reduce(
    (peak, value, index) => (value > (values[peak] ?? 0) ? index : peak),
    0
  );
  const peakBucket = timeline.buckets[peakIndex];
  const activeCount = values.filter((value) => value > 0).length;

  const modelSegments = useMemo(
    () =>
      createUsageCompositionSegments(
        timeline.buckets.flatMap((bucket) =>
          bucket.byModel.map((row) => ({
            id: row.modelId,
            label: stripRecommended(row.modelId),
            tokens: row.tokens,
          }))
        ),
        t('workspace.usage.skyline.other')
      ),
    [t, timeline.buckets]
  );
  const memberSegments = useMemo(
    () =>
      createUsageCompositionSegments(
        timeline.buckets.flatMap((bucket) =>
          bucket.byUser.map((row) => ({
            id: row.userId,
            label:
              timeline.users?.[row.userId]?.name ||
              timeline.users?.[row.userId]?.email ||
              row.userId,
            tokens: row.tokens,
          }))
        ),
        t('workspace.usage.skyline.other')
      ),
    [t, timeline.buckets, timeline.users]
  );

  const spanLabel =
    timeline.range === 'day'
      ? formats.day.format(new Date(timeline.startMs))
      : `${formats.dayShort.format(new Date(timeline.startMs))} – ${formats.dayShort.format(
          new Date(Math.max(timeline.startMs, timeline.endMs - DAY_MS))
        )}`;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold leading-none tabular-nums tracking-tight text-foreground">
              {metric === 'tokens' ? (
                <NumberFlow
                  value={timeline.totals.tokens}
                  format={{ notation: 'compact', maximumFractionDigits: 1 }}
                />
              ) : (
                formatCost(timeline.totals.costUSD)
              )}
            </span>
            {metric === 'tokens' ? (
              <span className="text-xs text-muted-foreground">{t('workspace.usage.tokens')}</span>
            ) : null}
          </p>
          <p className="mt-1 truncate text-[11px] tabular-nums text-muted-foreground">
            {spanLabel}
            <span className="text-muted-foreground/60">
              {` · ${t('workspace.usage.skyline.activeIntervals')} ${activeCount}/${values.length}`}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {peakBucket && (values[peakIndex] ?? 0) > 0 ? (
            <p className="text-[11px] tabular-nums text-muted-foreground">
              <span className="text-muted-foreground/60">{`${t('workspace.usage.skyline.peakInterval')} `}</span>
              <span className="font-medium text-foreground">
                {formatMetric(values[peakIndex] ?? 0, metric)}
              </span>
              <span className="text-muted-foreground/60">{` · ${peakBucket.bucketLabel}`}</span>
            </p>
          ) : null}
          <HeatLegend />
        </div>
      </div>

      {/* The frame keeps its height across ranges so the panel below it does not
          jump while a range animates in. */}
      <div
        role="grid"
        aria-label={t('workspace.usage.skyline.heatmap')}
        className="relative mt-3 min-h-[8.5rem]"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={timeline.range}
            initial={reduced ? false : { opacity: 0, filter: 'blur(6px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, filter: 'blur(6px)' }}
            transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
          >
            {timeline.range === 'week' ? (
              <UsageWeekMatrix
                timeline={timeline}
                metric={metric}
                intensityOf={intensityOf}
                reduced={reduced}
                weekdayFormat={formats.weekday}
                dayOfMonthFormat={formats.dayOfMonth}
              />
            ) : timeline.range === 'day' ? (
              <UsageDayMatrix
                buckets={timeline.buckets}
                metric={metric}
                intensityOf={intensityOf}
                reduced={reduced}
              />
            ) : (
              <UsageMonthMatrix
                buckets={timeline.buckets}
                metric={metric}
                intensityOf={intensityOf}
                reduced={reduced}
                weekdayFormat={formats.weekday}
                dayOfMonthFormat={formats.dayOfMonth}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-3 border-t border-border/50 pt-3 sm:grid-cols-2">
        <UsageCompositionBar
          label={t('workspace.usage.byModel')}
          segments={modelSegments}
          colors={MODEL_SERIES_COLORS}
          reduced={reduced}
        />
        <UsageCompositionBar
          label={t('workspace.usage.byUser')}
          segments={memberSegments}
          colors={MEMBER_SERIES_COLORS}
          reduced={reduced}
        />
      </div>
    </div>
  );
}

/**
 * Position only — the cell is resolved at render time so a metric switch cannot
 * stale it. Coordinates are relative to the heatmap root, not the scrolling
 * grid, so the bubble can always sit above a cell without the scroller clipping
 * it (`overflow-x: auto` forces `overflow-y: auto`).
 */
type HeatmapTooltip = { left: number; top: number };

/** A clicked day plus where its caret should sit, in heatmap-root coordinates. */
export type UsageSelectedDay = { dayStartMs: number; anchorX: number };

function UsageHeatmap({
  model,
  metric,
  selectedDayMs,
  onSelectDay,
}: {
  model: UsageCalendarModel;
  metric: UsageCalendarMetric;
  selectedDayMs: number | null;
  onSelectDay: (day: UsageSelectedDay | null) => void;
}) {
  const { t } = useTranslation();
  const formats = useCalendarFormats();
  const monthLabels = useMonthLabels(model, formats.month);
  const scale = useMemo(() => createUsageHeatScale(model), [model]);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [tooltip, setTooltip] = useState<HeatmapTooltip | null>(null);
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const selectedIndex = useMemo(
    () =>
      selectedDayMs === null
        ? -1
        : model.cells.findIndex((cell) => cell.dayStartMs === selectedDayMs),
    [model.cells, selectedDayMs]
  );

  const todayIndex = useMemo(() => {
    let latest = -1;
    for (const [index, cell] of model.cells.entries()) if (!cell.isFuture) latest = index;
    return latest;
  }, [model.cells]);
  // Roving tabindex: the grid is one tab stop, arrow keys walk days and weeks.
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, todayIndex));

  const cellLabel = useCallback(
    (cell: UsageCalendarCell) => {
      const date = formats.day.format(new Date(cell.dayStartMs));
      if (cell.isFuture) return `${date} · ${t('workspace.usage.skyline.future')}`;
      if (cell.value <= 0) return `${date} · ${t('workspace.usage.skyline.noUsage')}`;
      const suffix = metric === 'tokens' ? ` ${t('workspace.usage.tokens')}` : '';
      return `${date} · ${formatMetric(cell.value, metric)}${suffix}`;
    },
    [formats.day, metric, t]
  );

  const showDetail = useCallback(
    (index: number, element: HTMLButtonElement | null) => {
      if (!model.cells[index]) return;
      setDetailIndex(index);
      const root = rootRef.current;
      if (!element || !root) return;
      const cellRect = element.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const center = cellRect.left + cellRect.width / 2 - rootRect.left;
      // Keep the bubble inside the card so the first and last weeks stay readable.
      const margin = Math.min(72, rootRect.width / 2);
      setTooltip({
        left: Math.min(Math.max(center, margin), Math.max(margin, rootRect.width - margin)),
        top: cellRect.top - rootRect.top - 6,
      });
    },
    [model.cells]
  );

  const clearDetail = useCallback(() => {
    setTooltip(null);
    setDetailIndex(null);
  }, []);

  /** Caret x for a cell, in coordinates of the heatmap root the panel shares. */
  const measureAnchorX = useCallback((index: number) => {
    const element = cellRefs.current[index];
    const root = rootRef.current;
    if (!element || !root) return 0;
    const cellRect = element.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return cellRect.left + cellRect.width / 2 - rootRect.left;
  }, []);

  const toggleDay = useCallback(
    (index: number) => {
      const cell = model.cells[index];
      // A future day has nothing to expand.
      if (!cell || cell.isFuture) return;
      if (cell.dayStartMs === selectedDayMs) {
        onSelectDay(null);
        return;
      }
      onSelectDay({ dayStartMs: cell.dayStartMs, anchorX: measureAnchorX(index) });
    },
    [measureAnchorX, model.cells, onSelectDay, selectedDayMs]
  );

  // The caret must follow its cell when the calendar scrolls or the panel resizes.
  useEffect(() => {
    if (selectedIndex < 0 || selectedDayMs === null) return undefined;
    const scroller = scrollerRef.current;
    const root = rootRef.current;
    if (!scroller || !root) return undefined;
    const sync = () =>
      onSelectDay({ dayStartMs: selectedDayMs, anchorX: measureAnchorX(selectedIndex) });
    scroller.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(root);
    return () => {
      scroller.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, [measureAnchorX, onSelectDay, selectedDayMs, selectedIndex]);

  const focusCell = useCallback((index: number) => {
    const next = Math.min(Math.max(index, 0), USAGE_CALENDAR_CELLS - 1);
    setFocusIndex(next);
    cellRefs.current[next]?.focus();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const deltas: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: -USAGE_CALENDAR_ROWS,
      ArrowRight: USAGE_CALENDAR_ROWS,
    };
    const delta = deltas[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      focusCell(index + delta);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusCell(event.key === 'Home' ? 0 : Math.max(0, todayIndex));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleDay(index);
    }
  };

  const detailCell = detailIndex === null ? null : model.cells[detailIndex];
  const peakShare = useMemo(() => {
    if (!detailCell || model.maxValue <= 0 || detailCell.value <= 0) return null;
    const percent = (detailCell.value / model.maxValue) * 100;
    // A quiet day next to a launch-day spike must not read as a flat "0%".
    return percent < 1 ? '<1' : String(Math.round(percent));
  }, [detailCell, model.maxValue]);

  return (
    <div ref={rootRef} className="relative space-y-3">
      {/* Columns grow to fill the panel but never shrink past CELL_MIN_SIZE, so a
          day stays a readable target. Below that the year scrolls horizontally;
          the weekday gutter sits outside the scroller and stays pinned. */}
      <div className="flex gap-1.5">
        <div
          aria-hidden="true"
          className="mt-[calc(0.625rem+0.375rem)] grid w-7 shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-none text-muted-foreground"
        >
          {Array.from({ length: USAGE_CALENDAR_ROWS }, (_, row) => {
            const sample = model.cells[row];
            return (
              <span key={row} className="flex items-center">
                {row % 2 === 1 && sample ? formats.weekday.format(new Date(sample.dayStartMs)) : ''}
              </span>
            );
          })}
        </div>

        <div ref={scrollerRef} className="scrollbar-pro min-w-0 flex-1 overflow-x-auto pb-1">
          <div style={{ minWidth: HEATMAP_MIN_TRACK_WIDTH }}>
            <div
              className="mb-1.5 grid gap-[3px] text-[10px] leading-none text-muted-foreground"
              style={{ gridTemplateColumns: HEATMAP_COLUMN_TEMPLATE }}
            >
              {monthLabels.map(({ column, label }) => (
                <span
                  key={column}
                  className="whitespace-nowrap"
                  style={{ gridColumn: `${column + 1} / span ${MIN_COLUMNS_BETWEEN_MONTH_LABELS}` }}
                >
                  {label}
                </span>
              ))}
            </div>

            <div
              role="grid"
              aria-label={t('workspace.usage.skyline.heatmap')}
              className="relative grid grid-rows-7 gap-[3px]"
              style={{ gridTemplateColumns: HEATMAP_COLUMN_TEMPLATE, gridAutoFlow: 'column' }}
              onPointerLeave={clearDetail}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  clearDetail();
              }}
            >
              {model.cells.map((cell, index) => {
                const intensity = cell.isFuture ? 0 : scale.intensity(cell.value);
                return (
                  <button
                    key={cell.dayStartMs}
                    ref={(element) => {
                      cellRefs.current[index] = element;
                    }}
                    type="button"
                    role="gridcell"
                    tabIndex={index === focusIndex ? 0 : -1}
                    aria-label={cellLabel(cell)}
                    aria-selected={index === detailIndex}
                    className={cn(
                      'animate-usage-heatmap-cell aspect-square w-full rounded-[32%] outline-none',
                      'transition-[filter] duration-150',
                      !cell.isFuture &&
                        'hover:brightness-110 hover:ring-1 hover:ring-foreground/40',
                      'focus-visible:ring-2 focus-visible:ring-ring',
                      cell.isFuture ? 'cursor-default' : 'cursor-pointer',
                      index === todayIndex && 'ring-1 ring-inset ring-foreground/45',
                      // No ring offset: the offset ring leaves a gap and reads as
                      // a detached circle around a 32%-rounded cell. A plain ring
                      // is a box-shadow spread, so its corners stay parallel to
                      // the cell's own and it sits flush against it.
                      index === selectedIndex && 'ring-1 ring-foreground'
                    )}
                    style={{
                      backgroundColor: cell.isFuture
                        ? FUTURE_DAY_COLOR
                        : intensity > 0
                          ? heatColor(intensity)
                          : EMPTY_DAY_COLOR,
                      animationDelay: `${cell.column * CELL_REVEAL_STAGGER_MS}ms`,
                    }}
                    onClick={() => toggleDay(index)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    onFocus={(event) => {
                      setFocusIndex(index);
                      showDetail(index, event.currentTarget);
                    }}
                    onPointerEnter={(event) => showDetail(index, event.currentTarget)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {tooltip && detailCell ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-popover px-2 py-1.5 text-[11px] leading-tight text-popover-foreground shadow-md ring-1 ring-border/70"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <span className="font-medium tabular-nums">
            {detailCell.isFuture
              ? t('workspace.usage.skyline.future')
              : detailCell.value > 0
                ? formatMetric(detailCell.value, metric)
                : t('workspace.usage.skyline.noUsage')}
          </span>
          <span className="ml-1.5 text-popover-foreground/60">
            {formats.day.format(new Date(detailCell.dayStartMs))}
          </span>
          {!detailCell.isFuture && detailCell.dayStartMs !== selectedDayMs ? (
            <span className="mt-0.5 block text-popover-foreground/50">
              {t('workspace.usage.skyline.clickForDetails')}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Fixed height, single line, no wrapping: the idle hint carries an icon and
          the selected-day readout does not, and either can be long enough to wrap.
          Without this the row grew and shrank as the pointer moved. */}
      <div className="flex h-5 items-center justify-between gap-4">
        <p
          className="min-w-0 flex-1 truncate text-xs tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {detailCell ? (
            <>
              {cellLabel(detailCell)}
              {peakShare !== null ? (
                <span className="text-muted-foreground/70">
                  {` · ${t('workspace.usage.skyline.peakShare', { percent: peakShare })}`}
                </span>
              ) : null}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
              {t('workspace.usage.skyline.clickHint')}
            </span>
          )}
        </p>
        <HeatLegend />
      </div>
    </div>
  );
}

/**
 * Bar fills are a light tint of the chart blue rather than solid blue: a panel
 * with eight bars reads as a wall of colour otherwise. The label sits on top in
 * the foreground colour, so contrast never depends on the fill.
 */
const RANK_FILL_ALPHAS = [0.42, 0.33, 0.26, 0.2, 0.15] as const;
const rankFill = (rank: number) =>
  heatColor(RANK_FILL_ALPHAS[Math.min(rank, RANK_FILL_ALPHAS.length - 1)]!);
/** The composition rule is small, so it can carry more weight than the bars. */
const COMPOSITION_ALPHAS = [0.75, 0.55, 0.38, 0.24] as const;
const compositionFill = (index: number) =>
  heatColor(COMPOSITION_ALPHAS[index % COMPOSITION_ALPHAS.length]!);

/** Longest model/member list the panel shows before folding the rest into "other". */
const DAY_DETAIL_ROW_LIMIT = 5;

type BreakdownRow = { id: string; label: string; tokens: number; icon?: ReactNode };

function RankedBars({ rows }: { rows: BreakdownRow[] }) {
  const { t } = useTranslation();
  const visible = rows.slice(0, DAY_DETAIL_ROW_LIMIT);
  const max = visible.reduce((peak, row) => Math.max(peak, row.tokens), 0);
  const restTokens = rows
    .slice(DAY_DETAIL_ROW_LIMIT)
    .reduce((sum, row) => sum + Math.max(0, row.tokens), 0);

  return (
    <ul className="space-y-1">
      {visible.map((row, rank) => (
        <li
          key={row.id}
          className="relative h-6 overflow-hidden rounded-[5px] bg-muted-foreground/[0.06]"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded-[5px]"
            style={{
              width: `${max > 0 ? Math.max(3, (row.tokens / max) * 100) : 0}%`,
              backgroundColor: rankFill(rank),
            }}
          />
          <span className="relative flex h-full items-center gap-1.5 px-2">
            {row.icon}
            <span className="truncate text-[11px] font-medium text-foreground">{row.label}</span>
            <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground">
              {formatTokens(row.tokens)}
            </span>
          </span>
        </li>
      ))}
      {restTokens > 0 ? (
        <li className="px-2 pt-0.5 text-[11px] tabular-nums text-muted-foreground/80">
          {t('workspace.usage.skyline.otherRows', {
            count: rows.length - DAY_DETAIL_ROW_LIMIT,
            tokens: formatTokens(restTokens),
          })}
        </li>
      ) : null}
    </ul>
  );
}

function UsageDayDetailPanel({
  dayStartMs,
  anchorX,
  detail,
  loading,
  onClose,
}: {
  dayStartMs: number;
  anchorX: number;
  detail: SettingsUsageDayData | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formats = useCalendarFormats();
  // While a new day is in flight the previous payload is still mounted; only
  // render numbers once they belong to the day the user actually clicked.
  const day = detail?.dayStartMs === dayStartMs ? detail : undefined;

  const composition = day
    ? [
        {
          key: 'cache',
          label: t('workspace.usage.breakdown.cache'),
          value: day.totals.cacheReadInputTokens + day.totals.cacheCreationInputTokens,
        },
        {
          key: 'input',
          label: t('workspace.usage.breakdown.input'),
          value: day.totals.inputTokens,
        },
        {
          key: 'output',
          label: t('workspace.usage.breakdown.output'),
          value: day.totals.outputTokens,
        },
        {
          key: 'reasoning',
          label: t('workspace.usage.breakdown.reasoning'),
          value: day.totals.reasoningOutputTokens,
        },
      ]
        .filter((segment) => segment.value > 0)
        .sort((a, b) => b.value - a.value)
    : [];
  const compositionTotal = composition.reduce((sum, segment) => sum + segment.value, 0);
  const hasUsage = Boolean(day && day.totals.tokens > 0);

  return (
    <div className="relative pt-2">
      <span
        aria-hidden="true"
        className="absolute top-0.5 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] bg-muted/60"
        style={{ left: anchorX }}
      />
      <section
        aria-label={t('workspace.usage.skyline.dayDetail')}
        className="relative rounded-lg bg-muted/40 p-4"
      >
        <Button
          size="icon"
          variant="ghost"
          aria-label={t('common.close')}
          className="absolute right-2 top-2 h-6 w-6 text-muted-foreground"
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,13rem)_1fr]">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">
              {formats.day.format(new Date(dayStartMs))}
            </p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold leading-none tabular-nums text-foreground">
                {day ? (
                  <NumberFlow
                    value={day.totals.tokens}
                    format={{ notation: 'compact', maximumFractionDigits: 1 }}
                  />
                ) : (
                  '—'
                )}
              </span>
              <span className="text-xs text-muted-foreground">{t('workspace.usage.tokens')}</span>
            </p>
            <p className="mt-1.5 min-h-4 text-xs tabular-nums text-muted-foreground">
              {day
                ? [
                    formatCost(day.totals.costUSD),
                    day.totals.webSearchRequests > 0
                      ? t('workspace.usage.skyline.webSearches', {
                          count: day.totals.webSearchRequests,
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : ''}
            </p>

            {hasUsage ? (
              <>
                <div aria-hidden="true" className="mt-4 flex h-1.5 overflow-hidden rounded-full">
                  {composition.map((segment, index) => (
                    <span
                      key={segment.key}
                      style={{
                        width: `${(segment.value / compositionTotal) * 100}%`,
                        backgroundColor: compositionFill(index),
                      }}
                    />
                  ))}
                </div>
                <ul className="mt-2 space-y-1">
                  {composition.map((segment, index) => (
                    <li key={segment.key} className="flex items-center gap-1.5 text-[11px]">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: compositionFill(index) }}
                      />
                      <span className="truncate text-muted-foreground">{segment.label}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-foreground/80">
                        {formatTokens(segment.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {!day && loading ? (
              <div className="mt-4 space-y-2" aria-busy="true">
                <div className="h-1.5 w-full animate-pulse rounded-full bg-muted-foreground/15" />
                <div className="h-1.5 w-2/3 animate-pulse rounded-full bg-muted-foreground/15" />
              </div>
            ) : null}
            {day && !hasUsage ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {t('workspace.usage.skyline.noUsage')}
              </p>
            ) : null}
          </div>

          {hasUsage && day ? (
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                  {t('workspace.usage.byModel')}
                </p>
                <RankedBars
                  rows={day.byModel.map((row) => ({
                    id: row.modelId,
                    label: row.modelId,
                    tokens: row.tokens,
                    icon: (
                      <ModelBrandIcon
                        modelId={row.modelId}
                        className="h-3 w-3 shrink-0 text-foreground/50"
                      />
                    ),
                  }))}
                />
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                  {t('workspace.usage.byUser')}
                </p>
                <RankedBars
                  rows={day.byUser.map((row) => {
                    const user = day.users[row.userId];
                    const label = user?.name || user?.email || row.userId;
                    return {
                      id: row.userId,
                      label,
                      tokens: row.tokens,
                      icon: (
                        <Avatar className="size-4 shrink-0">
                          {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
                          <AvatarFallback className="bg-foreground/15 text-[8px] font-medium uppercase text-foreground/80">
                            {label.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                      ),
                    };
                  })}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function FitCamera({
  width,
  depth,
  height,
  centerX = 0,
  padding = 1,
  framing = 1,
  front = false,
}: {
  width: number;
  depth: number;
  height: number;
  centerX?: number;
  padding?: number;
  framing?: number;
  front?: boolean;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const orthographic = camera as THREE.OrthographicCamera;
    const aspect = Math.max(0.5, size.width / Math.max(1, size.height));
    // Account for both horizontal and vertical spans of the isometric projection.
    // The previous width-only calculation cropped the far edge on wide canvases.
    const horizontalSpan = (width + depth) * 0.78;
    const verticalSpan = (width + depth) * 0.52 + height;
    const fittedFrustumHeight = Math.max(
      17,
      verticalSpan * padding,
      (horizontalSpan * padding) / aspect
    );
    const frustumHeight = fittedFrustumHeight * framing;
    const cameraDistance = Math.max(width, depth) * 0.88;
    orthographic.zoom = 1;
    orthographic.left = (-frustumHeight * aspect) / 2;
    orthographic.right = (frustumHeight * aspect) / 2;
    orthographic.top = frustumHeight / 2;
    orthographic.bottom = -frustumHeight / 2;
    orthographic.position.set(
      centerX + (front ? cameraDistance * 0.45 : cameraDistance),
      cameraDistance * 0.72 + height,
      front ? -cameraDistance : cameraDistance
    );
    orthographic.lookAt(centerX, height * 0.16, 0);
    orthographic.updateProjectionMatrix();
  }, [camera, centerX, depth, framing, front, height, padding, size.height, size.width, width]);
  return null;
}

function SceneOrbitControls({ targetY }: { targetY: number }) {
  const { camera, gl } = useThree();
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl]);

  useEffect(() => {
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minZoom = 0.65;
    controls.maxZoom = 3.2;
    controls.target.set(0, targetY, 0);
    controls.update();
    return () => controls.dispose();
  }, [controls, targetY]);

  useFrame(() => controls.update());
  return null;
}

type UsageSkylineRenderCell = Pick<UsageCalendarCell, 'column' | 'row' | 'value' | 'level'> & {
  isFuture: boolean;
};

type UsageSkylineRenderModel = {
  cells: UsageSkylineRenderCell[];
  maxValue: number;
  columns: number;
  rows: number;
  centerX: number;
  viewportWidth: number;
};

function createTimelineSkylineModel(
  timeline: SettingsUsageTimelineData,
  metric: UsageCalendarMetric
): UsageSkylineRenderModel {
  // Short ranges read most clearly as a strip (24h / 7d). The 30-day view
  // folds back into seven rows, preserving the familiar calendar silhouette.
  const rows = timeline.range === 'month' || timeline.range === 'total' ? 7 : 1;
  const columns = Math.max(1, Math.ceil(timeline.buckets.length / rows));
  const values = timeline.buckets.map((bucket) =>
    metric === 'tokens' ? bucket.tokens : bucket.costUSD
  );
  const maxValue = values.reduce((maximum, value) => Math.max(maximum, value), 0);
  return {
    cells: values.map((value, index) => ({
      column: Math.floor(index / rows),
      row: index % rows,
      value,
      level: getUsageCalendarLevel(value, maxValue),
      isFuture: false,
    })),
    maxValue,
    columns,
    rows,
    centerX: 0,
    viewportWidth: columns,
  };
}

function createCalendarSkylineRenderModel(model: UsageCalendarModel): UsageSkylineRenderModel {
  const viewport = getUsageSkylineViewport(model);
  return {
    cells: model.cells,
    maxValue: model.maxValue,
    columns: USAGE_CALENDAR_COLUMNS,
    rows: USAGE_CALENDAR_ROWS,
    centerX: viewport.centerX,
    viewportWidth: viewport.width,
  };
}

function UsageColumns({ model }: { model: UsageSkylineRenderModel }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const activeCells = useMemo(
    () => model.cells.filter((cell) => !cell.isFuture && cell.value > 0),
    [model.cells]
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = activeCells.length;
    for (const [index, cell] of activeCells.entries()) {
      const height = getUsageColumnHeight(cell.value, model.maxValue, 'skyline');
      dummy.position.set(
        cell.column - (model.columns - 1) / 2,
        height / 2,
        cell.row - (model.rows - 1) / 2
      );
      dummy.scale.set(0.9, height, 0.9);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      color.set(LEVEL_COLORS[cell.level]);
      mesh.setColorAt(index, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [activeCells, color, dummy, model.columns, model.maxValue, model.rows]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, activeCells.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.7} metalness={0.04} />
    </instancedMesh>
  );
}

function IsometricView({
  model,
  className,
  framing,
}: {
  model: UsageSkylineRenderModel;
  className?: string;
  framing?: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t('workspace.usage.skyline.isometric')}
      className={cn('h-[300px] overflow-hidden rounded-md bg-muted/30 sm:h-[360px]', className)}
    >
      <Canvas orthographic dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={1.8} />
        <directionalLight position={[22, 32, 18]} intensity={2.2} />
        <directionalLight position={[-18, 12, -8]} intensity={0.55} color="#78c8ff" />
        <FitCamera
          width={model.viewportWidth}
          depth={model.rows}
          height={6}
          centerX={model.centerX}
          framing={framing}
        />
        <UsageColumns model={model} />
      </Canvas>
    </div>
  );
}

function SummaryStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">
        {value}
      </dd>
      {detail ? <p className="truncate text-[11px] text-muted-foreground/80">{detail}</p> : null}
    </div>
  );
}

function UsageSummary({
  model,
  metric,
}: {
  model: UsageCalendarModel;
  metric: UsageCalendarMetric;
}) {
  const { t } = useTranslation();
  const formats = useCalendarFormats();
  const completedCells = useMemo(() => model.cells.filter((cell) => !cell.isFuture), [model.cells]);
  const peakCell = useMemo(
    () =>
      completedCells.reduce<UsageCalendarCell | null>(
        (peak, cell) => (!peak || cell.value > peak.value ? cell : peak),
        null
      ),
    [completedCells]
  );
  const dailyAverage = completedCells.length > 0 ? model.totalValue / completedCells.length : 0;
  const peakDate =
    peakCell && peakCell.value > 0
      ? formats.day.format(new Date(peakCell.dayStartMs))
      : t('workspace.usage.skyline.noUsage');

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryStat
        label={t('workspace.usage.skyline.total')}
        value={formatMetric(model.totalValue, metric)}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.dailyAverage')}
        value={formatMetric(dailyAverage, metric)}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.peakDay')}
        value={formatMetric(peakCell?.value ?? 0, metric)}
        detail={peakDate}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.activeDays')}
        value={String(model.activeDays)}
        detail={t('workspace.usage.skyline.currentStreakDetail', { days: model.currentStreak })}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.longestStreak')}
        value={String(model.longestStreak)}
      />
    </dl>
  );
}

function UsageTimelineSummary({
  timeline,
  metric,
}: {
  timeline: SettingsUsageTimelineData;
  metric: UsageCalendarMetric;
}) {
  const { t } = useTranslation();
  const values = timeline.buckets.map((bucket) =>
    metric === 'tokens' ? bucket.tokens : bucket.costUSD
  );
  const active = values.filter((value) => value > 0);
  const peakIndex = values.reduce(
    (peak, value, index) => (value > (values[peak] ?? 0) ? index : peak),
    0
  );
  let currentStreak = 0;
  for (let index = values.length - 1; index >= 0 && values[index]! > 0; index -= 1) {
    currentStreak += 1;
  }
  let longestStreak = 0;
  let streak = 0;
  for (const value of values) {
    streak = value > 0 ? streak + 1 : 0;
    longestStreak = Math.max(longestStreak, streak);
  }
  const peakBucket = timeline.buckets[peakIndex];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
      <SummaryStat
        label={t('workspace.usage.skyline.total')}
        value={formatMetric(metric === 'tokens' ? timeline.totals.tokens : timeline.totals.costUSD, metric)}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.averagePerInterval')}
        value={formatMetric(values.length > 0 ? (metric === 'tokens' ? timeline.totals.tokens : timeline.totals.costUSD) / values.length : 0, metric)}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.peakInterval')}
        value={formatMetric(values[peakIndex] ?? 0, metric)}
        detail={peakBucket?.bucketLabel ?? t('workspace.usage.skyline.noUsage')}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.activeIntervals')}
        value={String(active.length)}
        detail={t('workspace.usage.skyline.currentIntervalStreakDetail', { count: currentStreak })}
      />
      <SummaryStat
        label={t('workspace.usage.skyline.longestStreak')}
        value={String(longestStreak)}
      />
    </dl>
  );
}

function StlMetalColumns({ model }: { model: UsageCalendarModel }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const activeCells = useMemo(
    () => model.cells.filter((cell) => !cell.isFuture && cell.value > 0),
    [model.cells]
  );

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.count = activeCells.length;
    for (const [index, cell] of activeCells.entries()) {
      const height =
        getUsageColumnHeight(cell.value, model.maxValue, 'skyline') *
        USAGE_SKYLINE_STL_COLUMN_HEIGHT_MULTIPLIER;
      dummy.position.set(
        USAGE_SKYLINE_STL_BASE_WIDTH / 2 -
          (USAGE_SKYLINE_STL_CELL_SIZE +
            cell.column * USAGE_SKYLINE_STL_CELL_SIZE +
            USAGE_SKYLINE_STL_CELL_SIZE / 2),
        height / 2,
        USAGE_SKYLINE_STL_BACK_MARGIN +
          cell.row * USAGE_SKYLINE_STL_CELL_SIZE +
          USAGE_SKYLINE_STL_CELL_SIZE / 2 -
          USAGE_SKYLINE_STL_BASE_DEPTH / 2
      );
      dummy.scale.set(USAGE_SKYLINE_STL_CELL_SIZE, height, USAGE_SKYLINE_STL_CELL_SIZE);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [activeCells, dummy, model.maxValue]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, Math.max(1, activeCells.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#c8d1d9" metalness={0.72} roughness={0.23} />
    </instancedMesh>
  );
}

function StlLodyLogoRelief() {
  const geometry = useMemo(() => {
    const triangles = createUsageSkylineLodyLogoTriangles();
    // The STL keeps a closed back face for printing, but it lies exactly on the base face.
    // Excluding it from the preview prevents depth-buffer flicker while orbiting the model.
    const visualTriangles = triangles.filter(
      (triangle) => ![triangle.a, triangle.b, triangle.c].every(([, y]) => y === 0)
    );
    const positions = new Float32Array(visualTriangles.length * 9);
    let offset = 0;
    for (const triangle of visualTriangles) {
      for (const [x, y, z] of [triangle.a, triangle.c, triangle.b]) {
        positions[offset++] = USAGE_SKYLINE_STL_BASE_WIDTH / 2 - x;
        positions[offset++] = z;
        positions[offset++] = y - USAGE_SKYLINE_STL_BASE_DEPTH / 2;
      }
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    result.computeVertexNormals();
    return result;
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#e8eef2" metalness={0.84} roughness={0.24} />
    </mesh>
  );
}

function StlMetalView({ model }: { model: UsageCalendarModel }) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t('workspace.usage.skyline.stlMetalPreview')}
      className="h-[300px] overflow-hidden rounded-md border border-border/70 bg-muted/35 sm:h-[360px]"
    >
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        className="touch-none cursor-grab active:cursor-grabbing"
      >
        <ambientLight intensity={1.15} />
        <hemisphereLight args={['#d6e8ff', '#27303a', 1.5]} />
        <directionalLight position={[80, 110, 65]} intensity={4.2} color="#f5f7fa" />
        <directionalLight position={[-60, 38, 48]} intensity={3.1} color="#86b8ff" />
        <directionalLight position={[24, 18, -72]} intensity={2.1} color="#f3c68b" />
        <FitCamera
          width={USAGE_SKYLINE_STL_BASE_WIDTH}
          depth={USAGE_SKYLINE_STL_BASE_DEPTH}
          height={30}
          padding={1.2}
          front
        />
        <SceneOrbitControls targetY={4} />
        <mesh position={[0, -USAGE_SKYLINE_STL_BASE_HEIGHT / 2, 0]}>
          <boxGeometry
            args={[
              USAGE_SKYLINE_STL_BASE_WIDTH,
              USAGE_SKYLINE_STL_BASE_HEIGHT,
              USAGE_SKYLINE_STL_BASE_DEPTH,
            ]}
          />
          <meshStandardMaterial color="#68737d" metalness={0.78} roughness={0.3} />
        </mesh>
        <StlLodyLogoRelief />
        <StlMetalColumns model={model} />
      </Canvas>
    </div>
  );
}

function SkylineAscii({ content }: { content: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border/70 bg-[#0d1117] p-3 font-mono text-[9px] leading-[1.15] text-[#39d353] select-text sm:text-[11px]">
      {content}
    </pre>
  );
}

export function UsageCalendarVisualization({
  calendar,
  timeline,
  workspaceName,
  dayDetail,
  dayDetailLoading = false,
  onSelectedDayChange,
}: {
  calendar: SettingsUsageCalendarData;
  /** Selected-range timeline used for the compact skyline and 100% composition rings. */
  timeline?: SettingsUsageTimelineData;
  workspaceName?: string;
  /** Breakdown for the currently selected day; the container owns the query. */
  dayDetail?: SettingsUsageDayData;
  dayDetailLoading?: boolean;
  onSelectedDayChange?: (dayStartMs: number | null) => void;
}) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<UsageSelectedDay | null>(null);
  // Kept so the panel still has content to render while it collapses.
  const [collapsingDay, setCollapsingDay] = useState<UsageSelectedDay | null>(null);
  const notifiedDayRef = useRef<number | null>(null);
  const [metric, setMetric] = useState<UsageCalendarMetric>('tokens');
  const [shareCardStyle, setShareCardStyle] = useState<UsageShareCardStyle>('isometric');
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [sharePreview, setSharePreview] = useState<UsageShareCardPreview | null>(null);
  const [isSharePreviewLoading, setIsSharePreviewLoading] = useState(false);
  // Exports and the share card are always token-denominated; only the on-screen
  // views follow the metric toggle.
  const tokenModel = useMemo(() => createUsageCalendarModel(calendar, 'tokens'), [calendar]);
  const costModel = useMemo(() => createUsageCalendarModel(calendar, 'costUSD'), [calendar]);
  const model = metric === 'tokens' ? tokenModel : costModel;
  const skylineModel = useMemo(
    () =>
      timeline && timeline.range !== 'total'
        ? createTimelineSkylineModel(timeline, metric)
        : createCalendarSkylineRenderModel(model),
    [metric, model, timeline]
  );
  const ascii = useMemo(() => createUsageSkylineAscii(tokenModel), [tokenModel]);
  const stem = fileStem(workspaceName || 'lody-usage');

  useEffect(() => {
    scheduleUsageShareCardFontPreload();
  }, []);

  const selectDay = useCallback(
    (day: UsageSelectedDay | null) => {
      setSelectedDay(day);
      if (day) setCollapsingDay(day);
      // Scroll and resize syncs only move the caret. Re-notifying the container
      // on those would restart the day query for a day it already has.
      const nextDayStartMs = day?.dayStartMs ?? null;
      if (notifiedDayRef.current === nextDayStartMs) return;
      notifiedDayRef.current = nextDayStartMs;
      onSelectedDayChange?.(nextDayStartMs);
    },
    [onSelectedDayChange]
  );

  useEffect(() => {
    if (timeline && timeline.range !== 'total' && selectedDay) selectDay(null);
  }, [selectDay, selectedDay, timeline]);

  const copyAscii = async () => {
    try {
      await navigator.clipboard.writeText(ascii);
      toast.success(t('workspace.usage.skyline.asciiCopied'));
    } catch {
      toast.error(t('workspace.usage.skyline.copyFailed'));
    }
  };

  const exportAscii = () => {
    downloadBlob(
      new Blob([ascii], { type: 'text/plain;charset=utf-8' }),
      `${stem}-usage-skyline.txt`
    );
  };

  const exportStl = () => {
    downloadBlob(
      new Blob([createUsageSkylineBinaryStl(tokenModel)], { type: 'model/stl' }),
      `${stem}-usage-skyline.stl`
    );
  };

  const createCard = useCallback(async () => {
    const card = await createUsageShareCard(
      tokenModel,
      workspaceName || t('workspace.usage.title'),
      `${formatTokens(tokenModel.totalValue)} ${t('workspace.usage.tokens')}`,
      shareCardStyle
    );
    const cardKind = shareCardStyle === 'flat' ? 'heatmap' : 'skyline';
    return new File([card], `${stem}-usage-${cardKind}.png`, { type: 'image/png' });
  }, [shareCardStyle, stem, t, tokenModel, workspaceName]);

  useEffect(() => {
    let cancelled = false;
    if (sharePopoverOpen) {
      setIsSharePreviewLoading(true);
      setSharePreview(null);

      void createCard()
        .then((file) => {
          const url = URL.createObjectURL(file);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          setSharePreview({ file, style: shareCardStyle, url });
        })
        .catch(() => {
          if (!cancelled) toast.error(t('workspace.usage.skyline.cardFailed'));
        })
        .finally(() => {
          if (!cancelled) setIsSharePreviewLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [createCard, shareCardStyle, sharePopoverOpen, t]);

  useEffect(() => {
    const url = sharePreview?.url;
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [sharePreview]);

  const shareCard = async () => {
    try {
      const file = sharePreview?.style === shareCardStyle ? sharePreview.file : await createCard();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t('workspace.usage.skyline.shareCard') });
      } else {
        downloadBlob(file, file.name);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error(t('workspace.usage.skyline.cardFailed'));
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {t('workspace.usage.skyline.title')}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {timeline && timeline.range !== 'total'
              ? t(`workspace.usage.window.${timeline.range}.long`)
              : t('workspace.usage.skyline.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <SegmentedControl
            label={t('workspace.usage.skyline.metric')}
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'tokens', label: t('workspace.usage.tokens') },
              { value: 'costUSD', label: t('workspace.usage.cost') },
            ]}
          />
          {SHOW_SHARE_CARD ? (
            <Popover open={sharePopoverOpen} onOpenChange={setSharePopoverOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t('workspace.usage.skyline.shareCard')}
                    >
                      <Share2 />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{t('workspace.usage.skyline.shareCard')}</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-xs font-medium text-popover-foreground/70">
                    {t('workspace.usage.skyline.shareCard')}
                  </p>
                  <SegmentedControl
                    label={t('workspace.usage.skyline.view')}
                    value={shareCardStyle}
                    onChange={setShareCardStyle}
                    options={[
                      { value: 'flat', label: '2D' },
                      { value: 'isometric', label: '3D' },
                    ]}
                  />
                </div>
                <div className="p-3">
                  <div className="relative aspect-[40/21] overflow-hidden rounded-sm border border-border/70 bg-muted/40">
                    {sharePreview ? (
                      <img
                        src={sharePreview.url}
                        alt={t('workspace.usage.skyline.shareCard')}
                        className="h-full w-full object-contain"
                      />
                    ) : null}
                    {isSharePreviewLoading ? (
                      <LoaderCircle className="absolute inset-0 m-auto h-5 w-5 animate-spin text-muted-foreground" />
                    ) : null}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSharePreviewLoading}
                      onClick={() => void shareCard()}
                    >
                      <Share2 className="h-4 w-4" />
                      {t('workspace.usage.skyline.shareCard')}
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </header>

      <div className="p-4">
        {timeline && timeline.range !== 'total' ? (
          <UsageRangePanel timeline={timeline} metric={metric} />
        ) : (
          <UsageHeatmap
            model={model}
            metric={metric}
            selectedDayMs={selectedDay?.dayStartMs ?? null}
            onSelectDay={selectDay}
          />
        )}
        {/* Expanding a row height needs a definite value; the 0fr -> 1fr grid
            track does it without measuring the panel. */}
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
            selectedDay ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
          onTransitionEnd={() => {
            if (!selectedDay) setCollapsingDay(null);
          }}
        >
          <div className="min-h-0 overflow-hidden">
            {collapsingDay ? (
              <UsageDayDetailPanel
                dayStartMs={collapsingDay.dayStartMs}
                anchorX={collapsingDay.anchorX}
                detail={dayDetail}
                loading={dayDetailLoading}
                onClose={() => selectDay(null)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Metrics band — the skyline lives here as a watermark. Hovering the band
          brings it forward (opacity + a small lift) instead of giving the 3D view
          a tab of its own. */}
      <div
        className={cn(
          'group relative overflow-hidden border-t border-border/60 bg-muted/25 px-4 py-4 sm:px-5',
          timeline ? 'min-h-48' : 'min-h-32 sm:min-h-36'
        )}
      >
        <IsometricView
          model={skylineModel}
          className={cn(
            'pointer-events-none absolute -right-16 -top-20 h-64 w-[38rem] origin-top-right rounded-none bg-transparent',
            // Tailwind v4 emits the standalone `scale` property, not `transform`.
            'opacity-15 transition-[opacity,scale] duration-500 ease-out max-sm:opacity-10',
            'group-hover:scale-[1.06] group-hover:opacity-35',
            'motion-reduce:transition-none motion-reduce:group-hover:scale-100'
          )}
          framing={timeline && timeline.range !== 'total' ? 0.85 : 0.4}
        />
        <div className="relative">
          {timeline ? (
            timeline.range === 'total' ? (
              <UsageSummary model={model} metric={metric} />
            ) : (
              <UsageTimelineSummary timeline={timeline} metric={metric} />
            )
          ) : (
            <UsageSummary model={model} metric={metric} />
          )}
        </div>
      </div>

      <div className="space-y-4 p-4 empty:hidden">
        {SHOW_SKYLINE_EXPORTS ? (
          <>
            <StlMetalView model={tokenModel} />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{t('workspace.usage.skyline.asciiPreview')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => void copyAscii()}
                      aria-label={t('workspace.usage.skyline.copyAscii')}
                    >
                      <Copy />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('workspace.usage.skyline.copyAscii')}</TooltipContent>
                </Tooltip>
                <Button size="sm" variant="outline" onClick={exportAscii}>
                  <Download className="h-4 w-4" />
                  {t('workspace.usage.skyline.downloadAscii')}
                </Button>
                <Button size="sm" onClick={exportStl}>
                  <Box className="h-4 w-4" />
                  {t('workspace.usage.skyline.downloadBinaryStl')}
                </Button>
              </div>
            </div>
            <SkylineAscii content={ascii} />
          </>
        ) : null}
      </div>
    </section>
  );
}
