import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
              [ngModel]="value"
              (ngModelChange)="change($index, $event)"
              [placeholder]="placeholder()"
            ></textarea>
          } @else {
            <input
              class="vn-input"
              type="text"
              [ngModel]="value"
              (ngModelChange)="change($index, $event)"
              [placeholder]="placeholder()"
            />
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

    <button class="vn-btn vn-btn--sm vn-btn--ghost add" type="button" (click)="add()">
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
  `,
})
export class StringList {
  readonly values = input.required<string[]>();
  readonly itemNoun = input('item');
  readonly placeholder = input('');
  readonly multiline = input(false);

  readonly valuesChange = output<string[]>();

  protected change(index: number, value: string): void {
    const next = [...this.values()];
    next[index] = value;
    this.valuesChange.emit(next);
  }

  protected removeAt(index: number): void {
    this.valuesChange.emit(this.values().filter((_, i) => i !== index));
  }

  protected add(): void {
    this.valuesChange.emit([...this.values(), '']);
  }
}
