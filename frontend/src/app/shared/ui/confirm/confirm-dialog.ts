import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';

import { ConfirmService } from './confirm.service';
import { Icon } from '../icon/icon';

/**
 * Renders whatever `ConfirmService` is currently asking.
 *
 * Built on the native `<dialog>` element rather than a bespoke overlay: calling
 * `showModal()` puts it in the browser's top layer (so nothing can z-index
 * above it), traps focus, makes the rest of the page inert, closes on Escape,
 * and returns focus to whatever was focused before — all behaviour that a
 * hand-rolled modal has to reimplement and usually gets subtly wrong.
 *
 * Mounted once, in the app shell.
 */
@Component({
  selector: 'vn-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <dialog
      #dialog
      class="sheet"
      [class.is-danger]="tone() === 'danger'"
      aria-labelledby="vn-confirm-title"
      aria-describedby="vn-confirm-message"
      (close)="onNativeClose()"
      (click)="onBackdropClick($event)"
    >
      @if (confirm.pending(); as request) {
        <!-- Inside the @if so the content is rebuilt per question, which keeps
             the previous question from flashing during the closing frame. -->
        <div class="body">
          <span class="glyph">
            <vn-icon [name]="tone() === 'danger' ? 'trash' : 'sparkle'" [size]="19" />
          </span>
          <div class="copy">
            <h2 id="vn-confirm-title">{{ request.title }}</h2>
            <p id="vn-confirm-message">{{ request.message }}</p>
          </div>
        </div>

        <footer class="actions">
          <button #cancelButton class="vn-btn" type="button" (click)="respond(false)">
            {{ request.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            class="vn-btn"
            [class.vn-btn--primary]="tone() !== 'danger'"
            [class.confirm-danger]="tone() === 'danger'"
            type="button"
            (click)="respond(true)"
          >
            {{ request.confirmLabel ?? 'Confirm' }}
          </button>
        </footer>
      }
    </dialog>
  `,
  styles: `
    .sheet {
      width: min(452px, calc(100vw - 32px));
      padding: 0;
      color: var(--vn-text);
      background: var(--vn-surface);
      /* Enclosed by the strong rule: a question is the one moment the interface
         should feel bounded rather than continuous with the page. */
      border: 1px solid var(--vn-border-strong);
      border-radius: var(--vn-radius);
      box-shadow: var(--vn-shadow-lg);
    }

    /* The element stays in the DOM while closed; :not([open]) keeps it hidden
       without needing *ngIf around the dialog itself. */
    .sheet:not([open]) { display: none; }

    /* Warm, not blue — the scrim is the same ink everything else is printed in. */
    .sheet::backdrop {
      background: rgb(20 18 14 / 58%);
      backdrop-filter: blur(3px);
    }

    .sheet[open] { animation: sheet-in 0.18s var(--vn-ease); }
    .sheet[open]::backdrop { animation: backdrop-in 0.18s var(--vn-ease); }

    @keyframes sheet-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }
    @keyframes backdrop-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .body {
      display: flex;
      gap: 15px;
      padding: 24px 24px 18px;
    }

    .glyph {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      flex: none;
      color: var(--vn-accent-text);
      background: var(--vn-accent-soft);
      border: 1px solid var(--vn-accent-line);
      border-radius: var(--vn-radius-xs);
    }
    .is-danger .glyph {
      color: var(--vn-danger-text);
      background: var(--vn-danger-soft);
      border-color: var(--vn-danger-line);
    }

    .copy { min-width: 0; }
    .copy h2 {
      margin-bottom: 8px;
      font-size: 21px;
      letter-spacing: -0.02em;
    }
    .copy p {
      font-size: 14.5px;
      line-height: 1.6;
      color: var(--vn-text-muted);
      overflow-wrap: anywhere; /* a long resume title must not widen the sheet */
    }

    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 9px;
      padding: 15px 20px;
      background: var(--vn-surface-2);
      border-top: 1px solid var(--vn-border);
      border-radius: 0 0 var(--vn-radius) var(--vn-radius);
    }
    .actions .vn-btn { padding: 9px 18px; }

    /* --vn-on-danger, not #fff: the dark theme's danger red is a light one, and
       white on it fails contrast. */
    .confirm-danger {
      color: var(--vn-on-danger);
      background: var(--vn-danger);
      border-color: var(--vn-danger);
    }
    .confirm-danger:hover:not(:disabled) {
      color: var(--vn-on-danger);
      background: var(--vn-danger-text);
      border-color: var(--vn-danger-text);
    }

    @media (prefers-reduced-motion: reduce) {
      .sheet[open],
      .sheet[open]::backdrop { animation: none; }
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancelButton');

  protected readonly tone = () => this.confirm.pending()?.tone ?? 'default';

  constructor() {
    effect(() => {
      const request = this.confirm.pending();
      const element = this.dialog().nativeElement;

      if (request && !element.open) {
        element.showModal();
        // The browser focuses the first focusable child; for a destructive
        // question the safe default is Cancel, not the button that deletes.
        queueMicrotask(() => this.cancelButton()?.nativeElement.focus());
      } else if (!request && element.open) {
        element.close();
      }
    });
  }

  protected respond(confirmed: boolean): void {
    this.confirm.answer(confirmed);
  }

  /** Fires for Escape too, which is exactly the cancel path we want. */
  protected onNativeClose(): void {
    this.confirm.answer(false);
  }

  /**
   * A click on the backdrop reports the <dialog> itself as the target, because
   * the backdrop is a pseudo-element with no node of its own. Clicks on the
   * card hit its children instead, so this dismisses only outside clicks.
   */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.confirm.answer(false);
    }
  }
}
