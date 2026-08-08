// @vitest-environment jsdom

import { createElement, createRef, useRef, type RefObject } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TreeDataItem } from '../src/components/tree-view';
import { VirtualFileTree } from '../src/components/sessions/components/virtual-file-tree';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ROW_HEIGHT_PX = 22;
const VIEWPORT_HEIGHT_PX = 300;

const buildFlatTree = (count: number): TreeDataItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `file-${index}.ts`,
    name: `file-${index}.ts`,
  }));

// Mirrors the production shape: the scrollport is an ancestor of VirtualFileTree,
// so its ref is only attached after the tree subtree has already committed.
function Harness({
  data,
  viewportRef,
}: {
  readonly data: readonly TreeDataItem[];
  readonly viewportRef?: RefObject<HTMLDivElement | null>;
}) {
  const fallbackRef = useRef<HTMLDivElement | null>(null);
  const ref = viewportRef ?? fallbackRef;
  return createElement(
    'div',
    { ref, 'data-testid': 'viewport' },
    createElement(VirtualFileTree, { data, viewportRef: ref })
  );
}

let container: HTMLDivElement;
let root: Root;

const render = (data: readonly TreeDataItem[], viewportRef?: RefObject<HTMLDivElement | null>) => {
  act(() => {
    root.render(createElement(Harness, { data, viewportRef }));
  });
};

const queryRows = () => container.querySelectorAll('[role="treeitem"]');
const queryTree = () => container.querySelector('[role="tree"]') as HTMLElement | null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('VirtualFileTree', () => {
  it('renders every row without virtualization below the threshold', () => {
    render(buildFlatTree(10));
    expect(queryRows()).toHaveLength(10);
  });

  it('does not mount all rows when the scrollport has no measured height', () => {
    // jsdom reports offsetHeight 0, which is the same state as a collapsed side
    // panel or a viewport ref that has not attached yet: the virtual range is
    // empty. The old fallback rendered the whole list here.
    render(buildFlatTree(400));

    expect(queryRows()).toHaveLength(0);
    expect(queryTree()?.style.height).toBe(`${400 * ROW_HEIGHT_PX}px`);
  });

  it('mounts a bounded window once the scrollport reports a height', () => {
    const heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => VIEWPORT_HEIGHT_PX,
    });

    try {
      const viewportRef = createRef<HTMLDivElement>();
      render(buildFlatTree(400), viewportRef);

      const rowCount = queryRows().length;
      expect(rowCount).toBeGreaterThan(0);
      // viewport / rowHeight + 2 * overscan, with slack for boundary rounding.
      expect(rowCount).toBeLessThan(Math.ceil(VIEWPORT_HEIGHT_PX / ROW_HEIGHT_PX) + 2 * 12 + 4);
      expect(queryTree()?.style.height).toBe(`${400 * ROW_HEIGHT_PX}px`);
    } finally {
      if (heightDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDescriptor);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
      }
    }
  });
});
