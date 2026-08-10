import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** `danger` paints the confirm button as destructive. */
  tone?: 'default' | 'danger';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (answer: boolean) => void;
}

/**
 * Asks the user to confirm something, in a dialog that belongs to the app
 * rather than to the browser.
 *
 * `window.confirm` blocks the whole event loop, cannot be styled, ignores the
 * light/dark theme, and on some platforms shows the page's origin next to the
 * question — none of which is acceptable in an app that otherwise controls
 * every pixel.
 *
 * The service holds only the request; `<vn-confirm-dialog>` renders it, and is
 * mounted once in the app shell so any page can call this.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _pending = signal<PendingConfirm | null>(null);

  readonly pending = this._pending.asReadonly();

  /** Resolves true if the user confirms, false for cancel, Escape or backdrop. */
  ask(options: ConfirmOptions): Promise<boolean> {
    // A second question while one is open would silently strand the first
    // caller's promise, so answer it as a cancel before taking over.
    this.answer(false);
    return new Promise<boolean>((resolve) => {
      this._pending.set({ ...options, resolve });
    });
  }

  /** Settles the open question. A no-op when nothing is pending. */
  answer(confirmed: boolean): void {
    const pending = this._pending();
    if (!pending) return;
    this._pending.set(null);
    pending.resolve(confirmed);
  }
}
