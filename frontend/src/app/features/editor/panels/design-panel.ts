import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TemplateMeta } from '../../../core/models/auth.model';
import { Theme } from '../../../core/models/resume.model';
import { Icon } from '../../../shared/ui/icon/icon';
import { ResumeStore } from '../resume-store';

const DENSITIES: Theme['density'][] = ['compact', 'normal', 'relaxed'];

@Component({
  selector: 'vn-design-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Icon],
  template: `
    <div class="group">
      <span class="vn-label">Design</span>
      <div class="templates">
        @for (meta of templates(); track meta.id) {
          <button
            class="template"
            type="button"
            [class.is-active]="meta.id === current()?.template_id"
            (click)="chooseTemplate(meta)"
          >
            <span class="swatch" [style.background]="meta.accent"></span>
            <span class="template-text">
              <span class="template-name">{{ meta.name }}</span>
              @if (meta.ats_safe) { <span class="template-note">ATS safe</span> }
            </span>
            @if (meta.id === current()?.template_id) {
              <vn-icon name="check" [size]="15" />
            }
          </button>
        }
      </div>
    </div>

    <div class="group">
      <span class="vn-label">Accent colour</span>
      <div class="swatches">
        @for (colour of accentPresets(); track colour) {
          <button
            type="button"
            class="dot"
            [class.is-active]="colour.toLowerCase() === theme()?.accent?.toLowerCase()"
            [style.background]="colour"
            [attr.aria-label]="'Use accent ' + colour"
            (click)="patchTheme({ accent: colour })"
          ></button>
        }
        <label class="dot dot--custom" title="Pick any colour">
          <input
            type="color"
            [ngModel]="theme()?.accent ?? '#0d9488'"
            (ngModelChange)="patchTheme({ accent: $event })"
          />
        </label>
      </div>
    </div>

    <div class="group">
      <span class="vn-label">Page size</span>
      <div class="segmented">
        @for (size of pageSizes; track size) {
          <button
            type="button"
            [class.is-active]="theme()?.page_size === size"
            (click)="patchTheme({ page_size: size })"
          >
            {{ size }}
          </button>
        }
      </div>
    </div>

    <div class="group">
      <span class="vn-label">Spacing</span>
      <div class="segmented">
        @for (density of densities; track density) {
          <button
            type="button"
            [class.is-active]="theme()?.density === density"
            (click)="patchTheme({ density })"
          >
            {{ density }}
          </button>
        }
      </div>
    </div>

    <div class="group">
      <span class="vn-label">Text size — {{ percent() }}</span>
      <input
        class="slider"
        type="range"
        min="0.8"
        max="1.25"
        step="0.01"
        [ngModel]="theme()?.font_scale ?? 1"
        (ngModelChange)="patchTheme({ font_scale: +$event })"
      />
    </div>
  `,
  styles: `
    .group { margin-bottom: 26px; }

    /* The designs read as a stacked list of choices with rules between them,
       and the chosen one is filled with ink — the same "this one" language the
       masthead and the filters use. */
    .templates {
      display: grid;
      gap: 0;
      margin-top: 8px;
      border: 1px solid var(--vn-border-strong);
      border-radius: var(--vn-radius-xs);
      overflow: hidden;
    }

    .template {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 10px 12px;
      font: inherit;
      font-size: 14px;
      text-align: left;
      color: var(--vn-text);
      background: var(--vn-surface);
      border: 0;
      border-top: 1px solid var(--vn-border);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .template:first-child { border-top: 0; }
    .template:hover:not(.is-active) { background: var(--vn-surface-2); }
    .template.is-active {
      color: var(--vn-on-ink);
      background: var(--vn-ink);
    }
    .template.is-active .template-note { color: inherit; opacity: 0.72; }

    /* Square, and ringed in the paper's own edge colour: these swatches belong
       to the printed page, not to the interface. */
    .swatch {
      width: 14px;
      height: 14px;
      border-radius: 1px;
      flex: none;
      box-shadow: inset 0 0 0 1px var(--vn-paper-edge);
    }
    .template-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .template-name { font-weight: 600; }
    .template-note {
      font-family: var(--vn-font-mono);
      font-size: 9.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--vn-text-muted);
    }

    .swatches { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 8px; }

    .dot {
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      border-radius: var(--vn-radius-xs);
      box-shadow: inset 0 0 0 1px var(--vn-paper-edge);
      cursor: pointer;
      transition: box-shadow 0.12s var(--vn-ease);
    }
    .dot:hover { box-shadow: inset 0 0 0 1px var(--vn-paper-edge), 0 0 0 2px var(--vn-border-strong); }
    .dot.is-active {
      box-shadow: inset 0 0 0 1px var(--vn-paper-edge), 0 0 0 2px var(--vn-text);
    }
    .dot--custom {
      display: grid;
      place-items: center;
      overflow: hidden;
      background: conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444);
    }
    .dot--custom input { opacity: 0; width: 100%; height: 100%; cursor: pointer; }

    .segmented {
      display: flex;
      margin-top: 8px;
      border: 1px solid var(--vn-border-strong);
      border-radius: var(--vn-radius-xs);
      overflow: hidden;
    }
    .segmented button {
      flex: 1;
      padding: 8px;
      font-family: var(--vn-font-mono);
      font-size: 10.5px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--vn-text-muted);
      background: var(--vn-surface);
      border: 0;
      border-left: 1px solid var(--vn-border);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .segmented button:first-child { border-left: 0; }
    .segmented button:hover:not(.is-active) { background: var(--vn-surface-2); color: var(--vn-text); }
    .segmented button.is-active { color: var(--vn-on-ink); background: var(--vn-ink); }

    .slider { width: 100%; margin-top: 12px; accent-color: var(--vn-accent); }
  `,
})
export class DesignPanel {
  private readonly store = inject(ResumeStore);

  readonly templates = input.required<TemplateMeta[]>();

  protected readonly pageSizes: Theme['page_size'][] = ['A4', 'Letter'];
  protected readonly densities = DENSITIES;

  protected readonly current = this.store.resume;
  protected readonly theme = computed(() => this.current()?.theme ?? null);

  protected readonly percent = computed(
    () => `${Math.round((this.theme()?.font_scale ?? 1) * 100)}%`,
  );

  protected readonly accentPresets = computed(() => {
    const active = this.templates().find((meta) => meta.id === this.current()?.template_id);
    return active?.accent_presets?.length ? active.accent_presets : ['#0d9488', '#2563eb', '#b8912f'];
  });

  /**
   * Switching design also adopts that design's own accent, but only when the
   * current accent is still one the previous design suggested — a colour the
   * user deliberately picked survives the switch.
   */
  protected chooseTemplate(meta: TemplateMeta): void {
    const resume = this.current();
    if (!resume || resume.template_id === meta.id) return;

    const usingPreset = this.accentPresets().some(
      (colour) => colour.toLowerCase() === resume.theme.accent.toLowerCase(),
    );
    this.store.patch({
      template_id: meta.id,
      theme: { ...resume.theme, accent: usingPreset ? meta.accent : resume.theme.accent },
    });
  }

  protected patchTheme(changes: Partial<Theme>): void {
    this.store.update((resume) => ({ ...resume, theme: { ...resume.theme, ...changes } }));
  }
}
