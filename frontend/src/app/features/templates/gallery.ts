import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { CustomTemplateApi } from '../../core/api/custom-template.api';
import { ResumeApi, TemplateApi } from '../../core/api/resume.api';
import { TemplateMeta } from '../../core/models/auth.model';
import { isCustomTemplateId } from '../../core/models/custom-template.model';
import { Icon } from '../../shared/ui/icon/icon';
import { TemplatePreview } from './template-preview';

type Filter = 'all' | 'ats' | 'mine';

@Component({
  selector: 'vn-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, RouterLink, Icon, TemplatePreview],
  styleUrl: './gallery.scss',
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-title">
          <span class="vn-eyebrow">Specimen sheets</span>
          <h1>Choose a design</h1>
          <p>
            Every sheet below is a live render, not a picture — it is produced by the same engine
            that writes your PDF. You can switch design at any time without retyping anything,
            or build one of your own.
          </p>
        </div>

        @if (templates().length > 0) {
          <div class="filters" role="group" aria-label="Filter designs">
            <button
              type="button"
              [class.is-active]="filter() === 'all'"
              (click)="filter.set('all')"
            >
              All <span class="vn-mono">{{ templates().length }}</span>
            </button>
            <button
              type="button"
              [class.is-active]="filter() === 'ats'"
              (click)="filter.set('ats')"
            >
              ATS safe <span class="vn-mono">{{ atsCount() }}</span>
            </button>
            @if (mine().length > 0) {
              <button
                type="button"
                [class.is-active]="filter() === 'mine'"
                (click)="filter.set('mine')"
              >
                Yours <span class="vn-mono">{{ mine().length }}</span>
              </button>
            }
          </div>
        }
      </header>

      @if (error()) {
        <div class="notice">
          <vn-icon name="x" [size]="17" />
          <span>{{ error() }}</span>
        </div>
      }

      <div class="plates">
        <!-- The way into the builder sits in the run of designs rather than in
             the toolbar: "one more design, which you draw yourself" is what it
             actually is. -->
        <a class="plate plate--build" routerLink="/templates/custom/new">
          <div class="build-mount">
            <vn-icon name="plus" [size]="26" />
            <h2>Build your own</h2>
            <p>
              Set the layout, type, rules and colour yourself. It saves as a design you can
              reuse on any resume.
            </p>
          </div>
        </a>

        @for (meta of visible(); track meta.id; let i = $index) {
          <article class="plate">
            <!-- The sheet is presented the way a specimen is: pinned on the
                 gutter it will be printed against, with its own edge visible. -->
            <div class="plate-mount vn-paper-gutter">
              <div class="thumb vn-paper-sheet">
                <vn-template-preview [templateId]="meta.id" />
              </div>
            </div>

            <div class="plate-caption">
              <div class="caption-head">
                <span class="plate-no vn-mono">{{ i + 1 | number: '2.0-0' }}</span>
                <h2>{{ meta.name }}</h2>
                <span class="swatch" [style.background]="meta.accent" aria-hidden="true"></span>
              </div>

              @if (meta.description) {
                <p class="caption-desc">{{ meta.description }}</p>
              }

              <div class="tags">
                @if (isMine(meta)) {
                  <span class="vn-chip vn-chip--accent">
                    <vn-icon name="edit" [size]="11" />
                    Yours
                  </span>
                }
                @if (meta.ats_safe) {
                  <span class="vn-chip" title="Plain enough for resume parsers">
                    <vn-icon name="shield" [size]="11" />
                    ATS safe
                  </span>
                }
                @for (tag of meta.tags; track tag) {
                  <span class="vn-chip">{{ tag }}</span>
                }
              </div>

              <div class="plate-actions">
                <button
                  class="vn-btn vn-btn--primary use"
                  type="button"
                  [disabled]="creatingId() !== ''"
                  (click)="use(meta)"
                >
                  @if (creatingId() === meta.id) {
                    Creating…
                  } @else {
                    Use this design
                    <vn-icon name="arrow-right" [size]="15" />
                  }
                </button>

                @if (isMine(meta)) {
                  <a
                    class="vn-btn edit"
                    [routerLink]="['/templates/custom', designId(meta)]"
                    title="Edit this design"
                    aria-label="Edit this design"
                  >
                    <vn-icon name="edit" [size]="15" />
                  </a>
                }
              </div>
            </div>
          </article>
        } @empty {
          @if (!error()) {
            @for (n of [0, 1, 2, 3, 5, 6]; track n) {
              <div class="plate">
                <div class="vn-skeleton skeleton"></div>
              </div>
            }
          }
        }
      </div>
    </div>
  `,
})
export class GalleryPage {
  private readonly templateApi = inject(TemplateApi);
  private readonly customApi = inject(CustomTemplateApi);
  private readonly resumeApi = inject(ResumeApi);
  private readonly router = inject(Router);

  protected readonly templates = signal<TemplateMeta[]>([]);
  protected readonly error = signal('');
  protected readonly creatingId = signal('');
  protected readonly filter = signal<Filter>('all');

  protected readonly atsCount = computed(
    () => this.templates().filter((meta) => meta.ats_safe).length,
  );

  protected readonly mine = computed(() => this.templates().filter((meta) => this.isMine(meta)));

  protected readonly visible = computed(() => {
    if (this.filter() === 'ats') return this.templates().filter((meta) => meta.ats_safe);
    if (this.filter() === 'mine') return this.mine();
    return this.templates();
  });

  constructor() {
    // Both lists in one pass so the shelf never reflows a second time. A user
    // with no designs of their own — or an API that cannot list them — still
    // gets the built-ins, which is the part of this page that must not fail.
    forkJoin({
      builtIns: this.templateApi.list(),
      custom: this.customApi.list().pipe(catchError(() => of({ templates: [], metas: [] }))),
    }).subscribe({
      next: ({ builtIns, custom }) => this.templates.set([...custom.metas, ...builtIns]),
      error: () => this.error.set('Could not load the template list from the API.'),
    });
  }

  protected isMine(meta: TemplateMeta): boolean {
    return isCustomTemplateId(meta.id);
  }

  /** The bare document id, for the builder's route. */
  protected designId(meta: TemplateMeta): string {
    return meta.id.replace(/^custom:/, '');
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
