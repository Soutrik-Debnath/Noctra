/**
 * The app's own prompt and confirm, replacing `window.prompt` / `window.confirm`.
 *
 * The native versions are rendered by the webview, not by this app: an OS box headed
 * "localhost:1420 says", which cannot be themed, cannot be made to match the type scale, and advertises
 * a web origin from an app that never leaves the machine. Replacing them is the only way to make the
 * interaction look like it belongs here.
 *
 * Promise-based rather than a return value, because the callers are event handlers: `await dialog.ask()`
 * reads the same as the `prompt()` it replaces, and the resolution is explicit (`null` on cancel) so
 * "user cancelled" cannot be confused with "user typed nothing".
 *
 * One request at a time. A queue of modals would be worse than the dialogs it replaces — the second one
 * would arrive over a scrim the user has already stopped reading.
 */

export type DialogRequest = {
  title: string;
  /** Second line. Used for the consequence of a destructive action. */
  detail?: string;
  /** When set, the dialog collects text under this label. */
  inputLabel?: string;
  value?: string;
  /** Shows a numeric keypad on touch and validates digits only. */
  numeric?: boolean;
  placeholder?: string;
  /** A blank answer is meaningful — "name this moment", or leave it unlabelled. */
  allowEmpty?: boolean;
  confirmText: string;
  /** A destructive yes. Paints the primary action with the danger treatment. */
  danger?: boolean;
  resolve: (value: string | null) => void;
};

class DialogStore {
  request = $state<DialogRequest | null>(null);

  /** Ask for a line of text. Resolves `null` if the user backs out. */
  ask(
    title: string,
    opts: {
      detail?: string;
      inputLabel?: string;
      value?: string;
      numeric?: boolean;
      placeholder?: string;
      allowEmpty?: boolean;
      confirmText?: string;
    } = {},
  ): Promise<string | null> {
    // A second call while one is open resolves the first as cancelled rather than stacking scrims.
    this.request?.resolve(null);
    return new Promise<string | null>((resolve) => {
      this.request = {
        title,
        detail: opts.detail,
        inputLabel: opts.inputLabel ?? "Value",
        value: opts.value ?? "",
        numeric: opts.numeric,
        placeholder: opts.placeholder,
        allowEmpty: opts.allowEmpty,
        confirmText: opts.confirmText ?? "OK",
        resolve,
      };
    });
  }

  /** Yes/no. Resolves false on cancel, Escape or a click outside. */
  confirm(title: string, detail?: string, confirmText = "Delete"): Promise<boolean> {
    this.request?.resolve(null);
    return new Promise<boolean>((resolve) => {
      this.request = {
        title,
        detail,
        confirmText,
        danger: true,
        resolve: (v) => resolve(v !== null),
      };
    });
  }

  get open(): boolean {
    return this.request !== null;
  }

  submit(value: string): void {
    const r = this.request;
    if (!r) return;
    this.request = null;
    r.resolve(value);
  }

  cancel(): void {
    const r = this.request;
    if (!r) return;
    this.request = null;
    r.resolve(null);
  }
}

export const dialog = new DialogStore();
