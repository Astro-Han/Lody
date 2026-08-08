import type { TreeDataItem } from '@/components/tree-view';

export type VirtualFileTreeRow = {
  readonly item: TreeDataItem;
  readonly level: number;
  readonly hasChildren: boolean;
  readonly isOpen: boolean;
};

export const FILE_TREE_VIRTUALIZE_THRESHOLD = 50;

export function countTreeDataItems(items: readonly TreeDataItem[]): number {
  let count = 0;
  const walk = (nodes: readonly TreeDataItem[]) => {
    for (const node of nodes) {
      count += 1;
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(items);
  return count;
}

export function shouldVirtualizeFileTreeData(
  items: readonly TreeDataItem[],
  threshold = FILE_TREE_VIRTUALIZE_THRESHOLD
): boolean {
  return countTreeDataItems(items) > threshold;
}

export function shouldVirtualizeVisibleFileTreeRows(
  rowCount: number,
  threshold = FILE_TREE_VIRTUALIZE_THRESHOLD
): boolean {
  return rowCount > threshold;
}

export function flattenVisibleFileTreeRows(
  items: readonly TreeDataItem[],
  expandedIds: ReadonlySet<string>
): VirtualFileTreeRow[] {
  const rows: VirtualFileTreeRow[] = [];
  const walk = (nodes: readonly TreeDataItem[], level: number) => {
    for (const item of nodes) {
      const hasChildren = Boolean(item.children?.length) || item.forceNode === true;
      const isOpen = hasChildren && expandedIds.has(item.id);
      rows.push({ item, level, hasChildren, isOpen });
      if (isOpen && item.children) {
        walk(item.children, level + 1);
      }
    }
  };
  walk(items, 0);
  return rows;
}

// Returns the SAME set reference when nothing was pruned. The caller feeds this
// straight into `setExpandedIds` on every tree-data change, so handing back a
// fresh Set for a no-op would re-render, re-flatten, and re-measure the virtual
// list every time the file index churns.
export function pruneExpandedFileTreeIds(
  expandedIds: ReadonlySet<string>,
  items: readonly TreeDataItem[]
): ReadonlySet<string> {
  if (expandedIds.size === 0) {
    return expandedIds;
  }

  const validIds = new Set<string>();
  const walk = (nodes: readonly TreeDataItem[]) => {
    for (const node of nodes) {
      if (node.children?.length || node.forceNode === true) {
        validIds.add(node.id);
        walk(node.children ?? []);
      }
    }
  };
  walk(items);

  const kept = new Set<string>();
  for (const id of expandedIds) {
    if (validIds.has(id)) {
      kept.add(id);
    }
  }
  return kept.size === expandedIds.size ? expandedIds : kept;
}
