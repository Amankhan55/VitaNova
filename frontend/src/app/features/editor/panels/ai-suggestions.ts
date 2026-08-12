import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Icon } from '../../../shared/ui/icon/icon';
import { AiStore } from '../ai-store';

/**
 * What the AI came back with, shown inline under the field it belongs to.
 *
 * Inline rather than in a dialog on purpose. Improving a sentence is a small
 * act, and a modal makes a small act feel like a decision — it covers the very
 * text the user is trying to compare against. This sits in the flow, directly
 * beneath the field, and the original stays visible above it.
 *
 * The user's own content is never touched until Accept. Everything offered here
 * is a candidate: selectable, editable, and discardable.
 */
@Component({
  selector: 'vn-ai-suggestions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    @if (store.panel(); as panel) {
      <div class="ai-panel" role="group" [attr.aria-label]="panel.title">
        <header class="ai-head">
          <vn-icon name="sparkle" [size]="14" />
          <span class="ai-title">{{ panel.title }}</span>
          <button
            class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost"
            type="button"
            aria-label="Close suggestions"
            (click)="store.closePanel()"
          >
            <vn-icon name="x" [size]="14" />
          </button>
        </header>

        @switch (panel.state) {
          @case ('loading') {
            <div class="ai-loading" aria-live="polite">
              <span class="vn-skeleton line"></span>
              <span class="vn-skeleton line short"></span>
              <span class="ai-loading-note">
                <vn-icon name="refresh" [size]="13" />
                Writing…
              </span>
            </div>
          }

          @case ('error') {
            <div class="ai-error" role="alert">
              <p>{{ panel.error }}</p>
              <div class="ai-actions">
                <button class="vn-btn vn-btn--sm" type="button" (click)="store.regenerate()">
                  <vn-icon name="refresh" [size]="14" />
                  Try again
                </button>
                <button class="vn-btn vn-btn--sm vn-btn--ghost" type="button" (click)="store.closePanel()">
                  Cancel
                </button>
              </div>
            </div>
          }

          @case ('ready') {
            @if (panel.mode === 'select') {
              <ul class="ai-options">
                @for (option of panel.options; track $index) {
                  <li>
                    <button
                      type="button"
                      class="ai-option"
                      [class.is-chosen]="chosen() === $index"
                      [attr.aria-pressed]="chosen() === $index"
                      (click)="choose($index, option.text)"
                    >
                      @if (option.style) {
                        <span class="vn-chip ai-style">{{ option.style }}</span>
                      }
                      <span class="ai-option-text">{{ option.text }}</span>
                    </button>
                  </li>
                }
              </ul>

              @if (chosen() !== null) {
                <label class="vn-field ai-edit">
                  <span class="vn-label">Your version</span>
                  <textarea
                    class="vn-textarea"
                    rows="4"
                    [ngModel]="draft()"
                    (ngModelChange)="draft.set($event)"
                  ></textarea>
                  <span class="vn-hint">Edit freely before accepting.</span>
                </label>
              }
            } @else {
              <p class="ai-note">These replace the entry's highlights. Edit or remove any first.</p>
              <div class="ai-bullets">
                @for (line of bullets(); track $index) {
                  <div class="ai-bullet">
                    <textarea
                      class="vn-textarea"
                      rows="2"
                      [ngModel]="line"
                      (ngModelChange)="setBullet($index, $event)"
                    ></textarea>
                    <button
                      class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost"
                      type="button"
                      aria-label="Discard this line"
                      (click)="dropBullet($index)"
                    >
                      <vn-icon name="x" [size]="14" />
                    </button>
                  </div>
                }
              </div>
            }

            @for (note of panel.notes; track note) {
              <p class="ai-withheld">
                <vn-icon name="shield" [size]="13" />
                {{ note }}
              </p>
            }

            <div class="ai-actions">
              <button
                class="vn-btn vn-btn--sm vn-btn--primary"
                type="button"
                [disabled]="!canAccept()"
                (click)="accept()"
              >
                <vn-icon name="check" [size]="14" />
                Accept
              </button>
              <button class="vn-btn vn-btn--sm" type="button" (click)="store.regenerate()">
                <vn-icon name="refresh" [size]="14" />
                Regenerate
              </button>
              <button
                class="vn-btn vn-btn--sm vn-btn--ghost"
                type="button"
                (click)="store.closePanel()"
              >
                Cancel
              </button>
            </div>
          }
        }
      </div>
    }
  `,
  styleUrl: './ai-suggestions.scss',
})
export class AiSuggestions {
  protected readonly store = inject(AiStore);

  /** Index of the selected option in `select` mode; null until one is picked. */
  protected readonly chosen = signal<number | null>(null);
  /** The editable text, seeded from the chosen option. */
  protected readonly draft = signal('');
  /** The editable bullet set in `replace` mode. */
  protected readonly bullets = signal<string[]>([]);

  protected readonly canAccept = computed(() =>
    this.store.panel()?.mode === 'replace'
      ? this.bullets().some((line) => line.trim())
      : this.draft().trim().length > 0,
  );

  constructor() {
    effect(() => {
      const panel = this.store.panel();
      if (!panel || panel.state !== 'ready') {
        this.chosen.set(null);
        this.draft.set('');
        this.bullets.set([]);
        return;
      }
      if (panel.mode === 'replace') {
        this.bullets.set(panel.options.map((option) => option.text));
        return;
      }
      // One suggestion is no choice at all — preselect it so Accept is one
      // click rather than two.
      if (panel.options.length === 1) {
        this.chosen.set(0);
        this.draft.set(panel.options[0].text);
      }
    });
  }

  protected choose(index: number, text: string): void {
    this.chosen.set(index);
    this.draft.set(text);
  }

  protected setBullet(index: number, value: string): void {
    this.bullets.update((current) => current.map((line, i) => (i === index ? value : line)));
  }

  protected dropBullet(index: number): void {
    this.bullets.update((current) => current.filter((_, i) => i !== index));
  }

  protected accept(): void {
    this.store.accept(
      this.store.panel()?.mode === 'replace' ? this.bullets() : [this.draft()],
    );
  }
}
