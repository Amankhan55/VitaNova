import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface DateRangeValue {
  start: string;
  end: string;
  current: boolean;
}

/**
 * Start / end dates with an "I currently…" switch.
 *
 * Dates are free text rather than date pickers on purpose: resumes legitimately
 * carry "2019", "Mar 2019", "03/2019" and "Spring 2019", and forcing a real date
 * would throw that nuance away. Templates render whatever is typed.
 */
@Component({
  selector: 'vn-date-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="pair">
      <label class="vn-field">
        <span class="vn-label">Start</span>
        <input
          class="vn-input"
          type="text"
          [ngModel]="value().start"
          (ngModelChange)="emit({ start: $event })"
          placeholder="2022"
        />
      </label>

      <label class="vn-field">
        <span class="vn-label">End</span>
        <input
          class="vn-input"
          type="text"
          [ngModel]="value().end"
          (ngModelChange)="emit({ end: $event })"
          [disabled]="value().current"
          [placeholder]="value().current ? 'Present' : '2024'"
        />
      </label>
    </div>

    <label class="current">
      <input
        type="checkbox"
        [ngModel]="value().current"
        (ngModelChange)="emit({ current: $event })"
      />
      <span>{{ currentLabel() }}</span>
    </label>
  `,
  styles: `
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .current {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 12px;
      font-size: 13.5px;
      color: var(--vn-text-muted);
      cursor: pointer;
    }
    .current input { accent-color: var(--vn-accent); }
  `,
})
export class DateRange {
  readonly value = input.required<DateRangeValue>();
  readonly currentLabel = input('I currently work here');

  readonly valueChange = output<DateRangeValue>();

  protected emit(patch: Partial<DateRangeValue>): void {
    const next = { ...this.value(), ...patch };
    // Clearing the end date is implied by "current"; keeping a stale value would
    // resurface it the moment the box is unticked.
    if (patch.current === true) next.end = '';
    this.valueChange.emit(next);
  }
}
