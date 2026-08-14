import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { LIMITS } from '../../../core/models/limits';
import { Icon } from '../../../shared/ui/icon/icon';

/**
 * Edits a `string[]` — bullet points, skill keywords, tech tags.
 *
 * Rows are addressed by index, so `@for` tracks by index deliberately: the
 * values are plain strings with no stable identity, and two identical bullets
 * must remain separately editable.
 */
@Component({
  selector: 'vn-string-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    <div class="rows">
      @for (value of values(); track $index) {
        <div class="row">
          @if (multiline()) {
            <textarea
              class="vn-textarea"
              rows="2"
              [attr.maxlength]="maxLength()"
              [ngModel]="value"
              (ngModelChange)="change($index, $event)"
              [placeholder]="placeholder()"
            ></textarea>
          } @else {
            <input
              class="vn-input"
              type="text"
              [attr.maxlength]="maxLength()"
              [ngModel]="value"
              (ngModelChange)="change($index, $event)"
              [placeholder]="placeholder()"
            />
          }
          @if (rewritable()) {
            <button
              class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost rewrite"
              type="button"
              [class.is-active]="activeIndex() === $index"
              [disabled]="busy() || !value.trim()"
              [attr.aria-label]="'Rewrite this ' + itemNoun() + ' with AI'"
              [title]="value.trim() ? 'Rewrite with AI' : 'Write something first'"
              (click)="rewrite.emit($index)"
            >
              <vn-icon name="sparkle" [size]="15" />
            </button>
          }
          <button
            class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost"
            type="button"
            [attr.aria-label]="'Remove ' + itemNoun()"
            (click)="removeAt($index)"
          >
            <vn-icon name="x" [size]="15" />
          </button>
        </div>
      }
    </div>

    <button
      class="vn-btn vn-btn--sm vn-btn--ghost add"
      type="button"
      [disabled]="values().length >= maxItems()"
      (click)="add()"
    >
      <vn-icon name="plus" [size]="14" />
      Add {{ itemNoun() }}
    </button>
  `,
  styles: `
    .rows { display: grid; gap: 6px; }
    .row { display: flex; align-items: flex-start; gap: 4px; }
    .row > :first-child { flex: 1; min-width: 0; }
    .row .vn-btn { margin-top: 3px; color: var(--vn-text-subtle); }
    .add { margin-top: 6px; padding-left: 4px; }

    /* The ✨ stays quiet until the row is worth acting on — an always-lit
       button on every bullet turns the form into a wall of invitations. */
    .rewrite { opacity: 0.55; transition: opacity 0.15s var(--vn-ease), color 0.15s; }
    .row:hover .rewrite,
    .rewrite:focus-visible,
    .rewrite.is-active { opacity: 1; }
    .rewrite:hover:not(:disabled),
    .rewrite.is-active { color: var(--vn-accent-text); }
    .rewrite:disabled { opacity: 0.3; }

    @media (hover: none) {
      .rewrite { opacity: 1; }
    }
  `,
})
export class StringList {
  readonly values = input.required<string[]>();
  readonly itemNoun = input('item');
  readonly placeholder = input('');
  readonly multiline = input(false);

  /** Character cap per row, and row cap for the list. Both mirror the API's
   *  limits (see core/models/limits.ts): the editor must not be able to compose
   *  a document the server will then refuse to save or render. */
  readonly maxLength = input<number>(LIMITS.prose);
  readonly maxItems = input<number>(LIMITS.maxBullets);

  /** Adds a per-row ✨ action. Off by default, so skill and tech lists — where
   *  a one-word value has nothing to rewrite — are unchanged. */
  readonly rewritable = input(false);
  /** Row whose suggestion panel is open, so its ✨ can stay lit while the panel
   *  — rendered by the parent, just below this list — is being read. */
  readonly activeIndex = input<number | null>(null);
  /** Disables the action while any AI request is running. */
  readonly busy = input(false);

  readonly valuesChange = output<string[]>();
  readonly rewrite = output<number>();

  protected change(index: number, value: string): void {
    const next = [...this.values()];
    next[index] = value;
    this.valuesChange.emit(next);
  }

  protected removeAt(index: number): void {
    this.valuesChange.emit(this.values().filter((_, i) => i !== index));
  }

  protected add(): void {
    if (this.values().length >= this.maxItems()) return;
    this.valuesChange.emit([...this.values(), '']);
  }
}
