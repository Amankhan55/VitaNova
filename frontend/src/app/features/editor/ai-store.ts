import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { AiApi } from '../../core/api/ai.api';
import {
  AtsResponse,
  GenerateRequest,
  GenerateResponse,
  JobMatchResponse,
  RewriteRequest,
  RewriteResponse,
  aiErrorMessage,
} from '../../core/models/ai.model';
import { Basics, ResumeSection } from '../../core/models/resume.model';
import { ResumeStore } from './resume-store';

export type AiState = 'idle' | 'loading' | 'ready' | 'error';

/** How the panel presents what came back. */
export type SuggestionMode =
  /** One of several phrasings. Pick, edit, apply. */
  | 'select'
  /** A set of bullets applied together. */
  | 'replace';

export interface SuggestionPanel {
  /** Identifies the field this panel belongs to, so only one opens at a time
   *  and every ✨ button knows whether it is the active one. */
  key: string;
  title: string;
  mode: SuggestionMode;
  state: AiState;
  error: string;
  notes: string[];
  /** Candidates, in the order they were offered. */
  options: { text: string; style: string }[];
}

/** What the caller wants done once the user accepts. */
type Apply = (value: string[]) => void;

type Rerun = () => Subscription;

/**
 * The AI features' state for one editor.
 *
 * Provided per editor instance alongside `ResumeStore`, so leaving the page
 * cancels whatever was in flight rather than leaving a request to resolve
 * against a component that no longer exists.
 *
 * Three independent slots — one suggestion panel, one ATS report, one job match
 * — because they are read at once and would otherwise evict each other. Within
 * each slot a second request cancels the first: the free-tier key makes an
 * abandoned call pure waste, and the server refuses concurrent work per user
 * anyway.
 */
@Injectable()
export class AiStore {
  private readonly api = inject(AiApi);
  private readonly resume = inject(ResumeStore);

  // --- the suggestion panel (writer and rewriter share it) ------------------ //

  private readonly _panel = signal<SuggestionPanel | null>(null);
  readonly panel = this._panel.asReadonly();

  private panelSub?: Subscription;
  private apply: Apply = () => {};
  private rerun: Rerun = () => new Subscription();

  // --- ATS readiness -------------------------------------------------------- //

  private readonly _atsState = signal<AiState>('idle');
  private readonly _ats = signal<AtsResponse | null>(null);
  private readonly _atsError = signal('');
  private atsSub?: Subscription;

  readonly atsState = this._atsState.asReadonly();
  readonly ats = this._ats.asReadonly();
  readonly atsError = this._atsError.asReadonly();

  // --- job match ------------------------------------------------------------ //

  private readonly _matchState = signal<AiState>('idle');
  private readonly _match = signal<JobMatchResponse | null>(null);
  private readonly _matchError = signal('');
  private matchSub?: Subscription;

  readonly matchState = this._matchState.asReadonly();
  readonly match = this._match.asReadonly();
  readonly matchError = this._matchError.asReadonly();

  /** True while anything is talking to the AI. Drives the disabled state on
   *  every ✨ button, so one running request cannot be joined by a second. */
  readonly busy = computed(
    () =>
      this._panel()?.state === 'loading' ||
      this._atsState() === 'loading' ||
      this._matchState() === 'loading',
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.panelSub?.unsubscribe();
      this.atsSub?.unsubscribe();
      this.matchSub?.unsubscribe();
    });
  }

  // ------------------------------------------------------------------------- //
  // Writer and rewriter
  // ------------------------------------------------------------------------- //

  /** Ask the writer to draft or improve a section's prose. */
  openWriter(options: {
    key: string;
    title: string;
    request: GenerateRequest;
    apply: Apply;
  }): void {
    const bulletShaped = ['experience', 'project', 'achievement'].includes(options.request.kind);
    this.start({
      key: options.key,
      title: options.title,
      mode: bulletShaped ? 'replace' : 'select',
      apply: options.apply,
      run: (done, fail) =>
        this.api.generate(options.request).subscribe({
          next: (response) => done(this.fromGenerate(response)),
          error: fail,
        }),
    });
  }

  /** Ask for alternative phrasings of one bullet. */
  openRewriter(options: {
    key: string;
    title: string;
    request: RewriteRequest;
    apply: Apply;
  }): void {
    this.start({
      key: options.key,
      title: options.title,
      mode: 'select',
      apply: options.apply,
      run: (done, fail) =>
        this.api.rewriteBullet(options.request).subscribe({
          next: (response) => done(this.fromRewrite(response)),
          error: fail,
        }),
    });
  }

  /** Run the same request again. The user did not like what they were offered. */
  regenerate(): void {
    const panel = this._panel();
    if (!panel || panel.state === 'loading') return;
    this._panel.set({ ...panel, state: 'loading', error: '', options: [], notes: [] });
    this.panelSub?.unsubscribe();
    this.panelSub = this.rerun();
  }

  /** Hand the chosen text back to whoever opened the panel, then close. */
  accept(values: string[]): void {
    const cleaned = values.map((value) => value.trim()).filter(Boolean);
    if (cleaned.length) this.apply(cleaned);
    this.closePanel();
  }

  closePanel(): void {
    this.panelSub?.unsubscribe();
    this.panelSub = undefined;
    this._panel.set(null);
  }

  /** Whether the open panel belongs to a given field. */
  isOpenFor(key: string): boolean {
    return this._panel()?.key === key;
  }

  private start(options: {
    key: string;
    title: string;
    mode: SuggestionMode;
    apply: Apply;
    run: (done: (result: Pick<SuggestionPanel, 'options' | 'notes'>) => void,
          fail: (error: HttpErrorResponse) => void) => Subscription;
  }): void {
    // Opening a second panel abandons the first, so its in-flight request is
    // cancelled rather than left to arrive somewhere nothing is listening.
    this.panelSub?.unsubscribe();
    this.apply = options.apply;

    this._panel.set({
      key: options.key,
      title: options.title,
      mode: options.mode,
      state: 'loading',
      error: '',
      notes: [],
      options: [],
    });

    const done = (result: Pick<SuggestionPanel, 'options' | 'notes'>) => {
      this.patchPanel(options.key, {
        state: 'ready',
        options: result.options,
        notes: result.notes,
      });
    };
    const fail = (error: HttpErrorResponse) => {
      this.patchPanel(options.key, {
        state: 'error',
        error: aiErrorMessage(error.status, error.error?.detail),
      });
    };

    this.rerun = () => options.run(done, fail);
    this.panelSub = this.rerun();
  }

  /**
   * Apply a change only if the panel is still the one that asked for it.
   *
   * Without the key check, a slow response for a bullet the user has since
   * navigated away from would overwrite the panel they are now looking at.
   */
  private patchPanel(key: string, changes: Partial<SuggestionPanel>): void {
    const panel = this._panel();
    if (!panel || panel.key !== key) return;
    this._panel.set({ ...panel, ...changes });
  }

  private fromGenerate(response: GenerateResponse): Pick<SuggestionPanel, 'options' | 'notes'> {
    const options = response.bullets.length
      ? response.bullets.map((text) => ({ text, style: '' }))
      : response.variants.map((variant) => ({ text: variant.text, style: variant.style }));
    const notes = [...response.notes];
    if (!options.length) {
      notes.push('Nothing could be written from the detail provided. Add a little more and retry.');
    }
    return { options, notes };
  }

  private fromRewrite(response: RewriteResponse): Pick<SuggestionPanel, 'options' | 'notes'> {
    return {
      options: response.suggestions.map((s) => ({ text: s.text, style: s.style })),
      notes: [...response.notes],
    };
  }

  // ------------------------------------------------------------------------- //
  // Whole-document analyses
  // ------------------------------------------------------------------------- //

  /** Score the draft currently on screen. */
  runAts(): void {
    const payload = this.payload();
    if (!payload || this._atsState() === 'loading') return;

    this.atsSub?.unsubscribe();
    this._atsState.set('loading');
    this._atsError.set('');
    this.atsSub = this.api.atsScore(payload).subscribe({
      next: (response) => {
        this._ats.set(response);
        this._atsState.set('ready');
      },
      error: (error: HttpErrorResponse) => {
        this._atsError.set(aiErrorMessage(error.status, error.error?.detail));
        this._atsState.set('error');
      },
    });
  }

  runJobMatch(jobDescription: string): void {
    const payload = this.payload();
    if (!payload || this._matchState() === 'loading') return;

    this.matchSub?.unsubscribe();
    this._matchState.set('loading');
    this._matchError.set('');
    this.matchSub = this.api.jobMatch(payload, jobDescription).subscribe({
      next: (response) => {
        this._match.set(response);
        this._matchState.set('ready');
      },
      error: (error: HttpErrorResponse) => {
        this._matchError.set(aiErrorMessage(error.status, error.error?.detail));
        this._matchState.set('error');
      },
    });
  }

  /**
   * The draft as the analyses want it.
   *
   * Read live rather than from the last save: autosave is debounced by 800ms,
   * so a user who edits and immediately clicks Analyse would otherwise be
   * scored on text they have already replaced. Same reasoning as the PDF export.
   */
  private payload(): { basics: Basics; sections: ResumeSection[] } | null {
    const resume = this.resume.resume();
    return resume ? { basics: resume.basics, sections: resume.sections } : null;
  }
}
