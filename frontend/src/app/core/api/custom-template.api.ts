import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE } from '../auth/auth.service';
import {
  CustomTemplate,
  CustomTemplateCreate,
  CustomTemplateList,
  CustomTemplatePatch,
  CustomTemplateSpec,
} from '../models/custom-template.model';
import { Theme } from '../models/resume.model';

@Injectable({ providedIn: 'root' })
export class CustomTemplateApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE}/custom-templates`;

  list(): Observable<CustomTemplateList> {
    return this.http.get<CustomTemplateList>(this.base);
  }

  get(id: string): Observable<CustomTemplate> {
    return this.http.get<CustomTemplate>(`${this.base}/${id}`);
  }

  create(payload: CustomTemplateCreate): Observable<CustomTemplate> {
    return this.http.post<CustomTemplate>(this.base, payload);
  }

  /** Partial update — this is what the template editor's autosave calls. */
  update(id: string, patch: CustomTemplatePatch): Observable<CustomTemplate> {
    return this.http.patch<CustomTemplate>(`${this.base}/${id}`, patch);
  }

  duplicate(id: string): Observable<CustomTemplate> {
    return this.http.post<CustomTemplate>(`${this.base}/${id}/duplicate`, {});
  }

  /** Resolves to the number of resumes moved onto the default design. */
  remove(id: string): Observable<{ resumes_reassigned: number }> {
    return this.http.delete<{ resumes_reassigned: number }>(`${this.base}/${id}`);
  }

  /**
   * Standalone HTML of an *unsaved* spec against demo content.
   *
   * The editor's preview goes through here rather than through `/sample` so a
   * brand-new design — which has no id to save under yet — still shows a page,
   * and so the preview never has to wait on autosave.
   */
  preview(spec: CustomTemplateSpec, theme: Theme): Observable<string> {
    return this.http.post(`${this.base}/preview`, { spec, theme }, { responseType: 'text' });
  }

  /** Standalone HTML of a *saved* design, for its gallery card. */
  sampleHtml(id: string): Observable<string> {
    return this.http.get(`${this.base}/${id}/sample`, { responseType: 'text' });
  }
}
