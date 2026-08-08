import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ResumeApi, TemplateApi } from '../../core/api/resume.api';
import { downloadBlob, filenameFrom } from '../../core/download';
import { TemplateMeta } from '../../core/models/auth.model';
import { ResumeSummary } from '../../core/models/resume.model';
import { Icon } from '../../shared/ui/icon/icon';

@Component({
  selector: 'vn-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, Icon],
  styleUrl: './dashboard.scss',
  template: `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Your resumes</h1>
          <p class="vn-muted">Everything you have written, ready to edit or export.</p>
        </div>
        <a class="vn-btn vn-btn--primary" routerLink="/templates">
          <vn-icon name="plus" [size]="16" />
          New resume
        </a>
      </header>

      @if (loading()) {
        <div class="grid">
          @for (n of [1, 2, 3]; track n) {
            <div class="vn-card skeleton"></div>
          }
        </div>
      } @else if (error()) {
        <div class="empty vn-card">
          <vn-icon name="x" [size]="26" />
          <h2>Could not load your resumes</h2>
          <p class="vn-muted">{{ error() }}</p>
          <button class="vn-btn" type="button" (click)="load()">
            <vn-icon name="refresh" [size]="16" />
            Try again
          </button>
        </div>
      } @else if (resumes().length === 0) {
        <div class="empty vn-card">
          <vn-icon name="file" [size]="26" />
          <h2>No resumes yet</h2>
          <p class="vn-muted">Pick a design and VitaNova will set up the sections for you.</p>
          <a class="vn-btn vn-btn--primary" routerLink="/templates">
            <vn-icon name="sparkle" [size]="16" />
            Browse templates
          </a>
        </div>
      } @else {
        <div class="grid">
          @for (resume of resumes(); track resume.id) {
            <article class="vn-card card">
              <a class="card-body" [routerLink]="['/editor', resume.id]">
                <span class="vn-chip">{{ templateName(resume.template_id) }}</span>
                <h2>{{ resume.title }}</h2>
                <p class="card-person">
                  {{ resume.full_name || 'Unnamed' }}
                  @if (resume.headline) {
                    <span class="vn-muted"> — {{ resume.headline }}</span>
                  }
                </p>
                <p class="card-date vn-muted">Edited {{ resume.updated_at | date: 'mediumDate' }}</p>
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
                  class="vn-btn vn-btn--sm vn-btn--icon"
                  type="button"
                  title="Duplicate"
                  aria-label="Duplicate resume"
                  (click)="duplicate(resume)"
                >
                  <vn-icon name="copy" [size]="15" />
                </button>
                <button
                  class="vn-btn vn-btn--sm vn-btn--icon vn-btn--danger"
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

  protected readonly resumes = signal<ResumeSummary[]>([]);
  protected readonly templates = signal<TemplateMeta[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busyId = signal('');

  private readonly templateNames = computed(
    () => new Map(this.templates().map((meta) => [meta.id, meta.name])),
  );

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
    return this.templateNames().get(id) ?? id;
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
}
