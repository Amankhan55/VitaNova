import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { RenderApi, TemplateApi } from '../../core/api/resume.api';
import { downloadBlob } from '../../core/download';
import { TemplateMeta } from '../../core/models/auth.model';
import { Icon } from '../../shared/ui/icon/icon';
import { BasicsPanel } from './panels/basics-panel';
import { DesignPanel } from './panels/design-panel';
import { SectionList } from './panels/section-list';
import { ResumeStore } from './resume-store';

type Tab = 'content' | 'design';

@Component({
  selector: 'vn-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, BasicsPanel, SectionList, DesignPanel],
  providers: [ResumeStore],
  styleUrl: './editor.scss',
  template: `
    <div class="editor">
      <header class="toolbar">
        <a class="vn-btn vn-btn--ghost vn-btn--sm back" routerLink="/dashboard" aria-label="Back to resumes">
          <vn-icon name="arrow-left" [size]="16" />
        </a>

        <input
          class="title-input"
          type="text"
          [ngModel]="store.resume()?.title ?? ''"
          (ngModelChange)="rename($event)"
          aria-label="Resume title"
          placeholder="Untitled resume"
        />

        @if (designName(); as design) {
          <span class="vn-chip design-chip">
            <vn-icon name="palette" [size]="12" />
            {{ design }}
          </span>
        }

        <span class="status" [class]="'status--' + store.status()" aria-live="polite">
          @switch (store.status()) {
            @case ('saving') { <vn-icon name="refresh" [size]="14" /> Saving… }
            @case ('saved') { <vn-icon name="check" [size]="14" /> Saved }
            @case ('error') { <vn-icon name="x" [size]="14" /> Not saved }
            @default { <span class="vn-sr-only">No changes</span> }
          }
        </span>

        <button
          class="vn-btn vn-btn--primary vn-btn--sm"
          type="button"
          [disabled]="exporting() || !store.resume()"
          (click)="exportPdf()"
        >
          <vn-icon name="download" [size]="16" />
          {{ exporting() ? 'Preparing…' : 'Download PDF' }}
        </button>
      </header>

      @if (store.loadError(); as message) {
        <div class="load-error">
          <p>{{ message }}</p>
          <a class="vn-btn" routerLink="/dashboard">Back to your resumes</a>
        </div>
      } @else {
        <div class="split">
          <aside class="panel">
            <div class="tabs" role="tablist">
              @for (item of tabs; track item.id) {
                <button
                  type="button"
                  role="tab"
                  [attr.aria-selected]="tab() === item.id"
                  [class.is-active]="tab() === item.id"
                  (click)="tab.set(item.id)"
                >
                  <vn-icon [name]="item.id === 'content' ? 'file' : 'palette'" [size]="15" />
                  {{ item.label }}
                </button>
              }
            </div>

            <div class="panel-body">
              @if (tab() === 'content') {
                <h2 class="panel-title">Details</h2>
                <vn-basics-panel />
                <h2 class="panel-title spaced">Sections</h2>
                <vn-section-list />
              } @else {
                <vn-design-panel [templates]="templates()" />
              }
            </div>
          </aside>

          <!-- .vn-paper-gutter, never a themed surface: the preview is printed
               matter, so paper and its backdrop look the same in either theme. -->
          <section class="preview vn-paper-gutter" [class.is-stale]="store.previewPending()">
            @if (store.previewHtml(); as doc) {
              <iframe
                class="preview-frame"
                [srcdoc]="doc"
                sandbox=""
                title="Resume preview"
              ></iframe>
            } @else {
              <div class="preview-loading">Rendering your resume…</div>
            }

            @if (store.previewPending()) {
              <span class="preview-badge">
                <vn-icon name="refresh" [size]="13" />
                Updating
              </span>
            }
          </section>
        </div>
      }
    </div>
  `,
})
export class EditorPage {
  protected readonly store = inject(ResumeStore);
  private readonly renderApi = inject(RenderApi);
  private readonly templateApi = inject(TemplateApi);

  /** Bound from the `:id` route parameter via `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly tab = signal<Tab>('content');
  protected readonly templates = signal<TemplateMeta[]>([]);
  protected readonly exporting = signal(false);

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'content', label: 'Content' },
    { id: 'design', label: 'Design' },
  ];

  /** Blank until the template list arrives, which hides the chip rather than
   *  flashing a raw template id at the user. */
  protected readonly designName = computed(() => {
    const id = this.store.resume()?.template_id;
    return this.templates().find((meta) => meta.id === id)?.name ?? '';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) this.store.load(id);
    });
    this.templateApi.list().subscribe((metas) => this.templates.set(metas));
  }

  protected rename(title: string): void {
    this.store.patch({ title });
  }

  /**
   * Exports the draft currently on screen rather than the last saved copy.
   * Autosave is debounced, so a user who hits Download immediately after typing
   * would otherwise get a PDF missing their most recent edit.
   */
  protected exportPdf(): void {
    const resume = this.store.resume();
    if (!resume || this.exporting()) return;
    this.exporting.set(true);
    this.renderApi
      .pdf({
        template_id: resume.template_id,
        theme: resume.theme,
        basics: resume.basics,
        sections: resume.sections,
      })
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          const stem = (resume.basics.full_name || resume.title || 'resume')
            .replace(/[^A-Za-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
          downloadBlob(blob, `${stem || 'resume'}.pdf`);
        },
        error: () => this.exporting.set(false),
      });
  }
}
