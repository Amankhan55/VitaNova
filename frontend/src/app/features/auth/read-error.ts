import { HttpErrorResponse } from '@angular/common/http';

/** Turns an API failure into something worth showing a person. */
export function readError(err: HttpErrorResponse, fallback: string): string {
  const detail = err.error?.detail;
  if (typeof detail === 'string') return detail;
  // FastAPI validation errors arrive as a list of {loc, msg} objects.
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  if (err.status === 0) return 'Cannot reach the VitaNova server. Is the API running?';
  return fallback;
}
