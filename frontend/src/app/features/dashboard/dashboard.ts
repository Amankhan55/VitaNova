import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ResumeApi, TemplateApi } from '../../core/api/resume.api';
import { AuthService } from '../../core/auth/auth.service';
import { downloadBlob, filenameFrom } from '../../core/download';
import { TemplateMeta } from '../../core/models/auth.model';
import { ResumeSummary } from '../../core/models/resume.model';
import { Icon } from '../../shared/ui/icon/icon';

/** Kept in step with `import_service.MAX_PDF_SIZE` on the server. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Turns a failed import into something worth reading.
 *
 * The status carries the meaning: 503 is the AI service being unavailable, and
 * telling someone to "try a different PDF" in that case sends them off fixing a
 * file that was never the problem.
 */
function readImportError(err: HttpErrorResponse): string {
  const detail = err.error?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (err.status === 0) return 'Cannot reach the VitaNova server. Is the API running?';
  if (err.status === 503) return 'The AI service is unavailable right now. Please try again shortly.';
  if (err.status === 413) return 'That PDF is too large. The limit is 5 MB.';
  return 'Could not import that resume. Please try again.';
}

@Component({
  selector: 'vn-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, FormsModule, Icon],
  styleUrl: './dashboard.scss',
  template: `
    <div class="page">
      <header class="page-head">
        <div class="page-title">
          <span class="vn-eyebrow">{{ greeting() }}</span>
          <h1>Your resumes</h1>
          <p class="vn-muted">{{ subtitle() }}</p>
        </div>

        <div class="page-tools">
          @if (resumes().length > 2) {
            <label class="search">
              <vn-icon name="search" [size]="16" />
              <input
                type="search"
                [(ngModel)]="query"
                (ngModelChange)="search.set($event)"
                placeholder="Search by title or name"
                aria-label="Search your resumes"
              />
            </label>
          }
          <button
            class="vn-btn vn-btn--ghost"
            type="button"
            (click)="fileInput.click()"
            [disabled]="importing()"
          >
            <vn-icon name="upload" [size]="16" />
            {{ importing() ? 'Parsing…' : 'Import PDF' }}
          </button>
          <input
            #fileInput
            type="file"
            accept=".pdf,application/pdf"
            hidden
            (change)="onFileSelected($event)"
          />
          <a class="vn-btn vn-btn--primary" routerLink="/templates">
            <vn-icon name="plus" [size]="16" />
            New resume
          </a>
        </div>
      </header>

      @if (importError(); as message) {
        <div class="import-error vn-card" role="alert">
          <span class="import-error-icon"><vn-icon name="x" [size]="16" /></span>
          <p>{{ message }}</p>
          <button
            class="vn-btn vn-btn--sm vn-btn--ghost"
            type="button"
            aria-label="Dismiss"
            (click)="importError.set('')"
          >
            <vn-icon name="x" [size]="15" />
          </button>
        </div>
      }

      @if (loading()) {
        <div class="grid">
          @for (n of [1, 2, 3]; track n) {
            <div class="vn-card vn-skeleton skeleton"></div>
          }
        </div>
      } @else if (error()) {
        <div class="empty vn-card">
          <span class="empty-icon is-danger"><vn-icon name="x" [size]="22" /></span>
          <h2>Could not load your resumes</h2>
          <p class="vn-muted">{{ error() }}</p>
          <button class="vn-btn" type="button" (click)="load()">
            <vn-icon name="refresh" [size]="16" />
            Try again
          </button>
        </div>
      } @else if (resumes().length === 0) {
        <div class="empty vn-card">
          <span class="empty-icon"><vn-icon name="file" [size]="22" /></span>
          <h2>Nothing written yet</h2>
          <p class="vn-muted">
            Pick a design and VitaNova sets up the sections for you — summary, experience, education
            and the rest, ready to fill in.
          </p>
          <a class="vn-btn vn-btn--primary" routerLink="/templates">
            <vn-icon name="sparkle" [size]="16" />
            Browse designs
          </a>
        </div>
      } @else if (visible().length === 0) {
        <div class="empty vn-card">
          <span class="empty-icon"><vn-icon name="search" [size]="22" /></span>
          <h2>No match for “{{ search() }}”</h2>
          <p class="vn-muted">Try a shorter search, or clear it to see everything.</p>
          <button class="vn-btn" type="button" (click)="clearSearch()">Clear search</button>
        </div>
      } @else {
        <div class="grid">
          @for (resume of visible(); track resume.id) {
            <article class="vn-card card">
              <a class="card-body" [routerLink]="['/editor', resume.id]">
                <span class="card-swatch" [style.background]="accentFor(resume.template_id)"></span>
                <span class="vn-chip">{{ templateName(resume.template_id) }}</span>
                <h2>{{ resume.title }}</h2>
                <p class="card-person">
                  {{ resume.full_name || 'Unnamed' }}
                  @if (resume.headline) {
                    <span class="vn-muted"> — {{ resume.headline }}</span>
                  }
                </p>
                <p class="card-date">
                  <vn-icon name="clock" [size]="13" />
                  Edited {{ resume.updated_at | date: 'mediumDate' }}
                </p>
              </a>

              <footer class="card-actions">
                <a class="vn-btn vn-btn--sm" [routerLink]="['/editor', resume.id]">
                  <vn-icon name="edit" [size]="15" />
                  Edit
                </a>
                <button
                  class="vn-btn vn-btn--sm"
                  type="button"
                  (click)="download(resume)"
                  [disabled]="busyId() === resume.id"
                >
                  <vn-icon name="download" [size]="15" />
                  {{ busyId() === resume.id ? 'Preparing…' : 'PDF' }}
                </button>
                <button
                  class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost"
                  type="button"
                  title="Duplicate"
                  aria-label="Duplicate resume"
                  (click)="duplicate(resume)"
                >
                  <vn-icon name="copy" [size]="15" />
                </button>
                <button
                  class="vn-btn vn-btn--sm vn-btn--icon vn-btn--ghost vn-btn--danger"
                  type="button"
                  title="Delete"
                  aria-label="Delete resume"
                  (click)="remove(resume)"
                >
                  <vn-icon name="trash" [size]="15" />
                </button>
              </footer>
            </article>
          }
        </div>
      }
    </div>
  `,
})
export class DashboardPage {
  private readonly resumeApi = inject(ResumeApi);
  private readonly templateApi = inject(TemplateApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly resumes = signal<ResumeSummary[]>([]);
  protected readonly templates = signal<TemplateMeta[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busyId = signal('');
  protected readonly search = signal('');
  protected readonly importing = signal(false);
  protected readonly importError = signal('');

  protected query = '';

  private readonly templatesById = computed(
    () => new Map(this.templates().map((meta) => [meta.id, meta])),
  );

  protected readonly visible = computed(() => {
    const needle = this.search().trim().toLowerCase();
    if (!needle) return this.resumes();
    return this.resumes().filter((resume) =>
      `${resume.title} ${resume.full_name} ${resume.headline}`.toLowerCase().includes(needle),
    );
  });

  protected readonly greeting = computed(() => {
    const name = this.auth.user()?.full_name.trim().split(/\s+/)[0];
    return name ? `Welcome back, ${name}` : 'Welcome back';
  });

  protected readonly subtitle = computed(() => {
    const count = this.resumes().length;
    if (this.loading() || this.error()) return 'Everything you have written, ready to edit or export.';
    if (count === 0) return 'Everything you write will live here.';
    return `${count} ${count === 1 ? 'resume' : 'resumes'}, ready to edit or export.`;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({ resumes: this.resumeApi.list(), templates: this.templateApi.list() }).subscribe({
      next: ({ resumes, templates }) => {
        this.resumes.set(resumes);
        this.templates.set(templates);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('The VitaNova API did not respond. Check that the backend is running.');
        this.loading.set(false);
      },
    });
  }

  protected templateName(id: string): string {
    return this.templatesById().get(id)?.name ?? id;
  }

  /** Ties a card to its design at a glance, without loading a full render. */
  protected accentFor(id: string): string {
    return this.templatesById().get(id)?.accent ?? 'var(--vn-border-strong)';
  }

  protected clearSearch(): void {
    this.query = '';
    this.search.set('');
  }

  protected download(resume: ResumeSummary): void {
    this.busyId.set(resume.id);
    this.resumeApi.exportPdf(resume.id).subscribe({
      next: (response) => {
        this.busyId.set('');
        if (!response.body) return;
        const name = filenameFrom(
          response.headers.get('Content-Disposition'),
          `${resume.title || 'resume'}.pdf`,
        );
        downloadBlob(response.body, name);
      },
      error: () => this.busyId.set(''),
    });
  }

  protected duplicate(resume: ResumeSummary): void {
    this.resumeApi.duplicate(resume.id).subscribe((copy) => {
      void this.router.navigate(['/editor', copy.id]);
    });
  }

  protected remove(resume: ResumeSummary): void {
    const confirmed = confirm(`Delete "${resume.title}"? This cannot be undone.`);
    if (!confirmed) return;
    this.resumeApi.remove(resume.id).subscribe(() => {
      this.resumes.update((list) => list.filter((item) => item.id !== resume.id));
    });
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // reset so re-selecting the same file still triggers
    if (!file) return;

    this.importError.set('');

    // Mirrors the server's cap so an obviously oversized file never leaves the
    // browser. The server enforces it regardless — this is courtesy, not a check.
    if (file.size > MAX_IMPORT_BYTES) {
      this.importError.set(
        `“${file.name}” is ${Math.round(file.size / 1024 / 1024)} MB. The limit is 5 MB.`,
      );
      return;
    }

    this.importing.set(true);
    this.resumeApi.importResume(file).subscribe({
      next: (resume) => {
        this.importing.set(false);
        void this.router.navigate(['/editor', resume.id]);
      },
      error: (err: HttpErrorResponse) => {
        this.importing.set(false);
        this.importError.set(readImportError(err));
      },
    });
  }
}
