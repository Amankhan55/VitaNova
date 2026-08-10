import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ResumeApi, TemplateApi } from '../../core/api/resume.api';
import { AuthService } from '../../core/auth/auth.service';
import { downloadBlob, filenameFrom } from '../../core/download';
import { TemplateMeta } from '../../core/models/auth.model';
import { Resume, ResumeSummary } from '../../core/models/resume.model';
import { ConfirmService } from '../../shared/ui/confirm/confirm.service';
import { Icon } from '../../shared/ui/icon/icon';

/** Kept in step with `import_service.MAX_PDF_SIZE` on the server. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/* --------------------------------------------------------------------------
   Import progress
   --------------------------------------------------------------------------
   Only one part of an import can be measured: the upload, which the browser
   reports byte by byte. Everything after it happens on the server behind a
   single request that says nothing until it answers — and measured against a
   real import, that silent stretch is ~99.7% of the wall time (12–13s of model
   call versus ~36ms of text extraction).

   So the bar is honest in two different ways for two different phases:

     0 → UPLOAD_CEILING    real, from HttpEventType.UploadProgress
     UPLOAD_CEILING → 100  an estimate, and never allowed to reach 100

   The estimate decays toward PARSE_CEILING with the half-life below. Against a
   measured 12–13s median that lands the bar around 76% when the response
   arrives, and it is still visibly climbing (~92%) even at 30s, so a slow
   import never looks hung. It cannot finish on its own: only the real response
   moves it to 100. A bar that sits at 100% while the user waits is the one
   thing worse than no bar.
   -------------------------------------------------------------------------- */

export const UPLOAD_CEILING = 20;
export const PARSE_CEILING = 95;
/** Half-life, not time-constant: percent = 95 − 75·(½)^(t/6.5s). */
const IMPORT_PARSE_HALFLIFE_MS = 6_500;

/**
 * The estimated percentage `elapsedMs` into the server-side phase.
 *
 * Exported so its invariants can be tested: it starts at UPLOAD_CEILING, only
 * ever increases, and approaches PARSE_CEILING without reaching it.
 */
export function importParsePercent(elapsedMs: number): number {
  const decay = Math.pow(0.5, elapsedMs / IMPORT_PARSE_HALFLIFE_MS);
  return PARSE_CEILING - (PARSE_CEILING - UPLOAD_CEILING) * decay;
}
const PROGRESS_TICK_MS = 120;
/** After this long the wait is unusual enough to deserve an explanation. */
const SLOW_IMPORT_MS = 20_000;

interface ImportProgress {
  percent: number;
  label: string;
  note: string;
  /** Drives the indeterminate shimmer — off once the real result is in. */
  active: boolean;
}

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
            {{ importing() ? 'Importing…' : 'Import PDF' }}
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

      @if (progress(); as p) {
        <div class="import-progress vn-card">
          <div class="import-progress-head">
            <span class="import-spinner" [class.is-done]="!p.active">
              <vn-icon [name]="p.active ? 'sparkle' : 'check'" [size]="15" />
            </span>
            <span class="import-label">{{ p.label }}</span>
            <span class="import-percent">{{ p.percent }}<small>%</small></span>
          </div>

          <div
            class="import-track"
            role="progressbar"
            [attr.aria-valuenow]="p.percent"
            aria-valuemin="0"
            aria-valuemax="100"
            [attr.aria-label]="p.label"
          >
            <div class="import-fill" [class.is-active]="p.active" [style.width.%]="p.percent"></div>
          </div>

          <p class="import-note" aria-live="polite">{{ p.note }}</p>
        </div>
      }

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
  private readonly confirm = inject(ConfirmService);

  protected readonly resumes = signal<ResumeSummary[]>([]);
  protected readonly templates = signal<TemplateMeta[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busyId = signal('');
  protected readonly search = signal('');
  protected readonly importing = signal(false);
  protected readonly importError = signal('');
  protected readonly progress = signal<ImportProgress | null>(null);

  /** Set while the post-upload estimate is animating. */
  private ticker?: ReturnType<typeof setInterval>;

  constructor() {
    this.load();
    inject(DestroyRef).onDestroy(() => this.stopTicker());
  }

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

  protected async remove(resume: ResumeSummary): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Delete this resume?',
      message: `“${resume.title}” and everything in it will be removed. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
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
    this.progress.set({
      percent: 0,
      label: `Uploading ${file.name}`,
      note: 'Sending the file to the server.',
      active: true,
    });

    this.resumeApi.importResume(file).subscribe({
      next: (event) => {
        if (event.state === 'uploading') {
          this.onUploadProgress(event.fraction, file.name);
          return;
        }
        this.onImportComplete(event.resume);
      },
      error: (err: HttpErrorResponse) => {
        this.stopTicker();
        this.importing.set(false);
        this.progress.set(null);
        this.importError.set(readImportError(err));
      },
    });
  }

  private onUploadProgress(fraction: number, filename: string): void {
    const percent = Math.round(fraction * UPLOAD_CEILING);
    this.progress.set({
      percent,
      label: `Uploading ${filename}`,
      note: 'Sending the file to the server.',
      active: true,
    });
    // The upload finishing is the last thing we hear about until the response,
    // so this is where the estimate takes over.
    if (fraction >= 1) this.startParseEstimate();
  }

  /**
   * Animates from UPLOAD_CEILING toward PARSE_CEILING while the server works.
   *
   * Exponential decay rather than a straight line: a fast import should look
   * fast, and a slow one should visibly keep moving without ever implying it is
   * about to finish. It asymptotes below 100 by construction.
   */
  private startParseEstimate(): void {
    this.stopTicker();
    const startedAt = performance.now();

    const tick = () => {
      const elapsed = performance.now() - startedAt;
      this.progress.set({
        percent: Math.round(importParsePercent(elapsed)),
        label: 'Reading your resume',
        note:
          elapsed > SLOW_IMPORT_MS
            ? 'Still going — the free AI tier gets busy at times. Hang on.'
            : 'Pulling out your experience, education and skills.',
        active: true,
      });
    };

    tick();
    this.ticker = setInterval(tick, PROGRESS_TICK_MS);
  }

  private onImportComplete(resume: Resume): void {
    this.stopTicker();
    // Only the real response is allowed to say 100%.
    this.progress.set({
      percent: 100,
      label: 'Imported',
      note: 'Opening it in the editor…',
      active: false,
    });
    // A beat at 100% so the bar reads as finished rather than just vanishing.
    setTimeout(() => {
      this.importing.set(false);
      this.progress.set(null);
      void this.router.navigate(['/editor', resume.id]);
    }, 500);
  }

  private stopTicker(): void {
    if (this.ticker !== undefined) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }
}
