import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { GoogleButton } from '../../shared/ui/google-button/google-button';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { readError } from './read-error';

@Component({
  selector: 'vn-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, GoogleButton, Icon, Logo, ThemeToggle],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <a class="pitch-back" routerLink="/">
        <vn-icon name="arrow-left" [size]="15" />
        Back to vitanova
      </a>

      <div class="pitch-brand">
        <vn-logo [size]="32" rule="#e0785c" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>

      <h1>Your career, <em>beautifully</em> set.</h1>
      <p>
        Write your experience once, then see it typeset in any of our designs. What you see in the
        preview is the very same document we turn into your PDF — never a near-enough approximation.
      </p>
      <ul class="pitch-list">
        <li><vn-icon name="check" [size]="15" /> Fifteen designs, from bold sidebar to strict ATS</li>
        <li><vn-icon name="check" [size]="15" /> Live preview that matches the export exactly</li>
        <li><vn-icon name="check" [size]="15" /> Reorder, rename and hide any section</li>
      </ul>
    </section>

    <section class="panel">
      <div class="panel-top">
        <a class="panel-home" routerLink="/">
          <vn-icon name="arrow-left" [size]="15" />
          Home
        </a>
        <vn-theme-toggle [compact]="true" />
      </div>

      <div class="form-wrap">
        <h2>Welcome back</h2>
        <p class="form-lead">Sign in to pick up where you left off.</p>

        @if (resent()) {
          <div class="form-note" role="status">
            <vn-icon name="mail" [size]="15" />
            <span>We have sent a fresh confirmation link to {{ email }}.</span>
          </div>
        } @else if (unverified()) {
          <div class="form-error" role="alert">
            <vn-icon name="mail" [size]="15" />
            <span>
              Confirm your email address before signing in.
              <button class="inline-action" type="button" [disabled]="busy()" (click)="resend()">
                Send the link again
              </button>
            </span>
          </div>
        } @else if (error(); as message) {
          <div class="form-error" role="alert">
            <vn-icon name="x" [size]="15" />
            <span>{{ message }}</span>
          </div>
        }

        <vn-google-button
          [busy]="busy()"
          (credential)="signInWithGoogle($event)"
          (failed)="error.set($event)"
        />

        <div class="or"><span>or</span></div>

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

          <div class="vn-field">
            <div class="label-row">
              <label class="vn-label" for="password">Password</label>
              <a routerLink="/forgot-password">Forgot password?</a>
            </div>
            <input
              id="password"
              class="vn-input"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              [(ngModel)]="password"
              placeholder="Your password"
            />
          </div>

          <button
            class="vn-btn vn-btn--primary submit"
            type="submit"
            [disabled]="busy() || form.invalid"
          >
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
  /** The account exists but its address was never confirmed. */
  protected readonly unverified = signal(false);
  protected readonly resent = signal(false);

  protected submit(): void {
    if (this.busy()) return;
    this.start();

    this.auth.login(this.email.trim(), this.password).subscribe({
      next: () => this.onSignedIn(),
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        // 403 is the one failure worth naming: the password was right, so
        // saying so gives nothing away, and the fix is a button click.
        if (err.status === 403) {
          this.unverified.set(true);
          return;
        }
        this.error.set(readError(err, 'Could not sign you in. Please try again.'));
      },
    });
  }

  protected signInWithGoogle(credential: string): void {
    if (this.busy()) return;
    this.start();

    this.auth.loginWithGoogle(credential).subscribe({
      next: () => this.onSignedIn(),
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not sign you in with Google.'));
      },
    });
  }

  protected resend(): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.auth.resendVerification(this.email.trim()).subscribe({
      // The response is the same whether or not anything was sent, so there is
      // no error case worth distinguishing here.
      next: () => {
        this.busy.set(false);
        this.unverified.set(false);
        this.resent.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not send the email. Please try again.'));
      },
    });
  }

  private start(): void {
    this.busy.set(true);
    this.error.set('');
    this.unverified.set(false);
    this.resent.set(false);
  }

  private onSignedIn(): void {
    const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/dashboard';
    void this.router.navigateByUrl(redirect);
  }
}
