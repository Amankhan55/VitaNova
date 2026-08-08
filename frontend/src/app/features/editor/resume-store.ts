import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { EMPTY, catchError, debounceTime, filter, of, switchMap, tap } from 'rxjs';

import { RenderApi, ResumeApi } from '../../core/api/resume.api';
import { Resume, ResumeSection } from '../../core/models/resume.model';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Holds the resume being edited and keeps two things in step with it:
 *
 *   - the server copy, via a debounced autosave
 *   - the live preview, via a shorter debounce against the render endpoint
 *
 * The two run on independent clocks on purpose. The preview refreshes quickly so
 * typing feels responsive, while saving stays lazy enough not to write on every
 * keystroke — and because the preview never waits on a save, a slow or failed
 * write can't freeze the page the user is looking at.
 *
 * Provided per editor instance rather than in root, so leaving the editor
 * disposes the state and both subscriptions.
 */
@Injectable()
export class ResumeStore {
  private readonly resumeApi = inject(ResumeApi);
  private readonly renderApi = inject(RenderApi);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly _resume = signal<Resume | null>(null);
  private readonly _status = signal<SaveStatus>('idle');
  private readonly _previewHtml = signal<SafeHtml | null>(null);
  private readonly _previewPending = signal(false);
  private readonly _loadError = signal('');

  readonly resume = this._resume.asReadonly();
  readonly status = this._status.asReadonly();
  readonly previewHtml = this._previewHtml.asReadonly();
  readonly previewPending = this._previewPending.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  /** Guards against autosaving the copy we just fetched from the server. */
  private dirty = false;

  constructor() {
    const changes = toObservable(this._resume).pipe(
      filter((resume): resume is Resume => resume !== null),
    );

    changes
      .pipe(
        tap(() => this._previewPending.set(true)),
        debounceTime(250),
        switchMap((resume) =>
          this.renderApi
            .html({
              template_id: resume.template_id,
              theme: resume.theme,
              basics: resume.basics,
              sections: resume.sections,
            })
            .pipe(catchError(() => EMPTY)),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((html) => {
        // Our own render endpoint, shown in a fully sandboxed iframe.
        this._previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
        this._previewPending.set(false);
      });

    changes
      .pipe(
        filter(() => this.dirty),
        tap(() => this._status.set('saving')),
        debounceTime(800),
        switchMap((resume) =>
          this.resumeApi
            .update(resume.id, {
              title: resume.title,
              template_id: resume.template_id,
              theme: resume.theme,
              basics: resume.basics,
              sections: resume.sections,
            })
            .pipe(
              switchMap(() => of<SaveStatus>('saved')),
              catchError(() => of<SaveStatus>('error')),
            ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((status) => this._status.set(status));
  }

  load(id: string): void {
    this.dirty = false;
    this._loadError.set('');
    this.resumeApi.get(id).subscribe({
      next: (resume) => this._resume.set(resume),
      error: () => this._loadError.set('That resume could not be loaded.'),
    });
  }

  /** Applies a change and marks the document dirty so autosave picks it up. */
  update(mutate: (resume: Resume) => Resume): void {
    const current = this._resume();
    if (!current) return;
    this.dirty = true;
    this._resume.set(mutate(current));
  }

  patch(changes: Partial<Resume>): void {
    this.update((resume) => ({ ...resume, ...changes }));
  }

  replaceSections(sections: ResumeSection[]): void {
    this.update((resume) => ({ ...resume, sections }));
  }

  /** Replaces one section by id, leaving the rest untouched. */
  updateSection(sectionId: string, mutate: (section: ResumeSection) => ResumeSection): void {
    this.update((resume) => ({
      ...resume,
      sections: resume.sections.map((section) =>
        section.id === sectionId ? mutate(section) : section,
      ),
    }));
  }
}
