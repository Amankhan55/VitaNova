import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';

@Component({
  selector: 'vn-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Logo],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <div class="pitch-brand">
        <vn-logo [size]="32" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>
      <h1>Your career, beautifully set.</h1>
      <p>
        Write your experience once, then see it typeset in any of our designs. What you see in the
        preview is the very same document we turn into your PDF — never a near-enough approximation.
      </p>
      <ul class="pitch-list">
        <li><vn-icon name="check" [size]="17" /> Four designs, from bold sidebar to strict ATS</li>
        <li><vn-icon name="check" [size]="17" /> Live preview that matches the export exactly</li>
        <li><vn-icon name="check" [size]="17" /> Reorder, rename and hide any section</li>
      </ul>
    </section>

    <section class="panel">
      <div class="form-wrap">
        <h2>Welcome back</h2>
        <p class="form-lead">Sign in to pick up where you left off.</p>

        @if (error(); as message) {
          <div class="form-error" role="alert">
            <vn-icon name="x" [size]="16" />
            <span>{{ message }}</span>
          </div>
        }

        <form (ngSubmit)="submit()" #form="ngForm" novalidate>
          <label class="vn-field">
            <span class="vn-label">Email</span>
            <input
              class="vn-input"
              type="email"
              name="email"
              autocomplete="email"
              required
              [(ngModel)]="email"
              placeholder="you@example.com"
            />
          </label>

          <label class="vn-field">
            <span class="vn-label">Password</span>
            <input
              class="vn-input"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              [(ngModel)]="password"
              placeholder="Your password"
            />
          </label>

          <button class="vn-btn vn-btn--primary submit" type="submit" [disabled]="busy() || form.invalid">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <p class="alt">New here? <a routerLink="/register">Create an account</a></p>
      </div>
    </section>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected email = '';
  protected password = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected submit(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');

    this.auth.login(this.email.trim(), this.password).subscribe({
      next: () => {
        const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/dashboard';
        void this.router.navigateByUrl(redirect);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not sign you in. Please try again.'));
      },
    });
  }
}

export function readError(err: HttpErrorResponse, fallback: string): string {
  const detail = err.error?.detail;
  if (typeof detail === 'string') return detail;
  // FastAPI validation errors arrive as a list of {loc, msg} objects.
  if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
  if (err.status === 0) return 'Cannot reach the VitaNova server. Is the API running?';
  return fallback;
}
