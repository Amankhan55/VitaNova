import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';

import { ThemeMode, ThemeService } from '../../../core/theme/theme.service';
import { Icon } from '../icon/icon';
import { IconName } from '../icon/icons';

interface ModeOption {
  id: ThemeMode;
  icon: IconName;
  label: string;
}

const OPTIONS: ModeOption[] = [
  { id: 'light', icon: 'sun', label: 'Light' },
  { id: 'dark', icon: 'moon', label: 'Dark' },
  { id: 'system', icon: 'monitor', label: 'Match system' },
];

/**
 * Light / dark / system switch.
 *
 * `compact` renders a single button that flips between light and dark — the
 * right size for a crowded toolbar. The default renders all three as a
 * segmented control, so "follow the system" stays reachable.
 */
@Component({
  selector: 'vn-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (compact()) {
      <button
        type="button"
        class="single"
        [attr.aria-label]="'Switch to ' + (theme.isDark() ? 'light' : 'dark') + ' theme'"
        [title]="'Switch to ' + (theme.isDark() ? 'light' : 'dark') + ' theme'"
        (click)="theme.toggle()"
      >
        <vn-icon [name]="theme.isDark() ? 'sun' : 'moon'" [size]="17" />
      </button>
    } @else {
      <div class="segmented" role="group" aria-label="Colour theme">
        @for (option of options; track option.id) {
          <button
            type="button"
            [class.is-active]="theme.mode() === option.id"
            [attr.aria-pressed]="theme.mode() === option.id"
            [attr.aria-label]="option.label"
            [title]="option.label"
            (click)="theme.set(option.id)"
          >
            <vn-icon [name]="option.icon" [size]="15" />
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: inline-flex; flex: none; }

    .single {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      color: var(--vn-text-muted);
      background: transparent;
      border: 1px solid transparent;
      border-radius: var(--vn-radius-xs);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .single:hover {
      color: var(--vn-text);
      background: var(--vn-hover);
      border-color: var(--vn-border);
    }

    .segmented {
      display: inline-flex;
      padding: 3px;
      gap: 2px;
      background: var(--vn-surface-2);
      border: 1px solid var(--vn-border);
      border-radius: 999px;
    }

    .segmented button {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      color: var(--vn-text-subtle);
      background: transparent;
      border: 0;
      border-radius: 50%;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .segmented button:hover { color: var(--vn-text); }
    .segmented button.is-active {
      color: var(--vn-text);
      background: var(--vn-surface);
      box-shadow: var(--vn-shadow-sm);
    }
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly options = OPTIONS;

  /** Set on toolbars where a three-way control would not fit. */
  readonly compact = input(false);
}
