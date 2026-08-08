import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, switchMap, throwError } from 'rxjs';

import { API_BASE, AuthService } from './auth.service';

/** Requests that must never carry a token or trigger a refresh attempt. */
const PUBLIC_PATHS = [`${API_BASE}/auth/login`, `${API_BASE}/auth/register`, `${API_BASE}/auth/refresh`];

/**
 * Attaches the access token, and on a 401 transparently refreshes once and
 * replays the request. If the refresh also fails the session is cleared and the
 * user is sent to the login screen.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  if (PUBLIC_PATHS.some((path) => req.url.startsWith(path))) {
    return next(req);
  }

  const token = auth.accessToken();
  const authorised = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authorised).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !auth.refreshToken()) {
        return throwError(() => error);
      }
      return retryWithFreshToken(auth, req, next);
    }),
  );
};

function retryWithFreshToken(
  auth: AuthService,
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  return auth.refresh().pipe(
    switchMap((tokens) =>
      next(req.clone({ setHeaders: { Authorization: `Bearer ${tokens.access_token}` } })),
    ),
    catchError((refreshError: unknown) => {
      auth.logout();
      return throwError(() => refreshError);
    }),
  );
}
