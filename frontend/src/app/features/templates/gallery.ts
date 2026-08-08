import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { ResumeApi, TemplateApi } from '../../core/api/resume.api';
import { TemplateMeta } from '../../core/models/auth.model';
import { Icon } from '../../shared/ui/icon/icon';
import { TemplatePreview } from './template-preview';

type Filter = 'all' | 'ats';

@Component({
  selector: 'vn-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, TemplatePreview],
  styleUrl: './gallery.scss',
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <span class="vn-eyebrow">The gallery</span>
          <h1>Choose a design</h1>
          <p>
            Every card below is a live render, not a picture — it is produced by the same engine that
            writes your PDF. You can switch design at any time without retyping anything.
          </p>
        </div>

        @if (templates().length > 0) {
          <div class="filters" role="group" aria-label="Filter designs">
            <button
              type="button"
              [class.is-active]="filter() === 'all'"
              (click)="filter.set('all')"
            >
              All {{ templates().length }}
            </button>
            <button
              type="button"
              [class.is-active]="filter() === 'ats'"
              (click)="filter.set('ats')"
            >
              ATS safe {{ atsCount() }}
            </button>
          </div>
        }
      </header>

      @if (error()) {
        <div class="vn-card notice">
          <vn-icon name="x" [size]="18" />
          <span>{{ error() }}</span>
        </div>
      }

      <div class="grid">
        @for (meta of visible(); track meta.id) {
          <article class="vn-card card">
            <div class="thumb vn-paper-sheet">
              <vn-template-preview [templateId]="meta.id" />
            </div>

            <div class="card-body">
              <div class="card-head">
                <h2>
                  <span class="swatch" [style.background]="meta.accent"></span>
                  {{ meta.name }}
                </h2>
                @if (meta.ats_safe) {
                  <span class="vn-chip vn-chip--accent" title="Plain enough for resume parsers">
                    <vn-icon name="shield" [size]="12" />
                    ATS safe
                  </span>
                }
              </div>

              <p class="card-desc">{{ meta.description }}</p>

              <div class="tags">
                @for (tag of meta.tags; track tag) {
                  <span class="vn-chip">{{ tag }}</span>
                }
              </div>

              <button
                class="vn-btn vn-btn--primary use"
                type="button"
                [disabled]="creatingId() !== ''"
                (click)="use(meta)"
              >
                @if (creatingId() === meta.id) {
                  Creating…
                } @else {
                  <vn-icon name="plus" [size]="16" />
                  Use this design
                }
              </button>
            </div>
          </article>
        } @empty {
          @if (!error()) {
            @for (n of [0, 1, 2, 3, 5, 6]; track n) {
              <div class="vn-skeleton skeleton"></div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class GalleryPage {
  private readonly templateApi = inject(TemplateApi);
  private readonly resumeApi = inject(ResumeApi);
  private readonly router = inject(Router);

  protected readonly templates = signal<TemplateMeta[]>([]);
  protected readonly error = signal('');
  protected readonly creatingId = signal('');
  protected readonly filter = signal<Filter>('all');

  protected readonly atsCount = computed(
    () => this.templates().filter((meta) => meta.ats_safe).length,
  );

  protected readonly visible = computed(() =>
    this.filter() === 'ats'
      ? this.templates().filter((meta) => meta.ats_safe)
      : this.templates(),
  );

  constructor() {
    this.templateApi.list().subscribe({
      next: (metas) => this.templates.set(metas),
      error: () => this.error.set('Could not load the template list from the API.'),
    });
  }

  protected use(meta: TemplateMeta): void {
    if (this.creatingId()) return;
    this.creatingId.set(meta.id);
    this.resumeApi
      .create({ title: `${meta.name} resume`, template_id: meta.id, seed_from_template: true })
      .subscribe({
        next: (resume) => void this.router.navigate(['/editor', resume.id]),
        error: () => {
          this.creatingId.set('');
          this.error.set('Could not create the resume. Please try again.');
        },
      });
  }
}
