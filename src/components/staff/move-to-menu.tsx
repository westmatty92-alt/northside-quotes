'use client';

// MoveToMenu (component map): "Move to" on every row and card, always visible, never hover-only. It opens a menu of the
// OTHER three statuses. Enter, Space or a tap opens it; arrow keys, Home and End move through the choices; Enter
// chooses; Escape closes and returns focus to the button; Tab or a tap elsewhere closes it. While that request's status
// is saving the button is paused (`paused`), so one press makes one save.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { staffCopy, statusLabel, statusOrder } from '@/components/staff/copy';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import type { Status } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

interface MoveToMenuProps {
  reference: string;
  current: Status;
  /** A save for this request is running. */
  paused?: boolean;
  onChoose: (status: Status) => void;
  className?: string;
}

export function MoveToMenu({ reference, current, paused = false, onChoose, className }: MoveToMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const choices = statusOrder.filter((status) => status !== current);

  function openMenu(focus: 'first' | 'last' = 'first') {
    setOpen(true);
    // the items exist after this render
    queueMicrotask(() => {
      const list = items.current.filter((item): item is HTMLButtonElement => item !== null);
      (focus === 'first' ? list[0] : list[list.length - 1])?.focus();
    });
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  // a tap or click outside closes it
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenu('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu('last');
    }
  }

  function onMenuKey(event: KeyboardEvent<HTMLUListElement>) {
    const list = items.current.filter((item): item is HTMLButtonElement => item !== null);
    const index = list.findIndex((item) => item === document.activeElement);
    const go = (target: HTMLButtonElement | undefined) => {
      event.preventDefault();
      target?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        go(list[(index + 1) % list.length]);
        break;
      case 'ArrowUp':
        go(list[(index - 1 + list.length) % list.length]);
        break;
      case 'Home':
        go(list[0]);
        break;
      case 'End':
        go(list[list.length - 1]);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <Button
        ref={button}
        block
        paused={paused}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={staffCopy.list.moveLabel(reference)}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onButtonKey}
      >
        {staffCopy.list.moveTo}
        <Icon name="down" className="size-4" />
      </Button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={staffCopy.list.moveMenu(reference)}
          onKeyDown={onMenuKey}
          className="absolute top-full right-0 left-0 z-10 mt-xs grid gap-xs rounded-md border border-border-strong bg-surface p-xs"
        >
          {choices.map((status, index) => (
            <li key={status} role="none">
              <button
                ref={(node) => {
                  items.current[index] = node;
                }}
                type="button"
                role="menuitem"
                onClick={() => {
                  close(true);
                  onChoose(status);
                }}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center rounded-sm px-sm text-left text-text hover:bg-surface-raised',
                  type.label,
                  'focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus',
                )}
              >
                {statusLabel[status]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
