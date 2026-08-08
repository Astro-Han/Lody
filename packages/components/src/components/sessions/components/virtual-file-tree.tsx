import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight } from 'lucide-react';
import type { TreeDataItem } from '@/components/tree-view';
import { cn } from '@/lib/utils';
import {
  flattenVisibleFileTreeRows,
  pruneExpandedFileTreeIds,
  shouldVirtualizeVisibleFileTreeRows,
  type VirtualFileTreeRow as VirtualFileTreeRowModel,
} from '@/lib/file-tree-virtualization';
import { logCodeCollabDebug } from '@/lib/code-collab-debug';
import { DefaultFileIcon, DefaultFolderIcon } from '@/components/icons/file-icons';

const VIRTUAL_FILE_TREE_ROW_HEIGHT_PX = 22;
const VIRTUAL_FILE_TREE_OVERSCAN = 12;
const TREE_INDENT_PX = 8;

// 'virtualized-pending-measure' means virtualization is required but the scrollport
// has no measured height yet, so the visible range is empty. It must never degrade
// into rendering the whole list — see the comment on the render branch below.
type VirtualFileTreeRenderMode = 'static-visible' | 'virtualized' | 'virtualized-pending-measure';

export function VirtualFileTree({
  data,
  viewportRef,
}: {
  readonly data: readonly TreeDataItem[];
  readonly viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    setExpandedIds((current) => pruneExpandedFileTreeIds(current, data));
  }, [data]);

  const rows = useMemo(() => flattenVisibleFileTreeRows(data, expandedIds), [data, expandedIds]);
  const getVirtualItemKey = useCallback((index: number) => rows[index]?.item.id ?? index, [rows]);
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => VIRTUAL_FILE_TREE_ROW_HEIGHT_PX,
    getItemKey: getVirtualItemKey,
    overscan: VIRTUAL_FILE_TREE_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
  });
  const virtualItems = rowVirtualizer.getVirtualItems();
  const shouldVirtualizeRows = shouldVirtualizeVisibleFileTreeRows(rows.length);
  const renderMode: VirtualFileTreeRenderMode = !shouldVirtualizeRows
    ? 'static-visible'
    : virtualItems.length === 0
      ? 'virtualized-pending-measure'
      : 'virtualized';

  // The ScrollArea viewport ref belongs to an ancestor, so React attaches it only
  // after this subtree commits: the virtualizer's first pass sees a null scroll
  // element and can never observe it on its own. One measure() after mount forces
  // the re-render that hands it the element (mirrors option-selector.tsx). Resizes
  // after that are covered by the virtualizer's own ResizeObserver.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer]);

  // Log transitions only. This used to fire on every virtual-range change, i.e.
  // continuously while scrolling, and every call allocates a trace entry into the
  // code-collab debug ring whether or not debugging is enabled.
  const renderStateRef = useRef({ rowCount: rows.length, virtualItemCount: virtualItems.length });
  renderStateRef.current = { rowCount: rows.length, virtualItemCount: virtualItems.length };
  useEffect(() => {
    logCodeCollabDebug('file tree virtual rows state', {
      visibleRowCount: renderStateRef.current.rowCount,
      virtualItemCount: renderStateRef.current.virtualItemCount,
      renderMode,
    });
  }, [renderMode]);

  const toggleDirectory = useCallback((itemId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  if (!shouldVirtualizeRows) {
    return (
      <div role="tree" className="min-w-0">
        {rows.map((row) => (
          <VirtualFileTreeRow
            key={row.item.id}
            row={row}
            selected={selectedId === row.item.id}
            onSelect={setSelectedId}
            onToggleDirectory={toggleDirectory}
          />
        ))}
      </div>
    );
  }

  // An empty range while virtualization is required means the scrollport has not
  // been measured yet (ref not attached on the first commit, or the side panel is
  // collapsed and reports zero height). Falling back to rendering every visible row
  // here would mount the entire expanded tree exactly when virtualization matters
  // most, then tear it down again on the next measure. Keep the spacer and wait.
  return (
    <div
      role="tree"
      className="relative min-w-0"
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
    >
      {virtualItems.map((virtualItem) => {
        const row = rows[virtualItem.index];
        if (!row) return null;
        return (
          <VirtualFileTreeRow
            key={virtualItem.key}
            row={row}
            selected={selectedId === row.item.id}
            virtualStart={virtualItem.start}
            virtualSize={virtualItem.size}
            onSelect={setSelectedId}
            onToggleDirectory={toggleDirectory}
          />
        );
      })}
    </div>
  );
}

// Memoized: a scroll gesture re-renders VirtualFileTree once per virtual-range
// change, and without this every mounted row re-renders with identical props.
// `row` comes from a memoized flatten and both handlers are stable, so during a
// pure scroll only the rows entering the range do any work.
const VirtualFileTreeRow = memo(function VirtualFileTreeRow({
  row,
  selected,
  virtualStart,
  virtualSize,
  onSelect,
  onToggleDirectory,
}: {
  readonly row: VirtualFileTreeRowModel;
  readonly selected: boolean;
  readonly virtualStart?: number;
  readonly virtualSize?: number;
  readonly onSelect: (itemId: string) => void;
  readonly onToggleDirectory: (itemId: string) => void;
}) {
  const item = row.item;
  const disabled = item.disabled === true;
  const isLeaf = !row.hasChildren;
  const Icon =
    selected && item.selectedIcon
      ? item.selectedIcon
      : row.isOpen && item.openIcon
        ? item.openIcon
        : (item.icon ?? (isLeaf ? DefaultFileIcon : DefaultFolderIcon));
  const paddingLeft = row.level * TREE_INDENT_PX + 8 + (isLeaf ? 18 : 0);

  const activate = () => {
    if (disabled) return;
    onSelect(item.id);
    if (row.hasChildren) {
      onToggleDirectory(item.id);
      item.onClick?.();
      return;
    }
    item.onClick?.();
  };

  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={row.hasChildren ? row.isOpen : undefined}
      aria-level={row.level + 1}
      aria-selected={selected}
      disabled={disabled}
      className={cn(
        'group flex w-full items-center pr-2 text-left text-sm outline-none hover:bg-hover hover:text-hover-foreground focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-ring',
        virtualStart !== undefined && 'absolute left-0 top-0',
        selected &&
          'bg-selection text-selection-foreground hover:bg-selection hover:text-selection-foreground',
        disabled && 'cursor-not-allowed opacity-50',
        item.className
      )}
      style={{
        height: `${virtualSize ?? VIRTUAL_FILE_TREE_ROW_HEIGHT_PX}px`,
        paddingLeft,
        ...(virtualStart === undefined ? {} : { transform: `translateY(${virtualStart}px)` }),
      }}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate();
          return;
        }
        if (!row.hasChildren) return;
        if (event.key === 'ArrowRight' && !row.isOpen) {
          event.preventDefault();
          onSelect(item.id);
          onToggleDirectory(item.id);
          item.onClick?.();
        } else if (event.key === 'ArrowLeft' && row.isOpen) {
          event.preventDefault();
          onSelect(item.id);
          onToggleDirectory(item.id);
        }
      }}
    >
      {row.hasChildren ? (
        <ChevronRight
          className={cn(
            'mr-0.5 h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-200',
            row.isOpen && 'rotate-90'
          )}
        />
      ) : null}
      <Icon className="mr-1 h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate" title={item.id}>
        {item.name}
      </span>
    </button>
  );
});
