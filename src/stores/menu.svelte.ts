/**
 * The single open context menu.
 *
 * One store and one mounted `<ContextMenu />` rather than a menu instance per row: a library of
 * 300 virtualised rows would otherwise allocate 300 popovers, and rows are unmounted on scroll,
 * which would take their menu with them mid-interaction.
 */
import type { IconName } from "../components/icons";

export type MenuItem =
  | {
      label: string;
      icon?: IconName;
      /**
       * Return false to keep the menu open, e.g. to show a confirmation step.
       *
       * A promise is allowed because an item that opens a `dialog` is necessarily async. It is treated
       * as "close the menu": the dialog is a modal on top, so leaving the menu underneath it buys
       * nothing, and the old `return false` to stay open while a native prompt blocked the thread is
       * gone with the native prompt.
       */
      onSelect: () => void | boolean | Promise<void>;
      danger?: boolean;
      disabled?: boolean;
      /** Right-aligned hint, e.g. a keyboard shortcut. */
      hint?: string;
    }
  | { separator: true };

class MenuStore {
  items = $state<MenuItem[]>([]);
  x = $state(0);
  y = $state(0);
  open = $state(false);

  /** Anchor at the pointer, clamped to the viewport by the component once it knows its own size. */
  show(event: MouseEvent, items: MenuItem[]): void {
    const trimmed = items.filter((it, i) => {
      // Never open on a leading or doubled separator, and drop a menu with nothing in it.
      if (!("separator" in it)) return true;
      const prev = items[i - 1];
      return prev && !("separator" in prev);
    });
    if (trimmed.length === 0) return;
    this.items = trimmed;
    this.x = event.clientX;
    this.y = event.clientY;
    this.open = true;
  }

  hide(): void {
    this.open = false;
  }

  run(item: MenuItem): void {
    if ("separator" in item) return;
    const keep = item.onSelect();
    if (keep !== false) this.hide();
  }
}

export const menu = new MenuStore();
