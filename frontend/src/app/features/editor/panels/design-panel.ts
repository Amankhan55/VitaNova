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
    .group { margin-bottom: 18px; }

    .templates { display: grid; gap: 6px; margin-top: 6px; }

    .template {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 11px;
      font: inherit;
      font-size: 14px;
      text-align: left;
      color: var(--vn-text);
      background: var(--vn-surface);
      border: 1px solid var(--vn-border);
      border-radius: var(--vn-radius-sm);
      cursor: pointer;
    }
    .template:hover { border-color: var(--vn-border-strong); background: var(--vn-surface-2); }
    .template.is-active { border-color: var(--vn-accent); background: var(--vn-accent-soft); color: var(--vn-accent-strong); }

    .swatch { width: 15px; height: 15px; border-radius: 4px; flex: none; }
    .template-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .template-name { font-weight: 600; }
    .template-note { font-size: 11.5px; color: var(--vn-text-muted); }

    .swatches { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 6px; }

    .dot {
      width: 26px;
      height: 26px;
      padding: 0;
      border: 2px solid transparent;
      border-radius: 50%;
      box-shadow: inset 0 0 0 1px rgb(15 23 42 / 12%);
      cursor: pointer;
    }
    .dot.is-active { border-color: var(--vn-text); }
    .dot--custom {
      display: grid;
      place-items: center;
      overflow: hidden;
      background: conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #8b5cf6, #ef4444);
    }
    .dot--custom input { opacity: 0; width: 100%; height: 100%; cursor: pointer; }

    .segmented {
      display: flex;
      margin-top: 6px;
      border: 1px solid var(--vn-border-strong);
      border-radius: var(--vn-radius-sm);
      overflow: hidden;
    }
    .segmented button {
      flex: 1;
      padding: 6px 8px;
      font-size: 13px;
      font-weight: 600;
      text-transform: capitalize;
      color: var(--vn-text-muted);
      background: var(--vn-surface);
      border: 0;
      border-left: 1px solid var(--vn-border);
      cursor: pointer;
    }
    .segmented button:first-child { border-left: 0; }
    .segmented button.is-active { color: #fff; background: var(--vn-accent); }

    .slider { width: 100%; margin-top: 8px; accent-color: var(--vn-accent); }
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
