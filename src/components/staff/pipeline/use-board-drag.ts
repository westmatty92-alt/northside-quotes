'use client';

// Drag a card to another column with a mouse, a pen or a finger (SCR-05 behaviour 1). Pointer events, no library:
//   - a press that moves under 5 px is a click (the reference link opens the request); more than that is a drag;
//   - a mouse can pick a card up anywhere except its buttons; a finger or pen only by the grip, which carries
//     `touch-action: none`, so the page can still be scrolled with a finger anywhere else;
//   - Escape, a pointer cancel, or letting go outside all four columns puts the card back and stores nothing;
//   - letting go over the card's own column also stores nothing;
//   - the drag has no keyboard form: the "Move to" menu is the keyboard path (design-specs SCR-05).
// The drop is only reported (`onDrop`); saving, the revert and the messages are `use-pipeline.ts`.
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoardRow } from '@/components/staff/pipeline/use-pipeline';
import { Cell } from '@/hooks/cell';
import type { Status } from '@/lib/api/generated/model';

/** A press that travels less than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 5;

export interface DragState {
  row: BoardRow;
  from: Status;
  /** The column under the pointer (the card's own included), or null outside all four. */
  over: Status | null;
  x: number;
  y: number;
  /** Where inside the card it was picked up, so the picture follows the pointer from that spot. */
  grabX: number;
  grabY: number;
  width: number;
}

/** The click that ends a drag must not open the card's link. */
function swallowNextClick(): void {
  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

export function useBoardDrag(onDrop: (row: BoardRow, to: Status) => void) {
  const [columns] = useState(() => new Cell(new Map<Status, HTMLElement>()));
  const [release] = useState(() => new Cell<(() => void) | null>(null));
  const [drag, setDrag] = useState<DragState | null>(null);

  // leaving the page mid-drag removes the listeners
  useEffect(
    () => () => {
      release.get()?.();
    },
    [release],
  );

  /** The ref callback of a column's element: the drop targets, looked up by their position on screen. */
  const registerColumn = (status: Status) => (node: HTMLElement | null) => {
    if (node) columns.get().set(status, node);
    else columns.get().delete(status);
  };

  function columnAt(x: number, y: number): Status | null {
    for (const [status, element] of columns.get()) {
      const box = element.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return status;
    }
    return null;
  }

  function onCardPointerDown(event: ReactPointerEvent<HTMLElement>, row: BoardRow): void {
    if (row.saving || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('button, [role="menu"]')) return; // "Move to" and its menu are not a handle
    if (event.pointerType !== 'mouse' && !target.closest('[data-grip]')) return;

    release.get()?.();
    const box = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const from = row.status;
    let active = false;
    let cancelled = false;

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey);
      release.set(null);
      setDrag(null);
    };

    function onMove(move: PointerEvent): void {
      if (move.pointerId !== event.pointerId || cancelled) return;
      if (!active) {
        if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD_PX) return;
        active = true;
        window.getSelection()?.removeAllRanges();
      }
      setDrag({
        row,
        from,
        over: columnAt(move.clientX, move.clientY),
        x: move.clientX,
        y: move.clientY,
        grabX: start.x - box.left,
        grabY: start.y - box.top,
        width: box.width,
      });
    }

    function onUp(up: PointerEvent): void {
      if (up.pointerId !== event.pointerId) return;
      const to = columnAt(up.clientX, up.clientY);
      const dropped = active && !cancelled && up.type === 'pointerup' && to !== null && to !== from;
      if (active) swallowNextClick();
      finish();
      if (dropped && to) onDrop(row, to);
    }

    function onKey(key: KeyboardEvent): void {
      if (key.key !== 'Escape') return;
      // the card goes back; the pointer is still down, so wait for it to be released (and ignore that click)
      cancelled = true;
      setDrag(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKey);
    release.set(finish);
  }

  return { drag, registerColumn, onCardPointerDown };
}
