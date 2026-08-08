import { Injectable, computed, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'vitanova.theme';

/** Kept in step with the pre-paint script in `index.html`. */
const META_THEME_COLOUR: Record<'light' | 'dark', string> = {
  light: '#f4f7fa',
  dark: '#070b13',
};

/**
 * Owns the light/dark theme.
 *
 * The chosen mode is written to `data-theme` on <html>, which is where every
 * token in `styles.scss` is switched. `index.html` applies the same attribute
 * from localStorage before Angular boots, so a dark-theme user never sees a
 * white flash on load — this service only has to keep it accurate afterwards.
 *
 * `system` is a real third state rather than a synonym for the current OS
 * value: it keeps following the OS if the user changes it later.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly query = window.matchMedia('(prefers-color-scheme: dark)');

  private readonly _mode = signal<ThemeMode>(readStoredMode());
  private readonly _systemDark = signal(this.query.matches);

  readonly mode = this._mode.asReadonly();

  /** What is actually on screen — `system` resolved against the OS setting. */
  readonly resolved = computed<'light' | 'dark'>(() => {
    const mode = this._mode();
    if (mode === 'system') return this._systemDark() ? 'dark' : 'light';
    return mode;
  });

  readonly isDark = computed(() => this.resolved() === 'dark');

  constructor() {
    this.query.addEventListener('change', (event) => {
      this._systemDark.set(event.matches);
      // Only `system` follows the OS; an explicit choice must stay put.
      if (this._mode() === 'system') this.apply(true);
    });
    // Reconcile once at startup: the pre-paint script cannot resolve `system`
    // the same way twice if the OS changed between visits.
    this.apply(false);
  }

  set(mode: ThemeMode): void {
    if (mode === this._mode()) return;
    this._mode.set(mode);
    if (mode === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
    this.apply(true);
  }

  /** Flips between light and dark, resolving `system` to its opposite first. */
  toggle(): void {
    this.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private apply(animate: boolean): void {
    const root = document.documentElement;
    const resolved = this.resolved();

    if (animate) {
      // The attribute enables one short global colour transition (see
      // styles.scss); leaving it on would tax every hover and scroll.
      root.setAttribute('data-theme-anim', '');
      window.setTimeout(() => root.removeAttribute('data-theme-anim'), 240);
    }

    root.setAttribute('data-theme', resolved);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', META_THEME_COLOUR[resolved]);
  }
}

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}
