import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { EMPTY, catchError, debounceTime, filter, of, switchMap, tap } from 'rxjs';

import { CustomTemplateApi } from '../../core/api/custom-template.api';
import { RenderApi, ResumeApi } from '../../core/api/resume.api';
import { CustomTemplateList, isCustomTemplateId } from '../../core/models/custom-template.model';
import { RenderRequest, Resume, ResumeSection } from '../../core/models/resume.model';

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
  private readonly customApi = inject(CustomTemplateApi);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly _resume = signal<Resume | null>(null);
  private readonly _status = signal<SaveStatus>('idle');
  private readonly _previewHtml = signal<SafeHtml | null>(null);
  private readonly _previewPending = signal(false);
  private readonly _loadError = signal('');
  /** Null until the user's own designs have arrived — "none yet" is `[]`. */
  private readonly _customList = signal<CustomTemplateList | null>(null);

  readonly resume = this._resume.asReadonly();
  readonly status = this._status.asReadonly();
  readonly previewHtml = this._previewHtml.asReadonly();
  readonly previewPending = this._previewPending.asReadonly();
  readonly loadError = this._loadError.asReadonly();

  readonly customTemplates = computed(() => this._customList()?.templates ?? []);
  /** The same designs in TemplateMeta form, which is what the design panel and
   *  the toolbar already know how to display. */
  readonly customMetas = computed(() => this._customList()?.metas ?? []);

  /**
   * Exactly what the renderer needs, and the single source for both the preview
   * and the PDF export — so a downloaded file can never differ from the page the
   * user was looking at.
   *
   * Null while a custom design is still loading: rendering without its spec
   * would fall back to a built-in and flash the wrong design onto the screen.
   */
  readonly renderRequest = computed<RenderRequest | null>(() => {
    const resume = this._resume();
    if (!resume) return null;

    let custom = null;
    if (isCustomTemplateId(resume.template_id)) {
      const list = this._customList();
      if (list === null) return null;
      // Absent means deleted, or never this user's. The server falls back to the
      // default design for exactly the same reason.
      custom = list.templates.find((d) => d.template_id === resume.template_id)?.spec ?? null;
    }

    return {
      template_id: resume.template_id,
      theme: resume.theme,
      basics: resume.basics,
      sections: resume.sections,
      custom_template: custom,
    };
  });

  /** Guards against autosaving the copy we just fetched from the server. */
  private dirty = false;

  constructor() {
    this.customApi
      .list()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (result) => this._customList.set(result),
        // An empty list, not a stuck preview: a failed request here must not
        // leave somebody staring at "Rendering your resume…".
        error: () => this._customList.set({ templates: [], metas: [] }),
      });

    const changes = toObservable(this._resume).pipe(
      filter((resume): resume is Resume => resume !== null),
    );

    toObservable(this.renderRequest)
      .pipe(
        filter((request): request is RenderRequest => request !== null),
        tap(() => this._previewPending.set(true)),
        debounceTime(250),
        switchMap((request) => this.renderApi.html(request).pipe(catchError(() => EMPTY))),
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
