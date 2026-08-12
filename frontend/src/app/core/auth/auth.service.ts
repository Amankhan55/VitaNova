import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, shareReplay, tap } from 'rxjs';

import {
  AuthProviders,
  AuthResponse,
  MessageResponse,
  TokenPair,
  User,
} from '../models/auth.model';

const ACCESS_KEY = 'vitanova.access';
const REFRESH_KEY = 'vitanova.refresh';
const USER_KEY = 'vitanova.user';

export const API_BASE = '/api/v1';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _user = signal<User | null>(readStoredUser());
  private readonly _accessToken = signal<string | null>(localStorage.getItem(ACCESS_KEY));
  private providers$?: Observable<AuthProviders>;

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  accessToken(): string | null {
    return this._accessToken();
  }

  refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  /**
   * Creates the account but does *not* start a session: the address has to be
   * confirmed first, so all that comes back is a "check your email" message.
   */
  register(email: string, password: string, fullName: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API_BASE}/auth/register`, {
      email,
      password,
      full_name: fullName,
    });
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_BASE}/auth/login`, { email, password })
      .pipe(tap((res) => this.persist(res)));
  }

  /** Exchanges a Google ID token for a VitaNova session. */
  loginWithGoogle(credential: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_BASE}/auth/google`, { credential })
      .pipe(tap((res) => this.persist(res)));
  }

  /** Confirms an address and signs the user straight in — they have just
   * proved they own it, so a trip through the login form would be busywork. */
  verifyEmail(token: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${API_BASE}/auth/verify-email`, { token })
      .pipe(tap((res) => this.persist(res)));
  }

  resendVerification(email: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API_BASE}/auth/resend-verification`, { email });
  }

  forgotPassword(email: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API_BASE}/auth/forgot-password`, { email });
  }

  resetPassword(token: string, password: string): Observable<void> {
    return this.http.post<void>(`${API_BASE}/auth/reset-password`, { token, password });
  }

  /**
   * Which sign-in methods this server offers. Fetched once and shared: the
   * Google client ID lives in the API's configuration rather than the bundle,
   * so the same build works against any deployment.
   */
  providers(): Observable<AuthProviders> {
    this.providers$ ??= this.http.get<AuthProviders>(`${API_BASE}/auth/providers`).pipe(
      // A server too old or too broken to answer simply has no Google button.
      catchError(() => of({ google_client_id: '' })),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.providers$;
  }

  /**
   * Exchanges the stored refresh token for a new pair. The server rotates it, so
   * the old refresh token is dead the moment this succeeds.
   */
  refresh(): Observable<TokenPair> {
    return this.http
      .post<TokenPair>(`${API_BASE}/auth/refresh`, { refresh_token: this.refreshToken() })
      .pipe(tap((tokens) => this.storeTokens(tokens)));
  }

  /**
   * Ends the session. `navigateTo` defaults to the sign-in screen because most
   * logouts are involuntary (a refresh token that no longer works); the header's
   * deliberate "Sign out" passes the landing page instead. `null` stays put.
   */
  logout(navigateTo: string | null = '/login'): void {
    const refresh = this.refreshToken();
    if (refresh) {
      // Fire-and-forget: the local session is cleared either way.
      this.http
        .post(`${API_BASE}/auth/logout`, { refresh_token: refresh })
        .subscribe({ error: () => undefined });
    }
    this.clear();
    if (navigateTo) {
      void this.router.navigateByUrl(navigateTo);
    }
  }

  private persist(res: AuthResponse): void {
    this._user.set(res.user);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    this.storeTokens(res.tokens);
  }

  private storeTokens(tokens: TokenPair): void {
    localStorage.setItem(ACCESS_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    this._accessToken.set(tokens.access_token);
  }

  private clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    this._accessToken.set(null);
    this._user.set(null);
  }
}

function readStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    // Corrupt entry — drop it rather than trapping the user on a broken session.
    localStorage.removeItem(USER_KEY);
    return null;
  }
}
