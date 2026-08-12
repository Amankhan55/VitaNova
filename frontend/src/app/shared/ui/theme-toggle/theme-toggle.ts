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
      border-color: var(--vn-border-strong);
    }

    /* Three cells divided by rules rather than three pills in a track — the
       same device the masthead nav uses to say "one of these is current". */
    .segmented {
      display: inline-flex;
      border: 1px solid var(--vn-border-strong);
      border-radius: var(--vn-radius-xs);
      overflow: hidden;
    }

    .segmented button {
      display: grid;
      place-items: center;
      width: 32px;
      height: 30px;
      color: var(--vn-text-subtle);
      background: var(--vn-surface);
      border: 0;
      border-left: 1px solid var(--vn-border);
      border-radius: 0;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .segmented button:first-child { border-left: 0; }
    .segmented button:hover { color: var(--vn-text); background: var(--vn-surface-2); }
    .segmented button.is-active {
      color: var(--vn-on-ink);
      background: var(--vn-ink);
    }
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly options = OPTIONS;

  /** Set on toolbars where a three-way control would not fit. */
  readonly compact = input(false);
}
