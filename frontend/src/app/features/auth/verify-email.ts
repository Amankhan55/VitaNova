import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeToggle } from '../../shared/ui/theme-toggle/theme-toggle';
import { readError } from './read-error';

/**
 * Where the emailed confirmation link lands. Spends the token on arrival; a
 * success signs the visitor in and moves them along, so this screen is only
 * ever seen for a moment — or until it has bad news.
 */
@Component({
  selector: 'vn-verify-email',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Logo, ThemeToggle],
  styleUrl: './auth-shell.scss',
  template: `
    <section class="pitch">
      <div class="pitch-brand">
        <vn-logo [size]="32" />
        <span class="pitch-name">Vita<strong>Nova</strong></span>
      </div>

      <h1>One click and <em>you're</em> in.</h1>
      <p>
        Confirming your address keeps your resumes tied to an inbox you actually own — which is what
        makes it possible to get back in if you ever forget your password.
      </p>
    </section>

    <section class="panel">
      <div class="panel-top">
        <a class="panel-home" routerLink="/">
          <vn-icon name="arrow-left" [size]="15" />
          Home
        </a>
        <vn-theme-toggle [compact]="true" />
      </div>

      <div class="form-wrap status">
        @switch (state()) {
          @case ('working') {
            <span class="status-icon"><vn-icon name="refresh" [size]="26" /></span>
            <h2>Confirming your email…</h2>
            <p>One moment.</p>
          }
          @case ('done') {
            <span class="status-icon"><vn-icon name="check" [size]="26" /></span>
            <h2>You're all set</h2>
            <p>Your email is confirmed. Taking you to your resumes…</p>
          }
          @case ('failed') {
            <span class="status-icon status-icon--bad"><vn-icon name="x" [size]="26" /></span>
            <h2>That link didn't work</h2>
            <p>{{ error() }}</p>

            @if (resent()) {
              <p>A new link is on its way to {{ email }}.</p>
            } @else {
              <p>Confirmation links expire after 24 hours. Enter your address for a fresh one.</p>
              <form (ngSubmit)="resend()" #form="ngForm" novalidate>
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
                <button
                  class="vn-btn vn-btn--primary submit"
                  type="submit"
                  [disabled]="busy() || form.invalid"
                >
                  {{ busy() ? 'Sending…' : 'Send a new link' }}
                </button>
              </form>
            }

            <p class="alt"><a routerLink="/login">Back to sign in</a></p>
          }
        }
      </div>
    </section>
  `,
})
export class VerifyEmailPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected email = '';
  protected readonly state = signal<'working' | 'done' | 'failed'>('working');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly resent = signal(false);

  constructor() {
    const token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
    if (!token) {
      this.state.set('failed');
      this.error.set('This address is missing its confirmation token.');
      return;
    }

    this.auth.verifyEmail(token).subscribe({
      next: () => {
        this.state.set('done');
        // A beat on the confirmation, so the outcome registers before the app
        // replaces it.
        setTimeout(() => void this.router.navigate(['/templates']), 1200);
      },
      error: (err: HttpErrorResponse) => {
        this.state.set('failed');
        this.error.set(readError(err, 'That confirmation link is invalid or has expired.'));
      },
    });
  }

  protected resend(): void {
    if (this.busy()) return;
    this.busy.set(true);

    this.auth.resendVerification(this.email.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.resent.set(true);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(readError(err, 'Could not send the email. Please try again.'));
      },
    });
  }
}
