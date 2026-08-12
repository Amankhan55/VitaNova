import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE } from '../auth/auth.service';
import {
  AtsResponse,
  GenerateRequest,
  GenerateResponse,
  JobMatchResponse,
  RewriteRequest,
  RewriteResponse,
} from '../models/ai.model';
import { Basics, ResumeSection } from '../models/resume.model';

/** The document as the two whole-resume analyses want it. */
interface ResumePayload {
  basics: Basics;
  sections: ResumeSection[];
}

/**
 * The four AI endpoints.
 *
 * Thin on purpose — the same shape as `ResumeApi`, and for the same reason: the
 * interesting behaviour (in-flight guarding, cancellation, error copy) belongs
 * to `AiStore`, which is scoped to one editor, while this is just the wire.
 *
 * The Gemini key never appears here. The browser talks to FastAPI, FastAPI
 * talks to Gemini, and that is the only arrangement in which the key stays
 * secret.
 */
@Injectable({ providedIn: 'root' })
export class AiApi {
  private readonly http = inject(HttpClient);

  /** Draft or improve one section's prose. Sends that section's facts only. */
  generate(payload: GenerateRequest): Observable<GenerateResponse> {
    return this.http.post<GenerateResponse>(`${API_BASE}/ai/resume/generate`, payload);
  }

  /**
   * Rewrite a single bullet.
   *
   * Deliberately not given the resume: a bullet needs its own text plus the
   * role and technologies around it, and sending more would cost tokens on a
   * free-tier key to no benefit.
   */
  rewriteBullet(payload: RewriteRequest): Observable<RewriteResponse> {
    return this.http.post<RewriteResponse>(`${API_BASE}/ai/resume/rewrite-bullet`, payload);
  }

  /** Scores the draft passed in, not the last saved copy — autosave is debounced. */
  atsScore(resume: ResumePayload): Observable<AtsResponse> {
    return this.http.post<AtsResponse>(`${API_BASE}/ai/resume/ats-score`, resume);
  }

  jobMatch(resume: ResumePayload, jobDescription: string): Observable<JobMatchResponse> {
    return this.http.post<JobMatchResponse>(`${API_BASE}/ai/resume/job-match`, {
      ...resume,
      job_description: jobDescription,
    });
  }
}
