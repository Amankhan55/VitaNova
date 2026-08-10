import { HttpClient, HttpEventType, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';

import { API_BASE } from '../auth/auth.service';
import { TemplateMeta } from '../models/auth.model';
import { RenderRequest, Resume, ResumeSummary } from '../models/resume.model';

export interface CreateResumePayload {
  title?: string;
  template_id?: string;
  seed_from_template?: boolean;
}

/** What an in-flight import can tell us. `fraction` is 0–1 of bytes sent. */
export type ImportEvent =
  | { state: 'uploading'; fraction: number }
  | { state: 'done'; resume: Resume };

@Injectable({ providedIn: 'root' })
export class ResumeApi {
  private readonly http = inject(HttpClient);

  list(): Observable<ResumeSummary[]> {
    return this.http.get<ResumeSummary[]>(`${API_BASE}/resumes`);
  }

  get(id: string): Observable<Resume> {
    return this.http.get<Resume>(`${API_BASE}/resumes/${id}`);
  }

  create(payload: CreateResumePayload): Observable<Resume> {
    return this.http.post<Resume>(`${API_BASE}/resumes`, payload);
  }

  /** Partial update — this is what the editor's autosave calls. */
  update(id: string, patch: Partial<Resume>): Observable<Resume> {
    return this.http.patch<Resume>(`${API_BASE}/resumes/${id}`, patch);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/resumes/${id}`);
  }

  duplicate(id: string): Observable<Resume> {
    return this.http.post<Resume>(`${API_BASE}/resumes/${id}/duplicate`, {});
  }

  /** Observed as a full response so the download can use the server's
   *  Content-Disposition filename. */
  exportPdf(id: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${API_BASE}/resumes/${id}/export/pdf`, {
      responseType: 'blob',
      observe: 'response',
    });
  }

  /**
   * Upload a PDF resume, parse it with AI, and create a pre-filled resume.
   *
   * Emits upload progress before the result. The upload fraction is measured;
   * what happens after it — text extraction, then the model call — reports
   * nothing back, so this stream simply goes quiet until the response lands.
   * See `IMPORT_PARSE_HALFLIFE_MS` in the dashboard for how that gap is shown.
   */
  importResume(file: File, templateId = 'modern-professional'): Observable<ImportEvent> {
    const form = new FormData();
    form.append('file', file);
    return this.http
      .post<Resume>(`${API_BASE}/resumes/import?template_id=${encodeURIComponent(templateId)}`, form, {
        reportProgress: true,
        observe: 'events',
      })
      .pipe(
        filter(
          (event) =>
            event.type === HttpEventType.UploadProgress || event.type === HttpEventType.Response,
        ),
        map((event): ImportEvent => {
          if (event.type === HttpEventType.UploadProgress) {
            // `total` is absent when the browser cannot size the body; treat
            // that as "uploading, fraction unknown" rather than dividing by zero.
            const fraction = event.total ? event.loaded / event.total : 0;
            return { state: 'uploading', fraction };
          }
          return { state: 'done', resume: (event as HttpResponse<Resume>).body! };
        }),
      );
  }
}

@Injectable({ providedIn: 'root' })
export class TemplateApi {
  private readonly http = inject(HttpClient);

  list(): Observable<TemplateMeta[]> {
    return this.http.get<TemplateMeta[]>(`${API_BASE}/templates`);
  }

  /** Standalone HTML of a design rendered with demo content, for gallery cards. */
  sampleHtml(templateId: string): Observable<string> {
    return this.http.get(`${API_BASE}/templates/${templateId}/sample`, { responseType: 'text' });
  }
}

@Injectable({ providedIn: 'root' })
export class RenderApi {
  private readonly http = inject(HttpClient);

  /**
   * Renders an unsaved draft to standalone HTML — the exact document the PDF is
   * built from, which is why the preview can never drift from the export.
   */
  html(payload: RenderRequest): Observable<string> {
    return this.http.post(`${API_BASE}/render`, payload, { responseType: 'text' });
  }

  pdf(payload: RenderRequest): Observable<Blob> {
    return this.http.post(`${API_BASE}/render/pdf`, payload, { responseType: 'blob' });
  }
}
