import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { Resume } from '../../core/models/resume.model';
import { AiStore } from './ai-store';
import { ResumeStore } from './resume-store';

/**
 * The rules that keep a free-tier key from being wasted and a slow response
 * from landing on the wrong field. Both are invisible when they work, which is
 * exactly why they are pinned here rather than left to be noticed in use.
 */

const REWRITE_URL = '/api/v1/ai/resume/rewrite-bullet';
const ATS_URL = '/api/v1/ai/resume/ats-score';

function resumeFixture(): Resume {
  return {
    id: 'r1',
    title: 'Test',
    template_id: 'modern-professional',
    theme: { accent: '#000', font_scale: 1, page_size: 'A4', density: 'normal' },
    basics: {
      full_name: 'Ada Lovelace',
      headline: '',
      email: '',
      phone: '',
      location: '',
      links: [],
      initials: '',
    },
    sections: [{ id: 's1', type: 'summary', title: 'Summary', visible: true, content: 'Hi.' }],
    created_at: '',
    updated_at: '',
  };
}

describe('AiStore', () => {
  let store: AiStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ResumeStore, AiStore],
    });
    http = TestBed.inject(HttpTestingController);
    // AiStore pulls in ResumeStore, which fetches the user's own designs as soon
    // as it exists — the editor needs their specs to render a preview. Answered
    // here so the afterEach verify() stays a real check on this suite's own
    // requests rather than being loosened to ignore a standing one.
    store = TestBed.inject(AiStore);
    http.expectOne('/api/v1/custom-templates').flush({ templates: [], metas: [] });
  });

  /** Puts a document in ResumeStore, as loading the editor would. */
  function loadResume(): void {
    TestBed.inject(ResumeStore).load('r1');
    http.expectOne('/api/v1/resumes/r1').flush(resumeFixture());
  }

  function openRewriter(key = 'bullet:i1:0', apply: (v: string[]) => void = () => {}): void {
    store.openRewriter({ key, title: 'Rewrite', request: { bullet: 'Fixed bugs.' }, apply });
  }

  // --- the panel lifecycle -------------------------------------------------- //

  it('shows a loading panel the moment a rewrite is asked for', () => {
    openRewriter();
    expect(store.panel()?.state).toBe('loading');
    expect(store.busy()).toBe(true);
    http.expectOne(REWRITE_URL);
  });

  it('presents the suggestions that come back', () => {
    openRewriter();
    http.expectOne(REWRITE_URL).flush({
      original: 'Fixed bugs.',
      suggestions: [{ text: 'Resolved software defects.', style: 'professional' }],
      notes: [],
    });

    expect(store.panel()?.state).toBe('ready');
    expect(store.panel()?.options).toEqual([
      { text: 'Resolved software defects.', style: 'professional' },
    ]);
    expect(store.busy()).toBe(false);
  });

  it('carries the server’s withheld-suggestion note through to the panel', () => {
    // The grounding filter's explanation is the user's only clue that a
    // suggestion was caught rather than never written. Losing it here would
    // make the backend guard invisible.
    openRewriter();
    http.expectOne(REWRITE_URL).flush({
      original: 'Fixed bugs.',
      suggestions: [],
      notes: ['1 rewrite withheld for adding figures that were not in your bullet.'],
    });

    expect(store.panel()?.notes[0]).toContain('withheld');
  });

  it('applies the accepted text and closes', () => {
    const applied: string[][] = [];
    openRewriter('bullet:i1:0', (value) => applied.push(value));
    http.expectOne(REWRITE_URL).flush({ original: 'x', suggestions: [], notes: [] });

    store.accept(['  Resolved software defects.  ']);

    expect(applied).toEqual([['Resolved software defects.']]);
    expect(store.panel()).toBeNull();
  });

  it('never applies an empty edit, so Accept cannot blank the field', () => {
    let called = false;
    openRewriter('bullet:i1:0', () => (called = true));
    http.expectOne(REWRITE_URL).flush({ original: 'x', suggestions: [], notes: [] });

    store.accept(['   ', '']);

    expect(called).toBe(false);
    expect(store.panel()).toBeNull();
  });

  it('reports a failure with the server’s own wording', () => {
    openRewriter();
    http.expectOne(REWRITE_URL).flush(
      { detail: 'AI usage limit reached. Please try again later.' },
      { status: 429, statusText: 'Too Many Requests' },
    );

    expect(store.panel()?.state).toBe('error');
    expect(store.panel()?.error).toContain('usage limit');
    expect(store.busy()).toBe(false);
  });

  it('can retry the same request after a failure', () => {
    openRewriter();
    http.expectOne(REWRITE_URL).flush({}, { status: 503, statusText: 'Unavailable' });

    store.regenerate();

    expect(store.panel()?.state).toBe('loading');
    http.expectOne(REWRITE_URL).flush({ original: 'x', suggestions: [], notes: [] });
    expect(store.panel()?.state).toBe('ready');
  });

  // --- the guards ----------------------------------------------------------- //

  it('abandons the first request when the user moves to another bullet', () => {
    openRewriter('bullet:i1:0');
    const firstRequest = http.expectOne(REWRITE_URL);

    // The user gives up waiting and clicks ✨ on a different bullet.
    openRewriter('bullet:i1:1');
    const secondRequest = http.match(REWRITE_URL).pop()!;

    // Cancelled outright rather than left to arrive and be ignored: an
    // abandoned call still costs a free-tier request, and a reply that lands
    // after the panel moved on has nowhere correct to go.
    expect(firstRequest.cancelled).toBe(true);
    expect(store.panel()?.key).toBe('bullet:i1:1');
    expect(store.panel()?.state).toBe('loading');
    expect(store.panel()?.options).toEqual([]);

    secondRequest.flush({
      original: 'b',
      suggestions: [{ text: 'Resolved defects.', style: 'concise' }],
      notes: [],
    });
    expect(store.panel()?.state).toBe('ready');
    expect(store.panel()?.options.length).toBe(1);
  });

  it('refuses a second analysis while one is running', () => {
    // The point of the guard: on a free-tier key a double-clicked button is a
    // wasted call, and the server refuses concurrent work per user anyway.
    loadResume();
    store.runAts();
    store.runAts();

    expect(http.match(ATS_URL).length).toBe(1);
  });

  it('will not analyse before a resume has loaded', () => {
    store.runAts();
    http.expectNone(ATS_URL);
    expect(store.atsState()).toBe('idle');
  });

  it('scores the draft currently in the store, not a refetched copy', () => {
    loadResume();
    TestBed.inject(ResumeStore).patch({ title: 'Edited' });
    store.runAts();

    const body = http.expectOne(ATS_URL).request.body;
    expect(body.basics.full_name).toBe('Ada Lovelace');
    expect(body.sections.length).toBe(1);
  });

  it('closing the panel cancels the request behind it', () => {
    openRewriter();
    const request = http.expectOne(REWRITE_URL);

    store.closePanel();

    expect(request.cancelled).toBe(true);
    expect(store.panel()).toBeNull();
    expect(store.busy()).toBe(false);
  });

  afterEach(() => {
    // Every request this suite makes is accounted for; a stray one would mean
    // a guard let something through.
    http.verify({ ignoreCancelled: true });
  });
});
